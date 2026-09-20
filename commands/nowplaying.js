const { SlashCommandBuilder } = require('discord.js');
const { buildNowPlayingEmbed, buildNowPlayingComponents, getManager } = require('../musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('現在再生中の曲と操作ボタンを表示します'),

  async execute(interaction) {
    const embed = buildNowPlayingEmbed(interaction.guildId);
    const components = buildNowPlayingComponents(interaction.guildId);

    await interaction.reply({ embeds: [embed], components });

    // 以後のボタン操作でこのメッセージを更新対象にする
    const m = getManager(interaction.guildId);
    if (m) {
      m.nowPlayingMessage = await interaction.fetchReply();
    }
  },
};
