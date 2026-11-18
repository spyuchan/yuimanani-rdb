# Vercel + Supernode 移行手順書（計画書）

この文書は、現在のローカル開発（Express + sqlite3）を維持したまま、本番環境では Supernode（マネージドな SQLite/HTTP 経由の libSQL 互換）を使って Vercel 上で稼働させるための「やることリスト」と注意点のまとめです。ここでは設計と手順のみを示し、実装はまだ行いません。

---

## ゴール
- ローカル開発: 既存どおり `sqlite3` を使用（`src/database.sqlite`）。
- 本番（Vercel）: Supernode を使用（HTTP 経由）。
- 同一のアプリケーションコードで、環境変数により DB を切り替える。

結論: 使い分けは可能。DB 抽象化（アダプタ）と環境変数切り替えで対応します。

---

## 変更の全体像（実装前の設計）
1. DB アダプタ層を導入
   - `src/db.js` を分割 or 内部で条件分岐し、下記 2 つの実装を切替可能にする。
     - LocalAdapter: 既存の `sqlite3` を使う実装
     - RemoteAdapter: Supernode（libSQL HTTP）クライアントを使う実装
   - どちらも同一の関数シグネチャを提供する: `getOrCreateUser`, `addPost`, `getLatestPosts`, `getNewPostsSince`。

2. 環境変数で切り替え
   - `DB_PROVIDER`: `local` | `supernode`（デフォルトは `local`）
   - `DATABASE_URL`: Supernode の接続 URL（例: `libsql://<host>` or `https://<host>` など提供元仕様）
   - `DATABASE_AUTH_TOKEN`: Supernode 用のトークン（必要な場合）

3. 依存関係
   - 追加: Supernode/libSQL 用の Node クライアント（例: `@libsql/client`）
   - 既存: `sqlite3` はローカルで引き続き使用。
   - 注意: Serverless 環境では `sqlite3` のネイティブバイナリを読み込まないよう、実行時分岐にする（`require` を条件分岐の内側に移動）。

4. Vercel デプロイ方式
   - シンプル案: Express を Vercel の Node ランタイム（Serverless Functions）へブリッジする。
     - `vercel.json` で `functions` の runtime を指定（例: `"nodejs20.x"`）。
     - `server.js` をハンドラ形式にエクスポートするか、`api/index.js` にエクスポート。
   - 代替案: Frontend は静的配信、API は `api/*.js` の Serverless Functions に分割（Express から移行）。

---

## 手順（実装前ガイド）

### 0. 前提確認
- Vercel アカウント/プロジェクトがあること
- Supernode（libSQL 互換のマネージド SQLite）で DB インスタンス作成済み
  - 接続 URL（`DATABASE_URL` 相当）と認証トークン（必要なら `DATABASE_AUTH_TOKEN`）を取得

### 1. DB 抽象化の設計
- `src/db.js` の公開 API を固定: 
  - `getOrCreateUser(username)`
  - `addPost(username, content)`
  - `getLatestPosts()`
  - `getNewPostsSince(lastId)`
- 実装はアダプタに委譲（Local/Remote）。
- `DB_PROVIDER` が `supernode` のとき RemoteAdapter を選択。それ以外は LocalAdapter。

実装ポイント（まだ実装しない）:
- LocalAdapter: 既存の `sqlite3` ロジックを移植。`require('sqlite3')` はアダプタ内部でのみ使う。
- RemoteAdapter: `@libsql/client` などのクライアントを利用し、同等の SQL を発行。
- SQL スキーマは同一に保つ（`users`, `posts`）。初期化処理は Local/Remote で分岐。

### 2. 依存の追加（実装段階で対応）
- `npm i @libsql/client`（または Supernode 提供の公式クライアント）
- 既存の `sqlite3` は残す（dev 用）。

### 3. 環境変数の整理
- ローカル（開発）:
  - `DB_PROVIDER=local`（省略可）
  - `NODE_ENV=development`
- 本番（Vercel）:
  - `DB_PROVIDER=supernode`
  - `DATABASE_URL=...`（Supernode のエンドポイント）
  - `DATABASE_AUTH_TOKEN=...`（必要な場合）
  - `NODE_ENV=production`

設定先:
- Vercel の Project Settings → Environment Variables に登録（Production/Preview/Development 必要に応じて）

### 4. Vercel への合わせ込み
オプション A: Express をそのまま Serverless 化
1. `vercel.json` を用意
   - 例:
     ```json
     {
       "functions": {
         "api/index.js": {
           "runtime": "nodejs20.x"
         }
       },
       "routes": [
         { "src": "/api/(.*)", "dest": "/api/index.js" },
         { "src": "/(.*)", "dest": "/index.html" }
       ]
     }
     ```
2. `api/index.js` を作成し、`server.js` の Express アプリをエクスポート
   - 例: `module.exports = app;` または `export default (req, res) => app(req, res);`
3. 静的ファイル（`index.html` など）はプロジェクトルート or `public/` に配置・配信

オプション B: API を関数へ分割（Express から移行）
1. `POST /api/login` など既存エンドポイントごとに `api/login.js` などを作成
2. 各関数内でアダプタを読み出して DB 操作
3. ルーティングは Vercel が自動で行う

推奨: まずはオプション A で最小変更、後に B へ段階移行も可。

### 5. 本番データベース（Supernode）初期化
- 初回起動時に必要なテーブルを作成する SQL を RemoteAdapter に実装
  - 例: `CREATE TABLE IF NOT EXISTS users (...); CREATE TABLE IF NOT EXISTS posts (...);`
  - Serverless のコールドスタートで毎回実行しても idempotent なら問題なし

### 6. ログ/監視
- Vercel の Function Logs を確認
- エラーハンドリングを `server.js` / 関数側に追加（500 の出力内容を簡潔に）

### 7. セキュリティ
- 認証トークン（`DATABASE_AUTH_TOKEN`）は必ず環境変数で注入し、リポジトリに含めない
- CORS や Cookie 設定（SameSite/secure）を本番向けに見直し

### 8. 動作確認チェックリスト
- ローカル（`DB_PROVIDER=local`）
  - `npm start` → ログイン/投稿/タイムラインが動作
  - `src/database.sqlite` が生成される
- プレビュー/本番（Vercel, `DB_PROVIDER=supernode`）
  - エンドポイントが 200 を返す
  - 新規投稿が DB に保存され、リロードで永続化を確認

---

## よくあるハマりどころ
- `sqlite3` を Serverless 上で読み込んでしまい失敗
  - 対策: `require('sqlite3')` を LocalAdapter 内部に限定し、`DB_PROVIDER=supernode` では一切読み込まない
- ネットワーク越しに Supernode へ接続できない/認証エラー
  - `DATABASE_URL` と `DATABASE_AUTH_TOKEN` を再確認（Vercel の環境変数で設定）
- Serverless でのコネクション管理
  - Connection は都度作成/破棄（HTTP）またはプール非依存のクライアントを使用

---

## 実装タスクリスト（この文書の次の段階で実施）
1. `src/db.js` をアダプタ構造に変更（Local/Remote の 2 実装）
2. RemoteAdapter に Supernode クライアントを導入し、SQL を実装
3. `server.js` から DB 呼び出しがアダプタ経由になるように修正
4. `vercel.json` 整備と `api/index.js`（ブリッジ）作成
5. Vercel 環境変数に `DB_PROVIDER`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN` を設定
6. 動作確認（ローカル→プレビュー→本番）

---

## まとめ
- ローカルは `sqlite3`、本番は Supernode による運用は可能。
- 重要なのは「アダプタで切替」「環境変数で制御」「Serverless でネイティブ依存を読み込まない」の 3 点。
- まずは最小実装（Express 温存 + Serverless ブリッジ）で公開し、その後必要に応じて Function へ分割・最適化するのが安全です。


