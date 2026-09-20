# Discord 自動BGM Bot — セットアップ & Render デプロイ手順

## 構成
```
discord-bgm-bot/
├── index.js              # Bot本体（+ Render用ヘルスチェックHTTPサーバー）
├── deploy-commands.js     # スラッシュコマンド登録スクリプト
├── database.js            # PostgreSQL アクセス層
├── musicManager.js         # 再生キュー・自動BGMのコアロジック
├── commands/
│   ├── settings.js         # /settings
│   ├── customautobgm.js    # /customautobgm
│   ├── join.js              # /join
│   ├── leave.js             # /leave
│   └── music.js             # /music
├── package.json
├── render.yaml             # Render Blueprint（任意・自動構成用）
└── .env.example
```

---

## 1. Discord Developer Portal での準備

1. https://discord.com/developers/applications で新規アプリケーションを作成。
2. 「Bot」タブで Bot を作成し、**Token** をコピー（`DISCORD_TOKEN`）。
3. 同タブの **Privileged Gateway Intents** で以下をON:
   - `SERVER MEMBERS INTENT` は不要（本Botでは未使用）
   - `MESSAGE CONTENT INTENT` も不要（スラッシュコマンドのみ使用）
   - ※ボイスチャンネル参加自体には特別なIntent許可は不要です
4. 「OAuth2」タブの **General** で `CLIENT ID` をコピー（`CLIENT_ID`）。
5. 「OAuth2 → URL Generator」で以下を選択し、招待URLを作成してBotをサーバーに招待:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Embed Links`, `Use Slash Commands`

---

## 2. ローカルでの動作確認（任意）

```bash
cd discord-bgm-bot
npm install
cp .env.example .env
# .env に DISCORD_TOKEN / CLIENT_ID / DATABASE_URL を記入

npm run deploy   # スラッシュコマンドを登録（GUILD_ID指定なら即時反映）
npm start        # Bot起動
```

ローカルにPostgreSQLがない場合は、後述のRenderのPostgreSQL（無料枠）を先に作成し、その接続文字列を `.env` の `DATABASE_URL` に使っても構いません。

---

## 3. Render へのデプロイ

Discord Botは常時起動が必要なプロセスです。RenderではHTTPポートへのバインドが必須の **Web Service** として動かすのが最も簡単なため、`index.js` にヘルスチェック用の最小HTTPサーバーを同梱しています（Discord Bot自体の動作には影響しません）。

### 方法A: render.yaml を使って自動構成（おすすめ）

1. このプロジェクトをGitHubリポジトリにpush。
2. Render ダッシュボード → **New +** → **Blueprint** を選択し、そのリポジトリを指定。
3. `render.yaml` が自動検出され、Web Service（Bot本体）とPostgreSQL（無料枠）が同時に作成されます。
4. デプロイ前に環境変数の入力を求められるので、`DISCORD_TOKEN` と `CLIENT_ID` を入力（`DATABASE_URL` はPostgreSQLから自動連携されます）。
5. デプロイ完了後、Renderの **Shell** タブ（またはローカルから対象の`.env`で）で一度だけ実行:
   ```bash
   npm run deploy
   ```
   これでスラッシュコマンドがDiscordに登録されます。

### 方法B: 手動でWeb Serviceを作成

1. GitHubにpush後、Render ダッシュボード → **New +** → **Web Service**。
2. リポジトリを選択し、以下を設定:
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Instance Type**: Free で可
3. **Environment** タブで環境変数を追加:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `DATABASE_URL`（後述のPostgreSQLの接続文字列）
   - `GUILD_ID`（任意・特定サーバーのみでコマンドを即時反映したい場合）
4. Render ダッシュボード → **New +** → **PostgreSQL** で無料のDBインスタンスを作成し、発行された **Internal Connection String** を上記 `DATABASE_URL` に設定。
5. デプロイ完了後、RenderのShellタブから一度だけ:
   ```bash
   npm run deploy
   ```

### 注意点（Render特有）

- **Free Web Serviceのスリープ**: Renderの無料Web Serviceは一定時間アクセスが無いとスリープします。Botを常時起動させたい場合は、有料プラン（Starter以上）へのアップグレードを推奨します。もしくは、外部の死活監視サービス（UptimeRobot等）でヘルスチェックURL（`https://<あなたのアプリ>.onrender.com/`）に定期アクセスさせてスリープを防ぐ方法もありますが、Renderの利用規約・仕様変更に留意してください。
- **音声再生（FFmpeg）**: `ffmpeg-static` を依存関係に含めているため、Render上でも追加インストール不要でFFmpegが利用できます。
- **スラッシュコマンドの反映**: コードを更新しても、コマンドの定義（名前・オプション等）自体を変えた場合は再度 `npm run deploy` の実行が必要です（Bot再起動だけでは反映されません）。

---

## 4. コマンド一覧

| コマンド | 権限 | 内容 |
|---|---|---|
| `/settings auto_bgm mode genre volume` | サーバー管理者のみ | 自動BGMのON/OFF・モード・ジャンル・音量を設定 |
| `/customautobgm link volume` | サーバー管理者のみ | カスタムYouTubeリンクを自動BGMとして保存（保存後、自動BGMは自動でON） |
| `/join` | 全員 | Botをボイスチャンネルに参加させる（自動BGM設定がONならその場で再生開始） |
| `/leave` | 全員 | Botをボイスチャンネルから退出させる |
| `/music query` | 全員 | 曲を検索してキューに追加・再生 |

## 5. 自動再生の仕様

以下3条件がすべて満たされたときに自動BGMが開始されます:
1. 再生中の通常曲が終了した
2. キューに通常曲が残っていない
3. 自動BGM設定が ON

`mode: genre` の場合は事前定義のキーワードでYouTube検索し先頭の動画を、`mode: recommend` の場合はおすすめキーワード候補からランダムに1つ選び検索、`mode: custom` の場合は保存済みリンクをそのまま再生します。

## 6. 今後の拡張候補（レポート記載分・未実装）

- キュー管理コマンド（表示・削除・並べ替え）
- Now Playing / 再生コントロールボタン（一時停止・スキップ・音量調整をUIから操作）

これらは `musicManager.js` の `queue` 配列と `player` を土台に、`/queue` コマンドやボタンコンポーネント（`ButtonBuilder` + `interactionCreate` の `isButton()` 分岐）を追加する形で拡張可能です。
