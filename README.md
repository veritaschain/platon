# Multi-AI Orchestrator

複数AIの思考を統合するエンジン - Opinionated Secure Orchestrator

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local`を編集して以下を設定：
- `NEXT_PUBLIC_SUPABASE_URL` - SupabaseプロジェクトURL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase Anonymous Key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase Service Role Key
- `DATABASE_URL` - PostgreSQL接続URL（Supabaseから取得）
- `ENCRYPTION_KEY` - 64文字のhex文字列（APIキー暗号化用）

暗号化キーの生成：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. データベースのセットアップ

```bash
npm run db:generate
npm run db:migrate
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 にアクセス

## 機能

### Phase 1: Foundation ✅
- Next.js 14 App Router + TypeScript
- Supabase Auth（メール/パスワード認証）
- 3ペインレイアウト（サイドバー・チャット・コストパネル）
- Prismaスキーマ（全テーブル）

### Phase 2: Core Chat + ガバナンス ✅
- BYOK（Bring Your Own Key）API管理
- OpenAI / Anthropic / Google コネクタ
- マルチモデル同時送信（最大3モデル）
- PIIマスキング（電話・メール・カード番号・マイナンバー）
- コスト制御 + degrade（上限80%で軽量モデルに切替）
- イベントログ（全操作をDBに記録）

### Phase 3: INTEGRATE ✅（心臓機能）
- Step 1: 構造抽出（安価モデルでJSON化）
- Step 1.5: ルールベース前処理（立場分類・コンフリクト抽出・重み付け・信頼構造分類）
- Step 2: 統合結論生成（高性能モデルで最終統合）
- IntegrateCard（信頼構造バー・高信頼/条件付き/不確実の視覚表示）
- フォールバック（Step 1失敗時の簡易統合）

### Phase 4: Handoff + Polish ✅
- VERIFY（別AIによる検証）
- DEBATE（2ステップ反論・再反論、強制停止）
- ループ検出（ハッシュ比較・チェーン上限3回）
- モードシステム（厳密検証 / 多角的レビュー）
- 上級者モード（モデル個別指定・手動ハンドオフ）
- レスポンシブ対応

## アーキテクチャ

```
Next.js 14 (App Router)
├── API Routes (/api/*)
├── Supabase Auth + PostgreSQL (Prisma)
├── AI Connectors (OpenAI / Anthropic / Google)
├── INTEGRATE Engine (Step 1 → 1.5 → 2)
└── Governance (PII / Cost / Loop / EventLog)
```

## デプロイ（Vercel）

1. GitHubにpush
2. Vercelでプロジェクトをインポート
3. 環境変数を設定
4. デプロイ

## 技術スタック

- Next.js 14, React 18, TypeScript
- Zustand, TanStack Query
- Prisma, PostgreSQL (Supabase)
- Tailwind CSS, Radix UI
- OpenAI SDK, Anthropic SDK, Google Generative AI SDK
