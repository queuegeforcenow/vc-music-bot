const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const { joinChannel, enqueue, enqueueMany, resolveYoutubePlaylist, getManager } = require('../musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('曲を検索してキューに追加し、再生します（YouTubeプレイリストURLも対応）')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('曲名、YouTubeのURL、またはプレイリストURL').setRequired(true)
    ),

  async execute(interaction) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '⚠️ 先にボイスチャンネルに参加してください。',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');

if (!query) {
  return interaction.reply({
    content: '❌ 曲名またはYouTubeのURLを指定してください。',
    ephemeral: true,
  });
}
    const validType = play.yt_validate(query);

    await joinChannel(voiceChannel, interaction.channel);

    // YouTubeプレイリストURLの場合はまとめて取り込む
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

      await enqueueMany(interaction.guildId, tracks, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle('➕ プレイリストをキューに追加しました')
        .setDescription(`**${tracks.length}曲** を追加しました（先頭から順に再生されます）`);
      return interaction.editReply({ embeds: [embed] });
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

    await enqueue(interaction.guildId, { title, url, requestedBy: interaction.user.id });

    const m = getManager(interaction.guildId);
    const isNowPlaying = m.current && m.current.url === url && m.current.isAutoplay !== true;

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(isNowPlaying ? '▶️ 再生中' : '➕ キューに追加しました')
      .setDescription(`[${title}](${url})`);

    return interaction.editReply({ embeds: [embed] });
  },
};

