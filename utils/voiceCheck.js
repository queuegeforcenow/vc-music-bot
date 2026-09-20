const { getManager } = require('../musicManager');

// 操作コマンドを実行するユーザーが、Botと同じボイスチャンネルにいるかを確認する。
// Botがそもそも参加していない場合や、ユーザーがVC未参加の場合はエラーメッセージを返す。
// 問題なければ null を返す。
function checkSameVoiceChannel(interaction) {
  const m = getManager(interaction.guildId);
  if (!m || !m.voiceChannelId) {
    return '⚠️ Botはまだボイスチャンネルに参加していません。';
  }

  const userChannelId = interaction.member.voice?.channelId;
  if (!userChannelId) {
    return '⚠️ 先にボイスチャンネルに参加してください。';
  }

  if (userChannelId !== m.voiceChannelId) {
    return '⚠️ Botと同じボイスチャンネルに参加してから操作してください。';
  }

  return null;
}

module.exports = { checkSameVoiceChannel };
