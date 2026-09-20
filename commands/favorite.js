const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const { addFavorite, getFavorites, removeFavoriteByPosition } = require('../database');
const { getManager, joinChannel, enqueue } = require('../musicManager');

function formatFavoritesEmbed(rows, userTag) {
  const embed = new EmbedBuilder().setColor(0xeb459e).setTitle(`⭐ ${userTag} のお気に入り`);

  if (rows.length === 0) {
    embed.setDescription('まだお気に入りが登録されていません。`/favorite add` で追加できます。');
    return embed;
  }

  const lines = rows.map((r, i) => `**${i + 1}.** [${r.title}](${r.url})`).join('\n');
  embed.setDescription(lines);
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('favorite')
    .setDescription('お気に入りの曲を登録・再生します（自分専用、サーバーごと）')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('お気に入りに追加します（未指定なら現在再生中の曲を追加）')
        .addStringOption((opt) => opt.setName('query').setDescription('曲名またはYouTubeのURL'))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('自分のお気に入り一覧を表示します'))
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('お気に入りの曲をキューに追加します')
        .addIntegerOption((opt) =>
          opt.setName('position').setDescription('/favorite list の番号（未指定ならランダム再生）').setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('お気に入りから削除します')
        .addIntegerOption((opt) =>
          opt.setName('position').setDescription('/favorite list の番号').setRequired(true).setMinValue(1)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (sub === 'add') {
      const query = interaction.options.getString('query');
      let title, url;

      if (!query) {
        const m = getManager(guildId);
        if (!m || !m.current) {
          return interaction.reply({
            content: '⚠️ 現在再生中の曲がありません。`query` を指定して追加してください。',
            ephemeral: true,
          });
        }
        title = m.current.title;
        url = m.current.url;
      } else {
        await interaction.deferReply();
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
      }

      const { favorite, alreadyExisted } = await addFavorite(guildId, userId, { title, url });
      const content = alreadyExisted
        ? `ℹ️ **${favorite.title}** は既にお気に入りに登録されています。`
        : `⭐ **${favorite.title}** をお気に入りに追加しました。`;

      if (interaction.deferred) return interaction.editReply(content);
      return interaction.reply(content);
    }

    if (sub === 'list') {
      const rows = await getFavorites(guildId, userId);
      return interaction.reply({ embeds: [formatFavoritesEmbed(rows, interaction.user.username)], ephemeral: true });
    }

    if (sub === 'play') {
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '⚠️ 先にボイスチャンネルに参加してください。', ephemeral: true });
      }

      const rows = await getFavorites(guildId, userId);
      if (rows.length === 0) {
        return interaction.reply({ content: 'ℹ️ お気に入りが登録されていません。', ephemeral: true });
      }

      const position = interaction.options.getInteger('position');
      const target = position ? rows[position - 1] : rows[Math.floor(Math.random() * rows.length)];
      if (!target) {
        return interaction.reply({ content: `⚠️ 番号 ${position} のお気に入りが見つかりませんでした。`, ephemeral: true });
      }

      await interaction.deferReply();
      await joinChannel(voiceChannel, interaction.channel);
      await enqueue(guildId, { title: target.title, url: target.url, requestedBy: userId });
      return interaction.editReply(`➕ お気に入りから **${target.title}** をキューに追加しました。`);
    }

    if (sub === 'remove') {
      const position = interaction.options.getInteger('position', true);
      const removed = await removeFavoriteByPosition(guildId, userId, position);
      if (!removed) {
        return interaction.reply({ content: `⚠️ 番号 ${position} のお気に入りが見つかりませんでした。`, ephemeral: true });
      }
      return interaction.reply({ content: `🗑️ **${removed.title}** をお気に入りから削除しました。`, ephemeral: true });
    }
  },
};
