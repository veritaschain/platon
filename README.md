# Multi-AI Orchestrator

複数AIの思考を統合するエンジン - Opinionated Secure Orchestrator

## セットアップ

以下は新しい開発用環境の手順です。既存のDB・保存済みAPIキーを利用する更新では、先に
[PR #2の適用準備手順](docs/ROLLOUT-READINESS-20261106.md)で対象DBと鍵の互換性を確認してください。
検証済みのNode.jsは24.22.1です。詳しい手順は[セットアップガイド](SETUP.md)を参照してください。

### 1. 依存パッケージのインストール

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

### 2. 環境変数の設定

```bash
cp .env.local.example .env
```

新規checkoutの`.env`を編集して以下を設定します。`.env`はNext.jsとPrisma CLIで使用し、Git管理から除外されています。既存の環境ファイルを上書きしないでください。

- `NEXT_PUBLIC_SUPABASE_URL` - SupabaseプロジェクトURL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase Anonymous Key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase Service Role Key
- `DATABASE_URL` - PostgreSQL接続URL（Supabaseから取得）
- `DIRECT_URL` - Prismaの移行対象への接続URL（同じ開発用DBを指定）
- `ENCRYPTION_KEY` - 64文字のhex文字列（APIキー暗号化用）

暗号化キーの生成：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. データベースのセットアップ

接続先が新しい空の開発用DBであることを確認してから、コミット済みの移行を適用します。

```bash
npm run db:generate
npx --no-install prisma migrate deploy
```

`npm run db:migrate`は`prisma migrate dev`です。既存環境の更新手順には使わず、
評価テーブルや移行履歴がすでにある場合は[適用準備手順](docs/ROLLOUT-READINESS-20261106.md)の判定を先に行います。

### 4. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 にアクセス

## 機能

### Phase 1: Foundation ✅
- Next.js 15 App Router + TypeScript
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
Next.js 15 (App Router)
├── API Routes (/api/*)
├── Supabase Auth + PostgreSQL (Prisma)
├── AI Connectors (OpenAI / Anthropic / Google)
├── INTEGRATE Engine (Step 1 → 1.5 → 2)
└── Governance (PII / Cost / Loop / EventLog)
```

## デプロイ（Vercel）

既存環境へ適用する前に、[適用準備手順](docs/ROLLOUT-READINESS-20261106.md)で
DB移行履歴・保存済み暗号文との鍵互換性・Supabaseの認証とDBロールを確認します。
このリポジトリにはAmplify設定もあります。実際に利用するホスティング、環境変数、対象ブランチは別途確認が必要です。

## 技術スタック

- Next.js 15.5.29, React 19.2.9, TypeScript
- Zustand, TanStack Query
- Prisma, PostgreSQL (Supabase)
- Tailwind CSS, Radix UI
- OpenAI SDK, Anthropic SDK, Google Generative AI SDK

Next.js 15 への移行内容、検証手順、残存する依存関係の指摘は
[移行記録](docs/NEXT15-UPGRADE-20261105.md)を参照してください。
