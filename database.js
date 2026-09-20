const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// サーバーごとの自動BGM設定テーブルを作成
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
  console.log('[DB] guild_settings テーブルの準備が完了しました');
}

const DEFAULT_SETTINGS = {
  guild_id: null,
  auto_bgm: false,
  mode: 'off',
  genre: null,
  custom_link: null,
  volume: 20,
};

// 指定サーバーの設定を取得（存在しなければデフォルト値を返す）
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

// 部分更新（渡されたフィールドだけ更新し、他は既存値を保持）
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

module.exports = { pool, initDB, getSettings, upsertSettings };
