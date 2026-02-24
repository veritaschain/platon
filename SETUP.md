# セットアップガイド

## 前提条件

- Node.js 18以上
- Supabaseアカウント

## ステップ1: パッケージインストール

```bash
npm install
```

## ステップ2: Supabaseプロジェクト作成

1. https://supabase.com にアクセス
2. 「New project」でプロジェクトを作成
3. Settings → API から以下を取得:
   - Project URL (`NEXT_PUBLIC_SUPABASE_URL`)
   - `anon` key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`)
4. Settings → Database から:
   - Connection string (`DATABASE_URL`) — Direct connectionを使用

## ステップ3: 環境変数設定

```bash
cp .env.example .env.local
```

`.env.local`を編集:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
DATABASE_URL=postgresql://postgres.xxxxxxxx:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres

# 暗号化キー生成コマンド:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_generated_64_char_hex
```

## ステップ4: DBマイグレーション

```bash
# Prismaクライアント生成
npm run db:generate

# DBにスキーマ適用
npm run db:push
```

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

```bash
# Vercel CLIインストール
npm i -g vercel

# デプロイ
vercel --prod
```

環境変数はVercelダッシュボード → Settings → Environment Variablesで設定。

---

## Phase 1 完了条件

- [x] `npm run dev` で起動確認
- [x] DBスキーマ (全テーブル migration)
- [x] Supabase Auth（ログイン/ログアウト）
- [x] 3ペインレイアウト（サイドバー+チャット+右パネル）
- [x] ガバナンス基盤（PII/コスト/ループ/イベントログ インターフェース確定）
