const { SlashCommandBuilder } = require('discord.js');
const { leaveChannel } = require('../musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Botをボイスチャンネルから退出させます'),

  async execute(interaction) {
    const left = leaveChannel(interaction.guildId);
    if (!left) {
      return interaction.reply({ content: 'ℹ️ Botはボイスチャンネルに参加していません。', ephemeral: true });
    }
    return interaction.reply('👋 ボイスチャンネルから退出しました。');
  },
};
