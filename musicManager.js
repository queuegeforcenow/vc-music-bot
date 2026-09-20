const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType, // ← 追加
} = require('@discordjs/voice');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { spawn } = require('child_process'); // ← 追加
const ffmpeg = require('ffmpeg-static'); // ← 追加
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const { getSettings, addHistory } = require('./database');

// ジャンルごとの検索キーワード
const GENRE_KEYWORDS = {
  chill: 'チルBGM 作業用',
  battle: '戦闘BGM 作業用',
  focus: '集中用BGM 作業用',
  sleep: '睡眠用BGM 雨音',
  sleep_rain: '睡眠用BGM 雨音',
  ambient: '環境音 BGM 作業用',
  uptempo: 'テンションが上がるBGM 作業用',
  upbeat: 'テンションが上がるBGM 作業用',
};

// おすすめモードの検索候補
const RECOMMEND_QUERIES = [
  'lofi hip hop',
  'ゲーム作業用BGM',
  'カフェBGM',
  'ピアノBGM',
  '雨音・リラックスBGM',
];

const LOOP_LABELS = { off: 'OFF', track: '1曲リピート', queue: 'キューリピート' };
const EMPTY_CHANNEL_TIMEOUT_MS = 5 * 60 * 1000; // 5分間ボットだけなら自動退出

// guildId -> ManagerState
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
      resource: null,
      queue: [], // { title, url, requestedBy, isAutoplay }
      current: null,
      textChannel: null,
      voiceChannelId: null,
      loop: 'off', // 'off' | 'track' | 'queue'
      liveVolume: 20, // 現在セッションの音量（%）
      nowPlayingMessage: null,
      emptyChannelTimer: null,
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
        clearEmptyTimer(guildId);
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
  m.current = null;
  m.player.stop(true);
  if (m.connection) m.connection.destroy();
  clearEmptyTimer(guildId);
  managers.delete(guildId);
  return true;
}

// 通常の曲をキューに追加する
async function enqueue(guildId, { title, url, requestedBy }) {
  const m = ensureManager(guildId);
  m.queue.push({ title, url, requestedBy, isAutoplay: false });
  if (m.player.state.status === AudioPlayerStatus.Idle && !m.current) {
    await playNext(guildId);
  }
  return m.queue.length;
}

// 複数曲をまとめてキューに追加する
async function enqueueMany(guildId, tracks, requestedBy) {
  const m = ensureManager(guildId);
  for (const t of tracks) {
    m.queue.push({ title: t.title, url: t.url, requestedBy, isAutoplay: false });
  }
  if (m.player.state.status === AudioPlayerStatus.Idle && !m.current) {
    await playNext(guildId);
  }
  return m.queue.length;
}

// YouTubeプレイリストURLから曲一覧を取得する
async function resolveYoutubePlaylist(url, limit = 50) {
  const pl = await play.playlist_info(url, { incomplete: true });
  const videos = await pl.all_videos();
  return videos.slice(0, limit).map((v) => ({ title: v.title, url: v.url }));
}

// 現在再生中の曲＋キューの中身をスナップショットとして取得する
function getCurrentAndQueueSnapshot(guildId) {
  const m = getManager(guildId);
  if (!m) return [];
  const list = [];
  if (m.current && !m.current.isAutoplay) list.push({ title: m.current.title, url: m.current.url });
  for (const t of m.queue) list.push({ title: t.title, url: t.url });
  return list;
}

// 実際に音声リソースを作って再生する
async function playTrackFromUrl(guildId, track, volumePercent) {
  const m = ensureManager(guildId);

  // デバッグ用ログ
  console.log(`[playTrackFromUrl] 渡されたトラック:`, track);

  // 無効なURLのガード
  if (!track || !track.url || track.url === 'undefined' || typeof track.url !== 'string') {
    console.error(`[再生スキップ] 無効なURLが検出されたため再生を中止しました:`, track);
    m.current = null;
    await sendOrUpdateNowPlaying(guildId);
    return;
  }

  try {
    // ytdl-core で音声ストリームを取得
    const ytdlStream = ytdl(track.url, {
      filter: 'audioonly',
      highWaterMark: 1 << 25,
    });

    // ffmpeg-static を使って Discord 用の PCM ストリームに変換する
    const transcoder = spawn(ffmpeg, [
      '-i', 'pipe:0',
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    ytdlStream.pipe(transcoder.stdin);

    const resource = createAudioResource(transcoder.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });

    const vol = Math.max(0, Math.min(100, volumePercent));
    resource.volume.setVolume(vol / 100);
    m.resource = resource;
    m.liveVolume = vol;
    m.current = track;
    m.player.play(resource);
    await sendOrUpdateNowPlaying(guildId);

    addHistory(guildId, {
      title: track.title,
      url: track.url,
      requestedBy: track.requestedBy ?? null,
      isAutoplay: !!track.isAutoplay,
    }).catch((err) => console.error('[履歴記録エラー]', err));

  } catch (err) {
    console.error('[再生エラー]', err);
    m.current = null;
    await sendOrUpdateNowPlaying(guildId);
  }
}

// キューの次の曲を再生
async function playNext(guildId) {
  const m = getManager(guildId);
  if (!m) return;

  if (m.loop === 'track' && m.current) {
    const settings = await getSettings(guildId);
    await playTrackFromUrl(guildId, m.current, m.liveVolume ?? settings.volume);
    return;
  }

  if (m.loop === 'queue' && m.current && !m.current.isAutoplay) {
    m.queue.push(m.current);
  }

  if (m.queue.length > 0) {
    const next = m.queue.shift();
    const settings = await getSettings(guildId);
    await playTrackFromUrl(guildId, next, settings.volume);
    return;
  }

  const settings = await getSettings(guildId);
  if (!settings.auto_bgm || settings.mode === 'off') {
    m.current = null;
    await sendOrUpdateNowPlaying(guildId);
    return;
  }

  const autoTrack = await buildAutoplayTrack(settings);
  if (!autoTrack) {
    m.current = null;
    await sendOrUpdateNowPlaying(guildId);
    return;
  }
  await playTrackFromUrl(guildId, autoTrack, settings.volume);
}

async function handleTrackEnd(guildId) {
  const m = getManager(guildId);
  if (!m) return;
  await playNext(guildId);
}

// 自動BGMモードに応じて再生対象を決定する
async function buildAutoplayTrack(settings) {
  try {
    if (settings.mode === 'custom') {
      if (settings.custom_link) {
        return { title: 'カスタム自動BGM', url: settings.custom_link, isAutoplay: true };
      }
      settings.mode = 'recommend';
    }

    let query;
    if (settings.mode === 'genre' && settings.genre && GENRE_KEYWORDS[settings.genre]) {
      query = GENRE_KEYWORDS[settings.genre];
    } else {
      query = RECOMMEND_QUERIES[Math.floor(Math.random() * RECOMMEND_QUERIES.length)];
    }

    const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
    if (!results || results.length === 0 || !results[0].url) return null;

    const top = results[0];
    return { title: top.title, url: top.url, isAutoplay: true };
  } catch (err) {
    console.error('[Autoplay検索エラー]', err);
    return null;
  }
}

// ==================== 再生コントロール ====================

function pause(guildId) {
  const m = getManager(guildId);
  if (!m || !m.current) return false;
  return m.player.pause();
}

function resume(guildId) {
  const m = getManager(guildId);
  if (!m || !m.current) return false;
  return m.player.unpause();
}

async function skip(guildId, count = 1) {
  const m = getManager(guildId);
  if (!m || !m.current) return false;

  const wasTrackLoop = m.loop === 'track';
  if (wasTrackLoop) m.loop = 'off';

  if (count > 1 && m.queue.length > 0) {
    m.queue.splice(0, count - 1);
  }

  m.player.stop(true);

  if (wasTrackLoop) {
    setTimeout(() => { if (m) m.loop = 'track'; }, 500);
  }
  return true;
}

function stop(guildId) {
  const m = getManager(guildId);
  if (!m) return false;
  m.queue = [];
  m.loop = 'off';
  m.current = null;
  m.player.stop(true);
  return true;
}

function setLiveVolume(guildId, percent) {
  const m = getManager(guildId);
  if (!m) return null;
  const vol = Math.max(0, Math.min(100, percent));
  m.liveVolume = vol;
  if (m.resource) m.resource.volume.setVolume(vol / 100);
  return vol;
}

function adjustLiveVolume(guildId, deltaPercent) {
  const m = getManager(guildId);
  if (!m) return null;
  return setLiveVolume(guildId, (m.liveVolume ?? 20) + deltaPercent);
}

function setLoop(guildId, mode) {
  const m = ensureManager(guildId);
  m.loop = mode;
  return m.loop;
}

function cycleLoop(guildId) {
  const m = ensureManager(guildId);
  const order = ['off', 'track', 'queue'];
  const idx = order.indexOf(m.loop);
  m.loop = order[(idx + 1) % order.length];
  return m.loop;
}

// ==================== キュー管理 ====================

function getQueue(guildId) {
  const m = getManager(guildId);
  return m ? m.queue : [];
}

function clearQueue(guildId) {
  const m = getManager(guildId);
  if (!m) return 0;
  const count = m.queue.length;
  m.queue = [];
  return count;
}

function shuffleQueue(guildId) {
  const m = getManager(guildId);
  if (!m) return false;
  for (let i = m.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [m.queue[i], m.queue[j]] = [m.queue[j], m.queue[i]];
  }
  return true;
}

function removeFromQueue(guildId, position) {
  const m = getManager(guildId);
  if (!m) return null;
  const idx = position - 1;
  if (idx < 0 || idx >= m.queue.length) return null;
  const [removed] = m.queue.splice(idx, 1);
  return removed;
}

function moveInQueue(guildId, from, to) {
  const m = getManager(guildId);
  if (!m) return false;
  const fromIdx = from - 1;
  const toIdx = to - 1;
  if (
    fromIdx < 0 || fromIdx >= m.queue.length ||
    toIdx < 0 || toIdx >= m.queue.length
  ) {
    return false;
  }
  const [track] = m.queue.splice(fromIdx, 1);
  m.queue.splice(toIdx, 0, track);
  return true;
}

// ==================== Now Playing UI ====================

function buildNowPlayingComponents(guildId) {
  const m = getManager(guildId);
  const isPaused = m?.player.state.status === AudioPlayerStatus.Paused;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_pauseresume')
      .setLabel(isPaused ? '再開' : '一時停止')
      .setEmoji(isPaused ? '▶️' : '⏸️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('music_skip')
      .setLabel('スキップ')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_stop')
      .setLabel('停止')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('music_loop')
      .setLabel(`ループ: ${LOOP_LABELS[m?.loop ?? 'off']}`)
      .setEmoji('🔁')
      .setStyle(m?.loop && m.loop !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_volume_down')
      .setLabel('音量 -10')
      .setEmoji('🔉')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_volume_up')
      .setLabel('音量 +10')
      .setEmoji('🔊')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

function buildNowPlayingEmbed(guildId) {
  const m = getManager(guildId);
  if (!m || !m.current) {
    return new EmbedBuilder()
      .setColor(0x99aab5)
      .setTitle('⏹️ 再生中の曲はありません')
      .setDescription('`/music` で曲を追加するか、自動BGMをONにしてください。');
  }

  const isPaused = m.player.state.status === AudioPlayerStatus.Paused;
  const embed = new EmbedBuilder()
    .setColor(isPaused ? 0xed4245 : 0x57f287)
    .setTitle(isPaused ? '⏸️ 一時停止中' : '▶️ 再生中')
    .setDescription(`[${m.current.title}](${m.current.url})`)
    .addFields(
      { name: '種別', value: m.current.isAutoplay ? '自動BGM' : '通常再生', inline: true },
      { name: '音量', value: `${m.liveVolume}%`, inline: true },
      { name: 'ループ', value: LOOP_LABELS[m.loop], inline: true },
      { name: 'キュー残数', value: `${m.queue.length}曲`, inline: true }
    );
  return embed;
}

async function sendOrUpdateNowPlaying(guildId) {
  const m = getManager(guildId);
  if (!m || !m.textChannel) return;

  const embed = buildNowPlayingEmbed(guildId);
  const components = buildNowPlayingComponents(guildId);

  try {
    if (m.nowPlayingMessage) {
      await m.nowPlayingMessage.edit({ embeds: [embed], components });
    } else {
      m.nowPlayingMessage = await m.textChannel.send({ embeds: [embed], components });
    }
  } catch (err) {
    try {
      m.nowPlayingMessage = await m.textChannel.send({ embeds: [embed], components });
    } catch (e) {
      console.error('[NowPlaying送信エラー]', e);
    }
  }
}

// ==================== ボイスチャンネル無人化検知 ====================

function clearEmptyTimer(guildId) {
  const m = getManager(guildId);
  if (m?.emptyChannelTimer) {
    clearTimeout(m.emptyChannelTimer);
    m.emptyChannelTimer = null;
  }
}

async function scheduleEmptyLeaveCheck(guildId, voiceChannel) {
  const m = getManager(guildId);
  if (!m) return;
  clearEmptyTimer(guildId);

  const settings = await getSettings(guildId);
  if (settings.twenty_four_seven) {
    return;
  }

  const humanCount = voiceChannel.members.filter((mem) => !mem.user.bot).size;
  if (humanCount === 0) {
    m.emptyChannelTimer = setTimeout(() => {
      leaveChannel(guildId);
    }, EMPTY_CHANNEL_TIMEOUT_MS);
  }
}

module.exports = {
  getManager,
  ensureManager,
  joinChannel,
  leaveChannel,
  enqueue,
  enqueueMany,
  resolveYoutubePlaylist,
  getCurrentAndQueueSnapshot,
  playNext,
  GENRE_KEYWORDS,
  RECOMMEND_QUERIES,
  LOOP_LABELS,
  pause,
  resume,
  skip,
  stop,
  setLiveVolume,
  adjustLiveVolume,
  setLoop,
  cycleLoop,
  getQueue,
  clearQueue,
  shuffleQueue,
  removeFromQueue,
  moveInQueue,
  buildNowPlayingEmbed,
  buildNowPlayingComponents,
  sendOrUpdateNowPlaying,
  scheduleEmptyLeaveCheck,
  clearEmptyTimer,
};
