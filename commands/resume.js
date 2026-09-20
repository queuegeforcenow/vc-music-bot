const { SlashCommandBuilder } = require('discord.js');
const { resume, sendOrUpdateNowPlaying } = require('../musicManager');
const { checkSameVoiceChannel } = require('../utils/voiceCheck');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('一時停止した再生を再開します'),

  async execute(interaction) {
    const err = checkSameVoiceChannel(interaction);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    const ok = resume(interaction.guildId);
    if (!ok) return interaction.reply({ content: 'ℹ️ 再生中の曲がありません。', ephemeral: true });

    await sendOrUpdateNowPlaying(interaction.guildId);
    return interaction.reply('▶️ 再生を再開しました。');
  },
};
