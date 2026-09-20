const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getQueue,
  getManager,
  clearQueue,
  shuffleQueue,
  removeFromQueue,
  moveInQueue,
} = require('../musicManager');

const PAGE_SIZE = 10;

function formatQueueEmbed(guildId) {
  const m = getManager(guildId);
  const queue = getQueue(guildId);

  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📋 再生キュー');

  if (m?.current) {
    embed.addFields({
      name: '再生中',
      value: `[${m.current.title}](${m.current.url})${m.current.isAutoplay ? '（自動BGM）' : ''}`,
    });
  }

  if (queue.length === 0) {
    embed.addFields({ name: 'キュー', value: '（空です）' });
    return embed;
  }

  const lines = queue
    .slice(0, PAGE_SIZE)
    .map((t, i) => `**${i + 1}.** [${t.title}](${t.url})`)
    .join('\n');

  embed.addFields({
    name: `キュー（全${queue.length}曲${queue.length > PAGE_SIZE ? ` / 先頭${PAGE_SIZE}件を表示` : ''}）`,
    value: lines,
  });

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('再生キューの表示・編集を行います')
    .addSubcommand((sub) => sub.setName('show').setDescription('現在のキューを表示します'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('指定した順番の曲をキューから削除します')
        .addIntegerOption((opt) =>
          opt.setName('position').setDescription('削除する曲の番号（/queue showの番号）').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('move')
        .setDescription('キュー内の曲の順番を入れ替えます')
        .addIntegerOption((opt) =>
          opt.setName('from').setDescription('移動する曲の現在の番号').setRequired(true).setMinValue(1)
        )
        .addIntegerOption((opt) =>
          opt.setName('to').setDescription('移動先の番号').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) => sub.setName('clear').setDescription('キューをすべて空にします'))
    .addSubcommand((sub) => sub.setName('shuffle').setDescription('キューの順番をシャッフルします')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'show') {
      return interaction.reply({ embeds: [formatQueueEmbed(guildId)] });
    }

    if (sub === 'clear') {
      const count = clearQueue(guildId);
      return interaction.reply(`🗑️ キューから ${count} 曲を削除しました。`);
    }

    if (sub === 'shuffle') {
      const ok = shuffleQueue(guildId);
      if (!ok) return interaction.reply({ content: 'ℹ️ Botはまだ再生を開始していません。', ephemeral: true });
      return interaction.reply({ content: '🔀 キューをシャッフルしました。', embeds: [formatQueueEmbed(guildId)] });
    }

    if (sub === 'remove') {
      const position = interaction.options.getInteger('position', true);
      const removed = removeFromQueue(guildId, position);
      if (!removed) {
        return interaction.reply({ content: `⚠️ 番号 ${position} の曲は見つかりませんでした。`, ephemeral: true });
      }
      return interaction.reply(`🗑️ **${removed.title}** をキューから削除しました。`);
    }

    if (sub === 'move') {
      const from = interaction.options.getInteger('from', true);
      const to = interaction.options.getInteger('to', true);
      const ok = moveInQueue(guildId, from, to);
      if (!ok) {
        return interaction.reply({ content: '⚠️ 指定された番号が無効です。`/queue show` で番号を確認してください。', ephemeral: true });
      }
      return interaction.reply({ content: `↕️ 番号 ${from} → ${to} に移動しました。`, embeds: [formatQueueEmbed(guildId)] });
    }
  },
};
