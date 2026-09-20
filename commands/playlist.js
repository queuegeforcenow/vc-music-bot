const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const {
  createPlaylist,
  getPlaylistByName,
  listPlaylists,
  getPlaylistTracks,
  addTrackToPlaylist,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
  deletePlaylist,
} = require('../database');
const {
  joinChannel,
  enqueueMany,
  resolveYoutubePlaylist,
  getCurrentAndQueueSnapshot,
} = require('../musicManager');

const MAX_NAME_LENGTH = 50;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('サーバー共有のプレイリストを作成・管理します')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('新しいプレイリストを作成します')
        .addStringOption((opt) => opt.setName('name').setDescription('プレイリスト名').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('プレイリストに曲を追加します（曲名・URL・YouTubeプレイリストURLに対応）')
        .addStringOption((opt) => opt.setName('name').setDescription('プレイリスト名').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('query').setDescription('曲名、YouTubeのURL、またはプレイリストURL').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('save')
        .setDescription('現在再生中の曲とキューの内容を新しいプレイリストとして保存します')
        .addStringOption((opt) => opt.setName('name').setDescription('プレイリスト名').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('プレイリストの曲をすべてキューに追加します')
        .addStringOption((opt) => opt.setName('name').setDescription('プレイリスト名').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('このサーバーのプレイリスト一覧を表示します'))
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('プレイリストの中身を表示します')
        .addStringOption((opt) => opt.setName('name').setDescription('プレイリスト名').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('プレイリストから1曲削除します')
        .addStringOption((opt) => opt.setName('name').setDescription('プレイリスト名').setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName('position').setDescription('/playlist show の番号').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('プレイリストごと削除します')
        .addStringOption((opt) => opt.setName('name').setDescription('プレイリスト名').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'create') {
      const name = interaction.options.getString('name', true).slice(0, MAX_NAME_LENGTH);
      const created = await createPlaylist(guildId, name, interaction.user.id);
      if (!created) {
        return interaction.reply({ content: `⚠️ プレイリスト「${name}」は既に存在します。`, ephemeral: true });
      }
      return interaction.reply(`📁 プレイリスト「${created.name}」を作成しました。`);
    }

    if (sub === 'add') {
      const name = interaction.options.getString('name', true);
      const query = interaction.options.getString('query', true);

      const playlist = await getPlaylistByName(guildId, name);
      if (!playlist) {
        return interaction.reply({ content: `⚠️ プレイリスト「${name}」が見つかりません。先に \`/playlist create\` で作成してください。`, ephemeral: true });
      }

      await interaction.deferReply();

      const validType = play.yt_validate(query);

      if (validType === 'playlist') {
        let tracks;
        try {
          tracks = await resolveYoutubePlaylist(query);
        } catch (err) {
          console.error('[プレイリスト取得エラー]', err);
          return interaction.editReply('❌ プレイリストの取得に失敗しました。URLを確認してください。');
        }
        if (!tracks || tracks.length === 0) {
          return interaction.editReply('❌ プレイリストに曲が見つかりませんでした。');
        }
        await addTracksToPlaylist(playlist.id, tracks);
        return interaction.editReply(`➕ 「${playlist.name}」に ${tracks.length}曲 を追加しました。`);
      }

      let title, url;
      if (validType === 'video') {
        const info = await play.video_basic_info(query);
        title = info.video_details.title;
        url = info.video_details.url;
      } else {
        const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
        if (!results || results.length === 0) {
          return interaction.editReply('❌ 曲が見つかりませんでした。');
        }
        title = results[0].title;
        url = results[0].url;
      }

      await addTrackToPlaylist(playlist.id, { title, url });
      return interaction.editReply(`➕ 「${playlist.name}」に **${title}** を追加しました。`);
    }

    if (sub === 'save') {
      const name = interaction.options.getString('name', true).slice(0, MAX_NAME_LENGTH);
      const snapshot = getCurrentAndQueueSnapshot(guildId);
      if (snapshot.length === 0) {
        return interaction.reply({ content: 'ℹ️ 現在再生中の曲・キューが空のため保存できません。', ephemeral: true });
      }

      const created = await createPlaylist(guildId, name, interaction.user.id);
      if (!created) {
        return interaction.reply({ content: `⚠️ プレイリスト「${name}」は既に存在します。`, ephemeral: true });
      }

      await addTracksToPlaylist(created.id, snapshot);
      return interaction.reply(`💾 現在の再生内容（${snapshot.length}曲）をプレイリスト「${created.name}」として保存しました。`);
    }

    if (sub === 'play') {
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '⚠️ 先にボイスチャンネルに参加してください。', ephemeral: true });
      }

      const name = interaction.options.getString('name', true);
      const playlist = await getPlaylistByName(guildId, name);
      if (!playlist) {
        return interaction.reply({ content: `⚠️ プレイリスト「${name}」が見つかりません。`, ephemeral: true });
      }

      const tracks = await getPlaylistTracks(playlist.id);
      if (tracks.length === 0) {
        return interaction.reply({ content: `ℹ️ プレイリスト「${playlist.name}」に曲がありません。`, ephemeral: true });
      }

      await interaction.deferReply();
      await joinChannel(voiceChannel, interaction.channel);
      await enqueueMany(guildId, tracks, interaction.user.id);
      return interaction.editReply(`▶️ プレイリスト「${playlist.name}」（${tracks.length}曲）をキューに追加しました。`);
    }

    if (sub === 'list') {
      const playlists = await listPlaylists(guildId);
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📁 プレイリスト一覧');
      if (playlists.length === 0) {
        embed.setDescription('まだプレイリストがありません。`/playlist create` で作成できます。');
      } else {
        embed.setDescription(
          playlists.map((p, i) => `**${i + 1}. ${p.name}** — ${p.track_count}曲`).join('\n')
        );
      }
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'show') {
      const name = interaction.options.getString('name', true);
      const playlist = await getPlaylistByName(guildId, name);
      if (!playlist) {
        return interaction.reply({ content: `⚠️ プレイリスト「${name}」が見つかりません。`, ephemeral: true });
      }
      const tracks = await getPlaylistTracks(playlist.id);
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`📁 ${playlist.name}`);
      embed.setDescription(
        tracks.length === 0
          ? '（曲がありません）'
          : tracks.map((t) => `**${t.position}.** [${t.title}](${t.url})`).join('\n')
      );
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const name = interaction.options.getString('name', true);
      const position = interaction.options.getInteger('position', true);
      const playlist = await getPlaylistByName(guildId, name);
      if (!playlist) {
        return interaction.reply({ content: `⚠️ プレイリスト「${name}」が見つかりません。`, ephemeral: true });
      }
      const removed = await removeTrackFromPlaylist(playlist.id, position);
      if (!removed) {
        return interaction.reply({ content: `⚠️ 番号 ${position} の曲が見つかりませんでした。`, ephemeral: true });
      }
      return interaction.reply(`🗑️ 「${playlist.name}」から **${removed.title}** を削除しました。`);
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name', true);
      const deleted = await deletePlaylist(guildId, name);
      if (!deleted) {
        return interaction.reply({ content: `⚠️ プレイリスト「${name}」が見つかりません。`, ephemeral: true });
      }
      return interaction.reply(`🗑️ プレイリスト「${deleted.name}」を削除しました。`);
    }
  },
};
