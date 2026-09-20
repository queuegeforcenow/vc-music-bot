const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { upsertSettings, getSettings } = require('../database');
const { GENRE_KEYWORDS } = require('../musicManager');

const GENRE_CHOICES = [
  { name: 'チル', value: 'chill' },
  { name: '戦闘', value: 'battle' },
  { name: '集中', value: 'focus' },
  { name: '睡眠・雨音', value: 'sleep' },
  { name: '環境音', value: 'ambient' },
  { name: 'アップテンポ', value: 'uptempo' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('サーバーごとの自動BGM設定を行います')
    // サーバー管理権限を持つ人にだけデフォルトで表示（モデレーター制限）
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((opt) =>
      opt.setName('auto_bgm').setDescription('自動BGM機能のON/OFF')
    )
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('自動BGMのモード')
        .addChoices(
          { name: 'おすすめ', value: 'recommend' },
          { name: 'ジャンル指定', value: 'genre' },
          { name: 'カスタムリンク', value: 'custom' },
          { name: 'OFF', value: 'off' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('genre').setDescription('ジャンル（mode: genre のとき使用）').addChoices(...GENRE_CHOICES)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('volume')
        .setDescription('自動BGMの音量（1〜100%）')
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    // コマンド実行権限の二重チェック（Discord側のデフォルト権限に加え、コード側でも確認）
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '⚠️ このコマンドはサーバー管理者（モデレーター）のみが使用できます。',
        ephemeral: true,
      });
    }

    const autoBgm = interaction.options.getBoolean('auto_bgm');
    const mode = interaction.options.getString('mode');
    const genre = interaction.options.getString('genre');
    const volume = interaction.options.getInteger('volume');

    if (mode === 'genre' && !genre) {
      const current = await getSettings(interaction.guildId);
      if (!current.genre) {
        return interaction.reply({
          content: '⚠️ mode を「ジャンル指定」にする場合は genre も指定してください。',
          ephemeral: true,
        });
      }
    }

    const partial = {};
    if (autoBgm !== null) partial.auto_bgm = autoBgm;
    if (mode !== null) partial.mode = mode;
    if (genre !== null) partial.genre = genre;
    if (volume !== null) partial.volume = volume;

    const updated = await upsertSettings(interaction.guildId, partial);

    const embed = new EmbedBuilder()
      .setTitle('🎵 自動BGM設定を更新しました')
      .setColor(0x5865f2)
      .addFields(
        { name: '自動BGM', value: updated.auto_bgm ? 'ON' : 'OFF', inline: true },
        { name: 'モード', value: updated.mode, inline: true },
        { name: 'ジャンル', value: updated.genre ?? '未設定', inline: true },
        { name: '音量', value: `${updated.volume}%`, inline: true },
        {
          name: 'カスタムリンク',
          value: updated.custom_link ? updated.custom_link : '未設定',
          inline: false,
        }
      );

    return interaction.reply({ embeds: [embed] });
  },
};
