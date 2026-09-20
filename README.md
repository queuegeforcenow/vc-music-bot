# Discord 自動BGM Bot — セットアップ & Render デプロイ手順

## 構成
```
discord-bgm-bot/
├── index.js                # Bot本体（+ Render用ヘルスチェックHTTPサーバー + ボタン/無人化検知）
├── deploy-commands.js       # スラッシュコマンド登録スクリプト
├── database.js              # PostgreSQL アクセス層
├── musicManager.js           # 再生キュー・自動BGM・ループ・Now Playing UIのコアロジック
├── commands/
│   ├── settings.js           # /settings
│   ├── customautobgm.js      # /customautobgm
│   ├── join.js                # /join
│   ├── leave.js                # /leave
│   ├── music.js                 # /music
│   ├── queue.js                  # /queue（show/remove/move/clear/shuffle）
│   ├── nowplaying.js              # /nowplaying
│   ├── pause.js                    # /pause
│   ├── resume.js                    # /resume
│   ├── skip.js                       # /skip
│   ├── stop.js                        # /stop
│   ├── volume.js                       # /volume
│   ├── loop.js                          # /loop
│   ├── history.js                        # /history
│   ├── favorite.js                        # /favorite
│   └── playlist.js                         # /playlist
├── utils/
│   └── voiceCheck.js         # Botと同じVCにいるか確認する共通ヘルパー
├── package.json
├── render.yaml               # Render Blueprint（任意・自動構成用）
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
| `/queue show` | 全員 | 再生中の曲と現在のキューを表示 |
| `/queue remove position:` | Botと同じVC | 指定番号の曲をキューから削除 |
| `/queue move from: to:` | Botと同じVC | キュー内の曲の順番を入れ替え |
| `/queue clear` | Botと同じVC | キューをすべて空にする |
| `/queue shuffle` | Botと同じVC | キューの順番をシャッフル |
| `/nowplaying` | 全員 | 現在再生中の曲を操作ボタン付きで表示 |
| `/pause` / `/resume` | Botと同じVC | 一時停止 / 再開 |
| `/skip` | Botと同じVC | 現在の曲をスキップ |
| `/stop` | Botと同じVC | 再生停止＆キュークリア（VCからは退出しない） |
| `/volume percent:` | Botと同じVC | 現在の再生音量を変更（セッション限定） |
| `/loop mode:` | Botと同じVC | ループモード切替（OFF / 1曲リピート / キューリピート） |
| `/history show count:` | 全員 | 直近の再生履歴を表示（サーバー共通） |
| `/history play position:` | 全員 | 履歴の曲を再度キューに追加 |
| `/favorite add [query]` | 全員（自分専用） | お気に入りに追加（未指定なら再生中の曲） |
| `/favorite list` | 全員（自分専用） | 自分のお気に入り一覧を表示 |
| `/favorite play [position]` | 全員（自分専用） | お気に入りをキューに追加（未指定ならランダム） |
| `/favorite remove position:` | 全員（自分専用） | お気に入りから削除 |
| `/playlist create name:` | 全員 | 新規プレイリストを作成（サーバー共有） |
| `/playlist add name: query:` | 全員 | プレイリストに曲を追加（YouTubeプレイリストURL一括取り込み対応） |
| `/playlist save name:` | 全員 | 現在の再生中＋キューをまとめてプレイリスト保存 |
| `/playlist play name:` | 全員 | プレイリストの曲をすべてキューに追加 |
| `/playlist list` / `show name:` | 全員 | プレイリスト一覧・中身の表示 |
| `/playlist remove name: position:` | 全員 | プレイリストから1曲削除 |
| `/playlist delete name:` | 全員 | プレイリストごと削除 |

### Now Playing操作ボタン

`/join` や `/music` で再生を開始すると、実行したテキストチャンネルに **Now Playing** の埋め込みメッセージが自動送信・更新されます。以下のボタンで直接操作できます:

- ⏸️/▶️ 一時停止・再開
- ⏭️ スキップ
- ⏹️ 停止（キューもクリア）
- 🔁 ループモード切替（OFF → 1曲リピート → キューリピート）
- 🔉/🔊 音量 ±10%

ボタン操作は **Botと同じボイスチャンネルにいるユーザーのみ** 実行可能です（他人が勝手に操作するのを防止）。

### 便利機能（追加実装）

- **ループ再生**: `/loop` またはNow Playingのボタンで、1曲リピート／キューリピートを切り替え可能。
- **ボイスチャンネル無人化での自動退出**: Bot以外のメンバーが誰もいなくなったボイスチャンネルでは、5分後に自動的に退出します（無駄な接続の放置防止）。誰かが戻ってくればタイマーは自動キャンセルされます。
- **キュー並べ替え・削除・シャッフル**: `/queue` サブコマンドでキューを自由に編集可能。
- **セッション音量調整**: `/volume` やボタンで、`/settings` の既定音量とは別に今の再生だけ音量を変更可能。
- **再生履歴**: 再生されたすべての曲（自動BGM含む）を自動記録。`/history show` で確認、`/history play` で再キュー可能。
- **お気に入り（ユーザーごと）**: `/favorite add` で登録した曲を、`/favorite play` でいつでも呼び出し可能。
- **プレイリスト（サーバー共有）**: `/playlist create`〜`play` で名前付きプレイリストを作成・管理。単曲URL・検索キーワードに加え、**YouTubeプレイリストURLをまるごと取り込む**ことも可能（`/playlist add` にプレイリストURLを渡すだけ）。`/playlist save` で今流している内容をそのまま保存できます。`/music` コマンドに直接YouTubeプレイリストURLを渡した場合も、その場で全曲キューに追加されます。

## 5. 自動再生の仕様

以下3条件がすべて満たされたときに自動BGMが開始されます:
1. 再生中の通常曲が終了した
2. キューに通常曲が残っていない
3. 自動BGM設定が ON

`mode: genre` の場合は事前定義のキーワードでYouTube検索し先頭の動画を、`mode: recommend` の場合はおすすめキーワード候補からランダムに1つ選び検索、`mode: custom` の場合は保存済みリンクをそのまま再生します。

## 6. データベースについて（プレイリスト・履歴・お気に入り）

`track_history`（再生履歴）、`favorites`（お気に入り）、`playlists` / `playlist_tracks`（プレイリスト）のテーブルは、Bot起動時の `initDB()` で自動的に作成されます。既存のRender環境でも、コードを更新して再デプロイ（再起動）するだけで追加のテーブルが自動生成され、手動でのマイグレーション作業は不要です。

- お気に入りは **ユーザーごと・サーバーごと** に保存されます（他人からは見えません）。
- プレイリストは **サーバー共有** です（誰でも作成・追加・再生・削除が可能）。

## 7. 今後のさらなる拡張候補

- **投票スキップ（vote skip）**: VC参加者の過半数が賛成した場合のみスキップできるようにする
- **プレイリストの並べ替え・複製・他サーバーへのエクスポート**
- **お気に入りのプレイリスト化**（お気に入り全曲を一括でキューに追加）
- **複数サーバーでの同時再生数の可視化・管理コマンド**（Bot運用者向け）

これらも `musicManager.js` の `managers` Map、`database.js` のテーブル構成を土台に拡張可能です。
