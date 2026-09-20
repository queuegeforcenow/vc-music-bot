const { SlashCommandBuilder } = require('discord.js');
const { stop, sendOrUpdateNowPlaying } = require('../musicManager');
const { checkSameVoiceChannel } = require('../utils/voiceCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('再生を停止し、キューをすべて空にします（VCからは退出しません）'),

  async execute(interaction) {
    const err = checkSameVoiceChannel(interaction);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    stop(interaction.guildId);
    await sendOrUpdateNowPlaying(interaction.guildId);
    return interaction.reply('⏹️ 再生を停止し、キューを空にしました。');
  },
};
