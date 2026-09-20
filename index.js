require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { initDB } = require('./database');

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
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

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
