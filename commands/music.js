const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const { joinChannel, enqueue, getManager } = require('../musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('曲を検索してキューに追加し、再生します')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('曲名またはYouTubeのURL').setRequired(true)
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

    const query = interaction.options.getString('query', true);

    let title, url;
    if (play.yt_validate(query) === 'video') {
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

    await joinChannel(voiceChannel, interaction.channel);
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
