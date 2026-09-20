require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`スラッシュコマンドを ${commands.length} 件登録します...`);

    if (process.env.GUILD_ID) {
      // 特定サーバーのみ（即時反映・開発向け）
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`✅ ギルド(${process.env.GUILD_ID})にコマンドを登録しました。`);
    } else {
      // グローバル登録（反映まで最大1時間程度）
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log('✅ グローバルコマンドを登録しました（反映まで時間がかかる場合があります）。');
    }
  } catch (error) {
    console.error(error);
  }
})();
