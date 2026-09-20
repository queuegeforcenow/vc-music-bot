const { SlashCommandBuilder } = require('discord.js');
const { setLiveVolume, sendOrUpdateNowPlaying } = require('../musicManager');
const { checkSameVoiceChannel } = require('../utils/voiceCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('現在の再生音量を変更します（このセッションのみ有効）')
    .addIntegerOption((opt) =>
      opt.setName('percent').setDescription('音量（0〜100%）').setRequired(true).setMinValue(0).setMaxValue(100)
    ),

  async execute(interaction) {
    const err = checkSameVoiceChannel(interaction);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    const percent = interaction.options.getInteger('percent', true);
    const applied = setLiveVolume(interaction.guildId, percent);
    if (applied === null) {
      return interaction.reply({ content: 'ℹ️ Botはまだ参加していません。', ephemeral: true });
    }

    await sendOrUpdateNowPlaying(interaction.guildId);
    return interaction.reply(`🔊 音量を ${applied}% に設定しました。`);
  },
};
