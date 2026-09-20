require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const { initDB } = require('./database');
const {
  getManager,
  pause,
  resume,
  skip,
  stop,
  cycleLoop,
  adjustLiveVolume,
  sendOrUpdateNowPlaying,
  scheduleEmptyLeaveCheck,
  clearEmptyTimer,
} = require('./musicManager');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once('ready', () => {
  console.log(`✅ ログイン完了: ${client.user.tag}`);

  // --- ここからステータスループのコード ---
  let statusIndex = 0;

  // 5秒（5000ミリ秒）ごとに切り替え
  setInterval(() => {
    if (statusIndex === 0) {
      // ステータス1: カスタムステータス
      client.user.setActivity({
        name: 'custom',
        type: ActivityType.Custom,
        state: 'developed by @vug2'
      });
    } else {
      // ステータス2
      const guildCount = client.guilds.cache.size;

      let listenerCount = 0;
      client.guilds.cache.forEach(guild => {
        const botVoiceChannel = guild.members.me?.voice?.channel;
        if (botVoiceChannel) {
          listenerCount += Math.max(0, botVoiceChannel.members.size - 1);
        }
      });

      // こちらもカスタムステータスに設定
      client.user.setActivity({
        name: 'custom',
        type: ActivityType.Custom,
        state: `${guildCount}サーバー｜${listenerCount}人と音楽を再生中`
      });
    }

    statusIndex = (statusIndex + 1) % 2;
  }, 5000);
  // --- 追加ここまで ---
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[コマンドエラー] ${interaction.commandName}`, err);
      const payload = { content: '❌ コマンドの実行中にエラーが発生しました。', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isButton()) {
    await handleMusicButton(interaction).catch(async (err) => {
      console.error('[ボタン処理エラー]', err);
      const payload = { content: '❌ 操作に失敗しました。', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    });
  }
});

// Now Playingメッセージのボタン操作
async function handleMusicButton(interaction) {
  const guildId = interaction.guildId;
  const m = getManager(guildId);

  // Botと同じボイスチャンネルにいるユーザーのみ操作可能にする
  const userChannelId = interaction.member?.voice?.channelId;
  if (!m || !m.voiceChannelId || userChannelId !== m.voiceChannelId) {
    return interaction.reply({
      content: '⚠️ Botと同じボイスチャンネルに参加してから操作してください。',
      ephemeral: true,
    });
  }

  switch (interaction.customId) {
    case 'music_pauseresume': {
      if (m.player.state.status === AudioPlayerStatus.Paused) resume(guildId);
      else pause(guildId);
      break;
    }
    case 'music_skip': {
      await skip(guildId);
      break;
    }
    case 'music_stop': {
      stop(guildId);
      break;
    }
    case 'music_loop': {
      cycleLoop(guildId);
      break;
    }
    case 'music_volume_up': {
      adjustLiveVolume(guildId, 10);
      break;
    }
    case 'music_volume_down': {
      adjustLiveVolume(guildId, -10);
      break;
    }
    default:
      return interaction.deferUpdate();
  }

  await sendOrUpdateNowPlaying(guildId);
  return interaction.deferUpdate();
}

// ボイスチャンネルにBotだけが残った場合、一定時間後に自動退出する
client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = (newState.guild || oldState.guild).id;
  const m = getManager(guildId);
  if (!m || !m.voiceChannelId) return;

  const affectedChannel =
    oldState.channelId === m.voiceChannelId
      ? oldState.channel
      : newState.channelId === m.voiceChannelId
      ? newState.channel
      : null;
  if (!affectedChannel) return;

  const humanCount = affectedChannel.members.filter((mem) => !mem.user.bot).size;
  if (humanCount === 0) {
    scheduleEmptyLeaveCheck(guildId, affectedChannel);
  } else {
    clearEmptyTimer(guildId);
  }
});

async function main() {
  await initDB();
  await client.login(process.env.DISCORD_TOKEN);
}

main().catch((err) => {
  console.error('起動に失敗しました', err);
  process.exit(1);
});

// --- Render の Web Service はHTTPポートへのバインドを要求するため、
//     ヘルスチェック用の最小限のHTTPサーバーを立てる ---
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Discord BGM Bot is running.');
  })
  .listen(PORT, () => {
    console.log(`[HTTP] ヘルスチェックサーバーがポート ${PORT} で待機中`);
  });
