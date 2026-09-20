const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const play = require('play-dl');
const { getSettings } = require('./database');

// ジャンルごとの検索キーワード（レポート仕様どおり）
const GENRE_KEYWORDS = {
  chill: 'チルBGM 作業用',
  battle: '戦闘BGM 作業用',
  focus: '集中用BGM 作業用',
  sleep: '睡眠用BGM 雨音',
  ambient: '環境音 BGM 作業用',
  uptempo: 'テンションが上がるBGM 作業用',
};

// おすすめモードの検索候補
const RECOMMEND_QUERIES = [
  'lofi hip hop',
  'ゲーム作業用BGM',
  'カフェBGM',
  'ピアノBGM',
  '雨音・リラックスBGM',
];

// guildId -> { connection, player, queue: [], current, textChannel, voiceChannelId }
const managers = new Map();

function getManager(guildId) {
  return managers.get(guildId);
}

function ensureManager(guildId) {
  let m = managers.get(guildId);
  if (!m) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    m = {
      connection: null,
      player,
      queue: [], // { title, url, requestedBy, isAutoplay }
      current: null,
      textChannel: null,
      voiceChannelId: null,
    };
    managers.set(guildId, m);

    player.on(AudioPlayerStatus.Idle, () => handleTrackEnd(guildId));
    player.on('error', (err) => {
      console.error(`[Player Error] guild=${guildId}`, err);
      handleTrackEnd(guildId);
    });
  }
  return m;
}

// ボイスチャンネルに接続する
async function joinChannel(voiceChannel, textChannel) {
  const guildId = voiceChannel.guild.id;
  const m = ensureManager(guildId);
  m.textChannel = textChannel;
  m.voiceChannelId = voiceChannel.id;

  if (!m.connection || m.connection.state.status === VoiceConnectionStatus.Destroyed) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    connection.subscribe(m.player);
    m.connection = connection;

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        connection.destroy();
        managers.delete(guildId);
      }
    });
  }
  return m;
}

function leaveChannel(guildId) {
  const m = managers.get(guildId);
  if (!m) return false;
  m.queue = [];
  m.player.stop(true);
  if (m.connection) m.connection.destroy();
  managers.delete(guildId);
  return true;
}

// 通常の曲をキューに追加する（/music で使用）
async function enqueue(guildId, { title, url, requestedBy }) {
  const m = ensureManager(guildId);
  m.queue.push({ title, url, requestedBy, isAutoplay: false });
  if (m.player.state.status === AudioPlayerStatus.Idle && !m.current) {
    await playNext(guildId);
  }
}

// 実際に音声リソースを作って再生する
async function playTrackFromUrl(guildId, track, volumePercent) {
  const m = ensureManager(guildId);
  const stream = await play.stream(track.url);
  const resource = createAudioResource(stream.stream, {
    inputType: stream.type,
    inlineVolume: true,
  });
  resource.volume.setVolume(Math.max(0, Math.min(100, volumePercent)) / 100);
  m.current = track;
  m.player.play(resource);
}

// キューの次の曲を再生。無ければ自動BGM条件を判定する
async function playNext(guildId) {
  const m = getManager(guildId);
  if (!m) return;

  if (m.queue.length > 0) {
    const next = m.queue.shift();
    const settings = await getSettings(guildId);
    await playTrackFromUrl(guildId, next, settings.volume);
    return;
  }

  // 通常曲が無い → 自動BGM条件を確認
  const settings = await getSettings(guildId);
  if (!settings.auto_bgm || settings.mode === 'off') {
    m.current = null;
    return;
  }

  const autoTrack = await buildAutoplayTrack(settings);
  if (!autoTrack) {
    m.current = null;
    return;
  }
  await playTrackFromUrl(guildId, autoTrack, settings.volume);
}

// 曲が終わった時のハンドラ（3条件がすべて揃えば自動BGM継続）
async function handleTrackEnd(guildId) {
  const m = getManager(guildId);
  if (!m) return;
  m.current = null;
  await playNext(guildId);
}

// 自動BGMモードに応じて再生対象を決定する
async function buildAutoplayTrack(settings) {
  try {
    if (settings.mode === 'custom' && settings.custom_link) {
      return { title: 'カスタム自動BGM', url: settings.custom_link, isAutoplay: true };
    }

    let query;
    if (settings.mode === 'genre' && settings.genre && GENRE_KEYWORDS[settings.genre]) {
      query = GENRE_KEYWORDS[settings.genre];
    } else {
      // おすすめモード（またはフォールバック）：候補からランダムに1つ選ぶ
      query = RECOMMEND_QUERIES[Math.floor(Math.random() * RECOMMEND_QUERIES.length)];
    }

    const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
    if (!results || results.length === 0) return null;

    const top = results[0];
    return { title: top.title, url: top.url, isAutoplay: true };
  } catch (err) {
    console.error('[Autoplay検索エラー]', err);
    return null;
  }
}

module.exports = {
  getManager,
  ensureManager,
  joinChannel,
  leaveChannel,
  enqueue,
  playNext,
  GENRE_KEYWORDS,
  RECOMMEND_QUERIES,
};
