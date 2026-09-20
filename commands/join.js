const { SlashCommandBuilder } = require('discord.js');
const { joinChannel, playNext, getManager } = require('../musicManager');
const { getSettings } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('あなたが参加しているボイスチャンネルにBotを参加させます'),

  async execute(interaction) {
    const member = interaction.member;
    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: '⚠️ 先にボイスチャンネルに参加してください。',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    await joinChannel(voiceChannel, interaction.channel);

    const settings = await getSettings(interaction.guildId);
    const m = getManager(interaction.guildId);

    // 参加した時点で、キューが空かつ自動BGMがONなら自動再生を開始
    if (!m.current && m.queue.length === 0 && settings.auto_bgm && settings.mode !== 'off') {
      await playNext(interaction.guildId);
      return interaction.editReply(
        `🔊 **${voiceChannel.name}** に参加しました。自動BGMを再生します。`
      );
    }

    return interaction.editReply(`🔊 **${voiceChannel.name}** に参加しました。`);
  },
};
