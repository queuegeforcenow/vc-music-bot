const { SlashCommandBuilder } = require('discord.js');
const { setLoop, sendOrUpdateNowPlaying, LOOP_LABELS } = require('../musicManager');
const { checkSameVoiceChannel } = require('../utils/voiceCheck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('ループ再生モードを設定します')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('ループモード')
        .setRequired(true)
        .addChoices(
          { name: 'OFF', value: 'off' },
          { name: '1曲リピート', value: 'track' },
          { name: 'キューリピート', value: 'queue' }
        )
    ),

  async execute(interaction) {
    const err = checkSameVoiceChannel(interaction);
    if (err) return interaction.reply({ content: err, ephemeral: true });

    const mode = interaction.options.getString('mode', true);
    const applied = setLoop(interaction.guildId, mode);

    await sendOrUpdateNowPlaying(interaction.guildId);
    return interaction.reply(`🔁 ループモードを「${LOOP_LABELS[applied]}」に設定しました。`);
  },
};
