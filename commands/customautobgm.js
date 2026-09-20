const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const { upsertSettings } = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('customautobgm')
    .setDescription('YouTube / YouTube Music のリンクをこのサーバーの自動BGMとして保存します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt.setName('link').setDescription('YouTube または YouTube Music のURL').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('volume').setDescription('自動BGMの音量（1〜100%）').setMinValue(1).setMaxValue(100)
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '⚠️ このコマンドはサーバー管理者（モデレーター）のみが使用できます。',
        ephemeral: true,
      });
    }

    const link = interaction.options.getString('link', true);
    const volume = interaction.options.getInteger('volume');

    const validType = play.yt_validate(link);
    if (validType !== 'video' && validType !== 'playlist') {
      return interaction.reply({
        content: '⚠️ 有効な YouTube / YouTube Music のリンクを指定してください。',
        ephemeral: true,
      });
    }

    const partial = {
      mode: 'custom',
      custom_link: link,
      auto_bgm: true, // 保存後、自動BGMは自動的にONになる
    };
    if (volume !== null) partial.volume = volume;

    const updated = await upsertSettings(interaction.guildId, partial);

    const embed = new EmbedBuilder()
      .setTitle('🔗 カスタム自動BGMを保存しました')
      .setColor(0x57f287)
      .setDescription('自動BGMは自動的にONになりました。')
      .addFields(
        { name: 'リンク', value: updated.custom_link },
        { name: '音量', value: `${updated.volume}%`, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  },
};
