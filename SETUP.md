# セットアップガイド

## 前提条件

- Node.js 24.22.1（現在のCIで使用するバージョン）
- Supabaseアカウント

この手順は新しい開発用環境を対象にします。既存のDB・保存済みAPIキーを利用する更新は、
[PR #2の適用準備手順](docs/ROLLOUT-READINESS-20261106.md)から始めてください。

## ステップ1: パッケージインストール

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

## ステップ2: Supabaseプロジェクト作成

1. https://supabase.com にアクセス
2. 「New project」でプロジェクトを作成
3. Settings → API から以下を取得:
   - Project URL (`NEXT_PUBLIC_SUPABASE_URL`)
   - `anon` key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`)
4. Settings → Database から:
   - アプリ用接続 (`DATABASE_URL`) とPrisma移行用接続 (`DIRECT_URL`) — 同じ開発用DBを指定

## ステップ3: 環境変数設定

```bash
cp .env.local.example .env
```

新規checkoutの`.env`を編集します。Next.jsとPrisma CLIの両方が使用するファイルです。
`.env`はGit管理から除外されています。既存の環境ファイルを上書きせず、シェルやホスティング側の設定も含めて実際の接続先を確認してください。

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres

# 暗号化キー生成コマンド:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_generated_64_char_hex
```

## ステップ4: DBマイグレーション

接続先が新しい空の開発用DBであることを確認して実行します。

```bash
# Prismaクライアント生成
npm run db:generate

# コミット済みの移行を適用
npx --no-install prisma migrate deploy
```

`db:push`というnpmスクリプトはありません。`npm run db:migrate`は開発用の
`prisma migrate dev`であり、既存DBへの更新コマンドには使用しません。
評価テーブルがすでに存在する場合や、過去に`db push`を使用した場合は、
[移行履歴と実際の定義を照合](docs/ROLLOUT-READINESS-20261106.md#3-decide-the-migration-path-from-the-target-inventory)してから適用方法を決めます。

## ステップ5: Supabase Auth設定

Supabaseダッシュボード → Authentication → URL Configuration:
- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/auth/callback`

## ステップ6: 起動

```bash
npm run dev
```

→ http://localhost:3000 を開く

## ステップ7: APIキー登録

1. `/auth/signup` でアカウント作成
2. `/settings` でAPIキーを登録
   - OpenAI: https://platform.openai.com/api-keys
   - Anthropic: https://console.anthropic.com/settings/keys
   - Google: https://aistudio.google.com/apikey

## Vercelデプロイ

実際のホスティング先・対象ブランチ・環境変数の供給方法を確認します。リポジトリには
`amplify.yml`もありますが、配置されている設定ファイルだけでは現在の稼働先は判断できません。
既存環境への更新は、[適用準備手順](docs/ROLLOUT-READINESS-20261106.md)の証拠を揃えてから行います。

---

## Phase 1 完了条件

- [x] `npm run dev` で起動確認
- [x] Prismaスキーマとコミット済みの移行を用意（対象DBへの適用確認は別途必要）
- [x] Supabase Auth（ログイン/ログアウト）
- [x] 3ペインレイアウト（サイドバー+チャット+右パネル）
- [x] ガバナンス基盤（PII/コスト/ループ/イベントログ インターフェース確定）
