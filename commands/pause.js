const { SlashCommandBuilder } = require('discord.js');
const { pause, sendOrUpdateNowPlaying } = require('../musicManager');
const { checkSameVoiceChannel } = require('../utils/voiceCheck');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('再生を一時停止します'),

  async execute(interaction) {
    const err = checkSameVoiceChannel(interaction);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    const ok = pause(interaction.guildId);
    if (!ok) return interaction.reply({ content: 'ℹ️ 再生中の曲がありません。', ephemeral: true });

    await sendOrUpdateNowPlaying(interaction.guildId);
    return interaction.reply('⏸️ 一時停止しました。');
  },
};
