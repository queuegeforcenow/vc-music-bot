const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 全テーブルを作成
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id      TEXT PRIMARY KEY,
      auto_bgm      BOOLEAN NOT NULL DEFAULT FALSE,
      mode          TEXT NOT NULL DEFAULT 'off', -- 'recommend' | 'genre' | 'custom' | 'off'
      genre         TEXT,
      custom_link   TEXT,
      volume        INTEGER NOT NULL DEFAULT 20,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 再生履歴
  await pool.query(`
    CREATE TABLE IF NOT EXISTS track_history (
      id            SERIAL PRIMARY KEY,
      guild_id      TEXT NOT NULL,
      title         TEXT NOT NULL,
      url           TEXT NOT NULL,
      requested_by  TEXT,
      is_autoplay   BOOLEAN NOT NULL DEFAULT FALSE,
      played_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_track_history_guild_played
      ON track_history (guild_id, played_at DESC);
  `);

  // お気に入り（サーバー内・ユーザーごと）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      id            SERIAL PRIMARY KEY,
      guild_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      title         TEXT NOT NULL,
      url           TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (guild_id, user_id, url)
    );
  `);

  // プレイリスト（サーバー共有）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS playlists (
      id            SERIAL PRIMARY KEY,
      guild_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      created_by    TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (guild_id, name)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id            SERIAL PRIMARY KEY,
      playlist_id   INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      position      INTEGER NOT NULL,
      title         TEXT NOT NULL,
      url           TEXT NOT NULL,
      added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log('[DB] テーブルの準備が完了しました');
}

const DEFAULT_SETTINGS = {
  guild_id: null,
  auto_bgm: false,
  mode: 'off',
  genre: null,
  custom_link: null,
  volume: 20,
};

// ==================== 自動BGM設定 ====================

async function getSettings(guildId) {
  const { rows } = await pool.query(
    'SELECT * FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  if (rows.length === 0) {
    return { ...DEFAULT_SETTINGS, guild_id: guildId };
  }
  return rows[0];
}

async function upsertSettings(guildId, partial) {
  const current = await getSettings(guildId);
  const merged = { ...current, ...partial };

  const { rows } = await pool.query(
    `INSERT INTO guild_settings (guild_id, auto_bgm, mode, genre, custom_link, volume, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (guild_id) DO UPDATE SET
       auto_bgm = EXCLUDED.auto_bgm,
       mode = EXCLUDED.mode,
       genre = EXCLUDED.genre,
       custom_link = EXCLUDED.custom_link,
       volume = EXCLUDED.volume,
       updated_at = now()
     RETURNING *`,
    [
      guildId,
      merged.auto_bgm,
      merged.mode,
      merged.genre,
      merged.custom_link,
      merged.volume,
    ]
  );
  return rows[0];
}

// ==================== 再生履歴 ====================

// 曲の再生開始時に履歴へ記録する
async function addHistory(guildId, { title, url, requestedBy, isAutoplay }) {
  await pool.query(
    `INSERT INTO track_history (guild_id, title, url, requested_by, is_autoplay)
     VALUES ($1, $2, $3, $4, $5)`,
    [guildId, title, url, requestedBy ?? null, !!isAutoplay]
  );
}

// 直近の再生履歴を新しい順に取得（デフォルト15件）
async function getHistory(guildId, limit = 15) {
  const { rows } = await pool.query(
    `SELECT * FROM track_history WHERE guild_id = $1 ORDER BY played_at DESC LIMIT $2`,
    [guildId, limit]
  );
  return rows;
}

// ==================== お気に入り ====================

// 既に同じURLを登録済みならそのまま返す（ON CONFLICT DO NOTHING）
async function addFavorite(guildId, userId, { title, url }) {
  const { rows } = await pool.query(
    `INSERT INTO favorites (guild_id, user_id, title, url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, url) DO NOTHING
     RETURNING *`,
    [guildId, userId, title, url]
  );
  if (rows.length > 0) return { favorite: rows[0], alreadyExisted: false };

  const existing = await pool.query(
    `SELECT * FROM favorites WHERE guild_id = $1 AND user_id = $2 AND url = $3`,
    [guildId, userId, url]
  );
  return { favorite: existing.rows[0], alreadyExisted: true };
}

// 登録順（古い順）で取得。position番号は呼び出し側で1から振る
async function getFavorites(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM favorites WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
    [guildId, userId]
  );
  return rows;
}

// 1-based position指定で削除
async function removeFavoriteByPosition(guildId, userId, position) {
  const favs = await getFavorites(guildId, userId);
  const idx = position - 1;
  if (idx < 0 || idx >= favs.length) return null;
  const target = favs[idx];
  await pool.query('DELETE FROM favorites WHERE id = $1', [target.id]);
  return target;
}

// ==================== プレイリスト ====================

async function createPlaylist(guildId, name, createdBy) {
  const { rows } = await pool.query(
    `INSERT INTO playlists (guild_id, name, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, name) DO NOTHING
     RETURNING *`,
    [guildId, name, createdBy]
  );
  return rows[0] ?? null; // null の場合は同名が既に存在
}

async function getPlaylistByName(guildId, name) {
  const { rows } = await pool.query(
    `SELECT * FROM playlists WHERE guild_id = $1 AND LOWER(name) = LOWER($2)`,
    [guildId, name]
  );
  return rows[0] ?? null;
}

async function listPlaylists(guildId) {
  const { rows } = await pool.query(
    `SELECT p.*, COUNT(pt.id)::int AS track_count
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     WHERE p.guild_id = $1
     GROUP BY p.id
     ORDER BY p.created_at ASC`,
    [guildId]
  );
  return rows;
}

async function getPlaylistTracks(playlistId) {
  const { rows } = await pool.query(
    `SELECT * FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC`,
    [playlistId]
  );
  return rows;
}

async function addTrackToPlaylist(playlistId, { title, url }) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM playlist_tracks WHERE playlist_id = $1`,
    [playlistId]
  );
  const nextPos = rows[0].next_pos;
  const inserted = await pool.query(
    `INSERT INTO playlist_tracks (playlist_id, position, title, url)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [playlistId, nextPos, title, url]
  );
  return inserted.rows[0];
}

// 複数トラックを一括追加（YouTubeプレイリスト取り込み・キュー保存用）
async function addTracksToPlaylist(playlistId, tracks) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(position), 0) AS max_pos FROM playlist_tracks WHERE playlist_id = $1`,
    [playlistId]
  );
  let pos = rows[0].max_pos;
  const inserted = [];
  for (const t of tracks) {
    pos += 1;
    const r = await pool.query(
      `INSERT INTO playlist_tracks (playlist_id, position, title, url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [playlistId, pos, t.title, t.url]
    );
    inserted.push(r.rows[0]);
  }
  return inserted;
}

async function removeTrackFromPlaylist(playlistId, position) {
  const { rows } = await pool.query(
    `DELETE FROM playlist_tracks WHERE playlist_id = $1 AND position = $2 RETURNING *`,
    [playlistId, position]
  );
  return rows[0] ?? null;
}

async function deletePlaylist(guildId, name) {
  const { rows } = await pool.query(
    `DELETE FROM playlists WHERE guild_id = $1 AND LOWER(name) = LOWER($2) RETURNING *`,
    [guildId, name]
  );
  return rows[0] ?? null;
}

module.exports = {
  pool,
  initDB,
  getSettings,
  upsertSettings,
  // 履歴
  addHistory,
  getHistory,
  // お気に入り
  addFavorite,
  getFavorites,
  removeFavoriteByPosition,
  // プレイリスト
  createPlaylist,
  getPlaylistByName,
  listPlaylists,
  getPlaylistTracks,
  addTrackToPlaylist,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
  deletePlaylist,
};
