const { SlashCommandBuilder } = require('discord.js');
const { skip, getManager } = require('../musicManager');
const { checkSameVoiceChannel } = require('../utils/voiceCheck');

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('現在の曲をスキップします'),

  async execute(interaction) {
    const err = checkSameVoiceChannel(interaction);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    const m = getManager(interaction.guildId);
    const skippedTitle = m?.current?.title;
    const ok = await skip(interaction.guildId);
    if (!ok) return interaction.reply({ content: 'ℹ️ 再生中の曲がありません。', ephemeral: true });

    return interaction.reply(`⏭️ **${skippedTitle ?? '曲'}** をスキップしました。`);
  },
};
