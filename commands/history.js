const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getHistory } = require('../database');
const { joinChannel, enqueue } = require('../musicManager');

function formatHistoryEmbed(rows) {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🕘 再生履歴（新しい順）');

  if (rows.length === 0) {
    embed.setDescription('まだ再生履歴がありません。');
    return embed;
  }

  const lines = rows
    .map((r, i) => {
      const when = new Date(r.played_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      const tag = r.is_autoplay ? '（自動BGM）' : '';
      return `**${i + 1}.** [${r.title}](${r.url})${tag}\n<t:${Math.floor(new Date(r.played_at).getTime() / 1000)}:R>`;
    })
    .join('\n');

  embed.setDescription(lines);
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('このサーバーの再生履歴を表示・再キューします')
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('直近の再生履歴を表示します')
        .addIntegerOption((opt) =>
          opt.setName('count').setDescription('表示件数（デフォルト15、最大25）').setMinValue(1).setMaxValue(25)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('履歴の曲を再度キューに追加します')
        .addIntegerOption((opt) =>
          opt.setName('position').setDescription('/history show の番号').setRequired(true).setMinValue(1)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'show') {
      const count = interaction.options.getInteger('count') ?? 15;
      const rows = await getHistory(interaction.guildId, count);
      return interaction.reply({ embeds: [formatHistoryEmbed(rows)] });
    }

    if (sub === 'play') {
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '⚠️ 先にボイスチャンネルに参加してください。', ephemeral: true });
      }

      const position = interaction.options.getInteger('position', true);
      const rows = await getHistory(interaction.guildId, 25);
      const target = rows[position - 1];
      if (!target) {
        return interaction.reply({ content: `⚠️ 番号 ${position} の履歴が見つかりませんでした。`, ephemeral: true });
      }

      await interaction.deferReply();
      await joinChannel(voiceChannel, interaction.channel);
      await enqueue(interaction.guildId, { title: target.title, url: target.url, requestedBy: interaction.user.id });

      return interaction.editReply(`➕ 履歴から **${target.title}** をキューに追加しました。`);
    }
  },
};
