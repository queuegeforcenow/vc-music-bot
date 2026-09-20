const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const { getSettings, addHistory } = require('./database');

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

// 通常の曲をキューに追加する（/music で使用）
async function enqueue(guildId, { title, url, requestedBy }) {
  const m = ensureManager(guildId);
  m.queue.push({ title, url, requestedBy, isAutoplay: false });
  if (m.player.state.status === AudioPlayerStatus.Idle && !m.current) {
    await playNext(guildId);
  }
  return m.queue.length;
}

// 複数曲をまとめてキューに追加する（YouTubeプレイリスト取り込み・保存済みプレイリスト再生用）
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

// YouTubeプレイリストURLから曲一覧を取得する（{title, url}の配列）
async function resolveYoutubePlaylist(url, limit = 50) {
  const pl = await play.playlist_info(url, { incomplete: true });
  const videos = await pl.all_videos();
  return videos.slice(0, limit).map((v) => ({ title: v.title, url: v.url }));
}

// 現在再生中の曲＋キューの中身をスナップショットとして取得する（プレイリスト保存用）
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

  // URLが存在しない（undefined）場合は処理を安全に中断
  if (!track || !track.url) {
    console.error(`[再生エラー] guild=${guildId}: 再生対象のURLが指定されていません。`);
    m.current = null;
    await sendOrUpdateNowPlaying(guildId);
    return;
  }

  const stream = await play.stream(track.url);
  const resource = createAudioResource(stream.stream, {
    inputType: stream.type,
    inlineVolume: true,
  });
  const vol = Math.max(0, Math.min(100, volumePercent));
  resource.volume.setVolume(vol / 100);
  m.resource = resource;
  m.liveVolume = vol;
  m.current = track;
  m.player.play(resource);
  await sendOrUpdateNowPlaying(guildId);

  // 再生履歴に記録（失敗しても再生自体は継続させる）
  addHistory(guildId, {
    title: track.title,
    url: track.url,
    requestedBy: track.requestedBy ?? null,
    isAutoplay: !!track.isAutoplay,
  }).catch((err) => console.error('[履歴記録エラー]', err));
}

// キューの次の曲を再生。無ければ自動BGM条件を判定する
async function playNext(guildId) {
  const m = getManager(guildId);
  if (!m) return;

  // ループ: 1曲リピートなら同じ曲をもう一度
  if (m.loop === 'track' && m.current) {
    const settings = await getSettings(guildId);
    await playTrackFromUrl(guildId, m.current, m.liveVolume ?? settings.volume);
    return;
  }

  // ループ: キューリピートなら再生し終えた曲を末尾に戻す
  if (m.loop === 'queue' && m.current && !m.current.isAutoplay) {
    m.queue.push(m.current);
  }

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

// 曲が終わった時のハンドラ（3条件がすべて揃えば自動BGM継続）
async function handleTrackEnd(guildId) {
  const m = getManager(guildId);
  if (!m) return;
  // m.current はループ判定（1曲/キューリピート）に使うため playNext 側でクリアする
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

async function skip(guildId) {
  const m = getManager(guildId);
  if (!m || !m.current) return false;
  // 1曲リピート中にスキップした場合はループを崩さないよう一旦OFF扱いで次へ
  const wasTrackLoop = m.loop === 'track';
  if (wasTrackLoop) m.loop = 'off';
  m.player.stop(true); // Idleイベント経由でplayNextが呼ばれる
  if (wasTrackLoop) {
    // 次のIdle処理が終わった後にループ設定を戻す
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

// 1-based position で指定して削除
function removeFromQueue(guildId, position) {
  const m = getManager(guildId);
  if (!m) return null;
  const idx = position - 1;
  if (idx < 0 || idx >= m.queue.length) return null;
  const [removed] = m.queue.splice(idx, 1);
  return removed;
}

// 1-based position 同士を入れ替え/移動
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

// Now Playingメッセージを新規送信 or 既存メッセージを編集
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
    // メッセージが削除された等の場合は新規送信し直す
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

// Bot以外のメンバーが0人になったら一定時間後に自動退出、誰か入ったらキャンセル
function scheduleEmptyLeaveCheck(guildId, voiceChannel) {
  const m = getManager(guildId);
  if (!m) return;
  clearEmptyTimer(guildId);

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
  // 再生コントロール
  pause,
  resume,
  skip,
  stop,
  setLiveVolume,
  adjustLiveVolume,
  setLoop,
  cycleLoop,
  // キュー管理
  getQueue,
  clearQueue,
  shuffleQueue,
  removeFromQueue,
  moveInQueue,
  // Now Playing UI
  buildNowPlayingEmbed,
  buildNowPlayingComponents,
  sendOrUpdateNowPlaying,
  // 無人化検知
  scheduleEmptyLeaveCheck,
  clearEmptyTimer,
};
