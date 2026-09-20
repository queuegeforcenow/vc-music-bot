const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const { joinChannel, enqueue, enqueueMany, resolveYoutubePlaylist, getManager } = require('../musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('曲を検索してキューに追加し、再生します（YouTubeプレイリストURLも対応）')
    .addStringOption((opt) =>
      opt.setName('link').setDescription('曲名、YouTubeのURL、またはプレイリストURL').setRequired(true)
    ),

  async execute(interaction) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '⚠️ 先にボイスチャンネルに参加してください。',
        ephemeral: true,
      });
    }

    const link = interaction.options.getString('link');
    if (!link) {
      return interaction.reply({
        content: '❌ 曲名またはYouTubeのURLを指定してください。',
        ephemeral: true,
      });
    }

    // ここで初めて deferReply を呼ぶ
    await interaction.deferReply();

    const validType = play.yt_validate(link);
    await joinChannel(voiceChannel, interaction.channel);

    if (validType === 'playlist') {
      let tracks;
      try {
        tracks = await resolveYoutubePlaylist(link);
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
      const info = await play.video_basic_info(link);
      title = info.video_details.title;
      url = info.video_details.url;
    } else {
      const results = await play.search(link, { source: { youtube: 'video' }, limit: 1 });
      if (!results || results.length === 0) {
        return interaction.editReply('❌ 曲が見つかりませんでした。');
      }
      
      const target = results[0];
      title = target.title;
      // URLが直接ない場合はidから生成、または target.url を使用
      url = target.url || (target.id ? `https://www.youtube.com/watch?v=${target.id}` : null);
    }

    // デバッグ用ログ＆URLの空チェック
    console.log(`[追加] タイトル: ${title}, URL: ${url}`);
    if (!url) {
      return interaction.editReply('❌ 曲のURLの取得に失敗しました。');
    }

    await enqueue(interaction.guildId, { title, url, requestedBy: interaction.user.tag });

    const m = getManager(interaction.guildId);
    const isNowPlaying = m.current && m.current.url === url && m.current.isAutoplay !== true;

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(isNowPlaying ? '▶️ 再生中' : '➕ キューに追加しました')
      .setDescription(`[${title}](${url})`);

    return interaction.editReply({ embeds: [embed] });
  },
};
