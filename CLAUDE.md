# Platon AI Eval — 統合MVP仕様書

**AI Model Evaluation Platform**

| 項目 | 内容 |
|---|---|
| Version | 2.0.0 (MVP) |
| 作成日 | 2026-03-03 |
| ステータス | Draft |
| デプロイ | Vercel + Supabase |
| 対象 | AIモデル選定を行うPM・エンジニア・事業責任者 |

---

## 1. プロダクト定義

### 1.1 ワンライナー

**「あなたのタスクで、どのAIが一番使えるかを定量的に答えるツール」**

### 1.2 プロダクトの心臓

**ユースケース特化型のAIモデル評価エンジン**。汎用ベンチマーク（MMLU等）ではなく、ユーザー固有のタスクに対する実践的な評価ができる点が最大の差別化。ヒアリング→プロンプトセット自動生成→一括評価→構造化レポートの一気通貫体験を提供する。

### 1.3 解決する課題

| 課題 | 具体例 |
|---|---|
| どのAIモデルを選べばいいかわからない | 汎用ベンチマークのスコアは自社タスクに直結しない |
| モデル比較に膨大な手間がかかる | 手動で何十回もテストしてスプレッドシートで比較している |
| 評価用プロンプトの設計が難しい | 何を聞けばモデルの良し悪しがわかるのか自体がわからない |
| 比較結果を社内で共有しにくい | 上長への説明資料を別途作る手間 |
| 複数プロバイダーのコスト予測ができない | 実運用時のコストが見えないまま選定してしまう |

### 1.4 設計原則

1. **評価の民主化** — AI専門家でなくてもモデル選定ができる。ヒアリング対話で参入障壁を下げる
2. **ユースケース・ファースト** — 汎用スコアではなく「あなたのタスク」での評価を最優先する
3. **根拠付きの結論** — 「なぜこのモデルが最適か」を構造化データで示す。スコアだけでなく理由を出す
4. **BYOK前提** — ユーザーが各プロバイダーのAPIキーを持ち込む。プラットフォームはオーケストレーションに徹する
5. **ガバナンスはインフラ** — PIIマスキング、コスト制御は常時ON・設定UIなし

### 1.5 競合ポジショニング

| 領域 | 既存 | 本製品の位置づけ |
|---|---|---|
| LLMベンチマーク | MMLU, HumanEval, Chatbot Arena | 汎用ベンチマーク。自社タスクとの乖離が大きい |
| LLMオブザーバビリティ | Langfuse, Helicone, Braintrust | プロンプト管理・モニタリング中心。モデル選定の意思決定支援は弱い |
| マルチAIチャット | ChatHub, TypingMind, Poe | 並列表示まで。構造化された比較評価はない |
| **AI モデル評価** | **存在しない** | **★ ヒアリング→自動生成→一括評価→レポートの一気通貫体験** |

---

## 2. ユーザー体験設計

### 2.1 ターゲットユーザー

**層1: プロダクトマネージャー / 事業責任者（メイン）**

「AIを導入したいがどのモデルがいいかわからない」人。ヒアリング→自動生成→レポートのフローがドンピシャで刺さる。PDF/Markdownエクスポートで社内稟議にそのまま使える。

**層2: エンジニア / テックリード（メイン）**

自社プロダクトに組み込むモデルを技術的に評価したい人。カスタムプロンプトのインポートを使い、精密に比較する。レイテンシP95やフォーマット準拠率等の技術指標を重視する。

**層3: AIコンサルタント / SIer（V2以降）**

クライアントのAI導入を支援する立場。レポートのエクスポートを納品物として使う。

### 2.2 コアフロー

```
[Step 1] プロジェクト作成 + ヒアリング or プロンプトインポート
    ↓
[Step 2] プロンプトセット確認・編集（任意）
    ↓
[Step 3] 対象モデル選択 + コスト見積もり確認
    ↓
[Step 4] 一括評価実行（進捗リアルタイム表示）
    ↓
[Step 5] 評価レポート閲覧 + エクスポート
```

### 2.3 プロンプトセットの2つの入口

**入口A: ヒアリング自動生成（推奨）**

3〜5問のヒアリングに答えるだけで、AIが評価用プロンプトセット（15〜20問）を自動生成する。非専門家でもすぐ始められる。

**入口B: カスタムインポート**

ユーザーが自作のプロンプトセットをCSV/JSONでアップロードする。自社の実際のプロンプトで精密に評価したいエンジニア向け。

### 2.4 レイアウト

デスクトップファーストの2ペイン構成。チャットUIではなくダッシュボード型。

| エリア | 内容 |
|---|---|
| 左サイドバー（280px、折りたたみ可） | プロジェクト一覧、新規作成、設定リンク |
| メインエリア（フレキシブル） | フロー画面（ヒアリング/プロンプト編集/実行/レポート） |

レスポンシブ:

| ブレークポイント | レイアウト |
|---|---|
| ≥1024px | 2ペイン |
| <1024px | 1ペイン（サイドバー折りたたみ） |

### 2.5 主要UIコンポーネント

**OnboardingWizard（ヒアリングUI）**

| 要素 | 説明 |
|---|---|
| 質問カード | 1問ずつ表示。選択式中心でテキスト入力は最小限 |
| プログレスバー | 全5問中の進捗 |
| スキップ | 任意回答の質問はスキップ可能 |

**PromptSetEditor（プロンプトセット確認・編集UI）**

| 要素 | 説明 |
|---|---|
| プロンプト一覧 | カテゴリ別にグループ化して表示 |
| 個別編集 | インラインで文面を編集可能 |
| 追加/削除 | プロンプトの追加・削除 |
| カテゴリバッジ | 各プロンプトの評価カテゴリを色分け表示 |
| 「そのまま実行」ボタン | 編集せずにそのまま評価に進めるCTA |

**EvalProgress（評価実行中UI）**

| 要素 | 説明 |
|---|---|
| 全体プログレスバー | 完了率（例: 45/60 リクエスト完了） |
| モデル別ステータス | 各モデルの進捗（完了/実行中/エラー） |
| リアルタイムログ | 完了したリクエストのレイテンシ・ステータスを逐次表示 |
| 推定残り時間 | 現在の処理速度から算出 |

**EvalReport（評価レポートUI — 核心）**

| セクション | 説明 |
|---|---|
| 推奨モデル | 総合スコア付きのランキング。最も重要な結論を最初に表示 |
| スコア比較テーブル | 全指標×全モデルの横並び比較。色分け（緑/黄/赤） |
| レーダーチャート | 軸別の強み・弱みを視覚化 |
| 注目回答例 | 最も差が出た質問をピックアップ。各モデルの実回答を並列表示 |
| コスト試算 | 月次利用想定でのコスト比較 |
| 推奨アクション | AI生成の具体的ネクストステップ |
| エクスポートボタン | PDF / Markdown ダウンロード |

---

## 3. プロンプトセット生成パイプライン

### 3.1 ヒアリング質問（5問）

| # | 質問 | 形式 | 用途 |
|---|---|---|---|
| Q1 | AIを何に使いたいですか？ | 選択式（カスタマーサポート/コード生成/文書要約/翻訳/データ分析/その他） | ドメイン決定 |
| Q2 | 対象ユーザーは？ | 選択式（社内チーム/一般消費者/専門家/その他） | トーン・難易度調整 |
| Q3 | 回答に求める性格は？（複数選択可） | 複数選択（正確さ重視/スピード重視/丁寧さ重視/創造性重視/簡潔さ重視） | 評価軸の重み付け |
| Q4 | 業界・ドメインは？ | 選択式+自由記述 | ドメイン知識テスト生成 |
| Q5 | 絶対に外せないポイント、NGなことは？ | 自由記述 | エッジケース生成、制約条件 |

### 3.2 生成パイプライン

**Stage 1: ヒアリング → ユースケースプロファイル生成（LLM 1回）**

ヒアリング回答をLLMに渡し、構造化されたユースケースプロファイルをJSON形式で出力する。

```json
{
  "domain": "EC / カスタマーサポート",
  "audience": "一般消費者",
  "priority": ["accuracy", "tone"],
  "constraints": ["敬語必須", "返品ポリシーに準拠した回答"],
  "risk_factors": ["誤った返品案内は実害に直結"],
  "output_format": "自然文（チャット形式）",
  "language": "日本語"
}
```

**Stage 2: 評価マトリクス生成（ルールベース、LLM不使用）**

ユースケースプロファイルのpriority設定に基づき、20問の配分をコードで決定する。

基本配分:

| カテゴリ | 基本問数 | 説明 |
|---|---|---|
| accuracy（正確性） | 4問 | 事実確認、数値、ドメイン知識 |
| relevance（関連性） | 3問 | 曖昧な質問、文脈理解、意図の汲み取り |
| conciseness（簡潔性） | 3問 | 適切な長さの回答を返すか |
| tone（トーン適切性） | 3問 | 指定トーンを維持できるか |
| instruction_following（指示遵守） | 4問 | フォーマット指定、制約条件、複合指示 |
| edge_case（エッジケース） | 3問 | 矛盾入力、情報不足、回答拒否すべきケース |

priority に指定された軸は+2問、それ以外の軸から-1問ずつ調整。合計は常に20問。

**Stage 3: プロンプト生成（LLM 1回）**

Stage 2のマトリクスとユースケースプロファイルをLLMに渡し、具体的なプロンプトを生成する。

出力形式:

```json
[
  {
    "id": "p01",
    "category": "accuracy",
    "prompt": "実際のプロンプト文",
    "evaluation_focus": "何を評価するかの1文説明",
    "gold_standard_hint": "理想的な回答の方向性（採点の参考用）"
  }
]
```

`gold_standard_hint` はユーザーには非表示。ジャッジモデルの採点精度向上のために内部的に使用する。

### 3.3 ドメイン別シードプロンプト（MVP）

完全ゼロから生成すると品質のばらつきが大きいため、ドメインごとにシードプロンプトを3〜5問用意する。LLMはシードを参考にしつつ残りを生成する。

MVP対応ドメイン: カスタマーサポート、コード生成、文書要約の3種。

### 3.4 品質ガードレール

| ガードレール | 方式 | 処理 |
|---|---|---|
| JSONバリデーション | コード | パース失敗時リトライ（最大2回） |
| カテゴリ数チェック | コード | 配分と実際の問数を照合。不足カテゴリのみ再生成 |
| 重複検出 | コード | プロンプト間の文字列類似度チェック。閾値超えで再生成 |
| 長さチェック | コード | 極端に短い（<10文字）/長い（>500文字）プロンプトを警告 |

### 3.5 カスタムインポート仕様

CSV/JSONで以下の形式を受け付ける。

CSV形式:

```csv
prompt,category,gold_standard_hint
"返品手続きの方法を教えてください",accuracy,"返品ポリシーに基づいた正確な手順"
"ちょっと困ってるんだけど...",relevance,""
```

- `prompt`（必須）: プロンプト本文
- `category`（任意）: 評価カテゴリ。未指定時は`general`として扱う
- `gold_standard_hint`（任意）: 期待回答の方向性

### 3.6 コスト

プロンプトセット生成にかかるLLM呼び出しは2回（Stage 1 + Stage 3）。安価モデル（gpt-4o-mini等）で十分。推定コスト: $0.005以下/回。

---

## 4. 評価エンジン

### 4.1 実行フロー

```
評価開始
    ↓
[Phase 1] 一括実行
    全プロンプト × 全モデルを Promise.allSettled で並列実行
    20問 × 3モデル = 60リクエスト
    SSEで進捗をリアルタイム通知
    ↓
[Phase 2] 客観指標計算（コード処理、LLM不使用）
    レイテンシ、コスト、エラー率、フォーマット準拠率、安定性
    ↓
[Phase 3] 品質採点（LLM-as-a-Judge）
    全ModelResponseをジャッジモデルに送信
    5軸 × 1-5点で採点
    ↓
[Phase 4] スコア統合 + レポート生成
    ルールベース集計 → 推奨アクションのみLLM生成
    ↓
EvalReport保存 + 完了通知
```

### 4.2 客観指標（Phase 2）

コード処理のみ。LLM不使用。コストゼロ。

| 指標 | 算出方法 | 用途 |
|---|---|---|
| レイテンシ | 各回答の応答時間。中央値とP95を算出 | リアルタイム用途の適性判断 |
| コスト | 入出力トークン × 単価（Connector.estimateCost使用） | コスト効率比較 |
| エラー率 | (FAILED + TIMEOUT + REFUSED) / 全リクエスト数 | 信頼性指標 |
| フォーマット準拠率 | JSON出力指定等の構造指示に対して正しくパースできた割合 | API統合時の安定性 |
| 出力安定性 | 同一プロンプト3回投入時の出力長の変動係数 | プロダクション運用の予測可能性 |

### 4.3 品質指標（Phase 3: LLM-as-a-Judge）

**評価軸（5軸、各1-5点）**

| 軸 | 説明 | 採点基準 |
|---|---|---|
| accuracy（正確性） | 事実として正しいか | 5=完全に正確、1=重大な誤り |
| relevance（関連性） | 質問の意図に沿っているか | 5=的確、1=的外れ |
| conciseness（簡潔性） | 適切な長さか | 5=過不足なし、1=冗長or不足 |
| tone（トーン適切性） | ユースケースに合ったトーンか | 5=完璧、1=不適切 |
| instruction_following（指示遵守） | 指示通りの形式・制約を守っているか | 5=完全遵守、1=無視 |

**採点プロンプト**

```
あなたはAI回答の品質評価者です。
以下のユーザー質問とAIの回答を評価してください。

## ユーザーのユースケース
{{useCaseDescription}}

## 理想的な回答の方向性
{{goldStandardHint}}

## 評価対象の質問
{{prompt}}

## AIの回答
{{response}}

以下の5軸で1-5点で採点し、JSON形式のみで出力してください。

{
  "accuracy": { "score": 1-5, "reason": "1文で根拠" },
  "relevance": { "score": 1-5, "reason": "..." },
  "conciseness": { "score": 1-5, "reason": "..." },
  "tone": { "score": 1-5, "reason": "..." },
  "instruction_following": { "score": 1-5, "reason": "..." }
}
```

**ジャッジモデルの選定ルール（MVP）**

ジャッジモデルは評価対象に含めない。評価対象がGPT-4o、Claude Sonnet、Gemini Proの場合、ジャッジにはClaude Haiku等の軽量モデルを使用する。V2でクロスジャッジ（2モデル相互採点）を導入しバイアスを軽減する。

### 4.4 総合スコア算出（Phase 4）

**Step 1: 各指標の正規化**

客観指標と品質指標をすべて0-10スケールに正規化する。

品質指標: (5軸平均 / 5) × 10
レイテンシ: 最速モデルを10、最遅を0とした線形スケール
コスト: 最安モデルを10、最高を0とした線形スケール
エラー率: (1 - エラー率) × 10
フォーマット準拠率: 準拠率 × 10
安定性: (1 - 変動係数) × 10（下限0）

**Step 2: ユースケース重み付け**

ヒアリングのQ3（回答に求める性格）の回答に基づき、各指標の重みを自動決定する。

| 重み付けプリセット例 | accuracy | relevance | conciseness | tone | instruction | latency | cost |
|---|---|---|---|---|---|---|---|
| 正確さ重視 | 0.25 | 0.15 | 0.10 | 0.10 | 0.15 | 0.10 | 0.15 |
| 丁寧さ重視 | 0.15 | 0.15 | 0.10 | 0.25 | 0.10 | 0.10 | 0.15 |
| スピード重視 | 0.15 | 0.15 | 0.15 | 0.05 | 0.10 | 0.25 | 0.15 |
| 簡潔さ重視 | 0.15 | 0.15 | 0.25 | 0.05 | 0.15 | 0.10 | 0.15 |

**Step 3: 総合スコア**

```
総合スコア = Σ(正規化スコア_i × 重み_i)
```

結果は0-10で表示。

### 4.5 コスト構造

| フェーズ | 処理 | 推定コスト |
|---|---|---|
| Phase 1: 一括実行 | 20問 × 3モデル = 60回 | ユーザーBYOK負担（$0.20-0.80） |
| Phase 2: 客観指標 | コード処理 | $0 |
| Phase 3: LLM-as-a-Judge | 60回答 × ジャッジ1回 = 60回 | $0.03-0.10 |
| Phase 4: レポート生成 | 推奨アクションのみLLM 1回 | $0.01-0.03 |
| **プラットフォーム側合計** | | **$0.04-0.13/評価** |
| **ユーザー側合計（BYOK）** | | **$0.20-0.80/評価** |

評価実行前にユーザーに推定コストを表示し、確認を得てから実行する。

### 4.6 エラーハンドリング

| 障害 | 対処 |
|---|---|
| 特定モデルの全リクエストがタイムアウト | 当該モデルをスキップしてレポート生成。「エラーにより評価不能」と表示 |
| ジャッジのJSON出力がパースできない | リトライ1回。失敗時はその回答の品質スコアを「N/A」とする |
| 一部プロンプトでのみエラー | 成功したプロンプトのみで集計。サンプル数が50%未満なら警告表示 |
| レート制限 | 指数バックオフで自動リトライ（最大3回） |
| 推奨アクション生成失敗 | レポートのセクション6のみ非表示。他セクションは正常表示 |

---

## 5. レポート出力設計

### 5.1 レポート構成

**セクション1: 推奨モデルと総合ランキング**

最重要の結論を最初に表示。「あなたのユースケースにはClaude Sonnetが最適です（総合スコア8.2/10）」の一文と、全モデルのランキング・スコアバー。

**セクション2: スコア比較テーブル**

全指標（客観5 + 品質5）× 全モデルの横並びテーブル。各セルに数値と色分け（≥7.0 緑 / 4.0-6.9 黄 / <4.0 赤）。

**セクション3: 軸別詳細分析（レーダーチャート）**

各モデルの強み・弱みをレーダーチャートで視覚化。トレードオフを一目で把握できる。

**セクション4: 注目すべき回答例**

ピックアップ基準:
- モデル間のスコア分散が最大の質問（最も差が出た質問）
- エッジケースカテゴリで差が出た質問
- 最大3問をピックアップ

各質問について、全モデルの実際の回答を並列表示し、ジャッジの採点理由を添える。

**セクション5: コスト試算**

ユーザーに月間想定利用回数を入力してもらい（デフォルト: 1,000回）、各モデルの月次コストを算出。実際のトークン使用量の中央値をベースにする。

**セクション6: 推奨アクション**

LLM生成。全スコアデータとユースケースプロファイルを入力として、具体的なネクストステップを1〜3個提示する。例: 「Claude Sonnetをメインに採用し、シンプルな質問はGemini Flashにルーティングすることでコスト最適化を推奨」

### 5.2 出力フォーマット

| フォーマット | 用途 | 生成方法 |
|---|---|---|
| 画面内レポート（メイン） | インタラクティブ閲覧 | Reactコンポーネント |
| PDF エクスポート | 社内共有・稟議用 | サーバーサイド生成 |
| Markdown エクスポート | 技術ドキュメント用 | テンプレートベース |

### 5.3 レポート生成アーキテクチャ

セクション1〜3, 5: 客観指標 + 品質スコアの集計結果から**コードで自動生成**。LLM不使用。
セクション4: スコア分散が最大の質問を機械的に選定。ジャッジの採点理由をそのまま表示。
セクション6: **LLM 1回呼び出し**。全スコアデータ + ユースケースプロファイルを入力。

---

## 6. ガバナンス基盤（常時ON・設定UIなし）

### 6.1 PII送信前マスキング

- **タイミング:** 全プロバイダーAPIへの送信直前（評価プロンプト送信時、ジャッジ送信時の両方）
- **MVP対象:** 電話番号、メールアドレス、クレジットカード番号、マイナンバー
- **方式:** 正規表現パターンマッチ。`090-1234-5678` → `[PHONE_1]` 等に置換
- **復元:** MVPでは復元なし

### 6.2 コスト制御 + degrade

| 制限 | 上限 | アクション |
|---|---|---|
| 月額コスト | $20/user | 高額モデルを無効化、安価モデルのみ利用可能に |
| 日次コスト | $5/user | 同上 |
| 出力トークン | 4,096/リクエスト | max_tokensで制御 |
| タイムアウト | 30秒/リクエスト | TIMEOUTステータス |

評価実行前に推定コストを表示し、上限との照合を行う。上限超過が見込まれる場合は実行をブロックし、対象モデルの変更を促す。

### 6.3 イベントログ

全イベントをDBに記録。

| イベント種別 | 記録内容 |
|---|---|
| eval_run_event | プロジェクトID、対象モデル、プロンプト数、タイムスタンプ |
| model_response_event | モデル名、ステータス、トークン数、コスト、レイテンシ |
| judge_event | ジャッジモデル、採点結果サマリ |
| cost_event | 累計コスト更新、degrade発動の有無 |
| pii_mask_event | マスク適用箇所数、マスクパターン種別 |

データ保護:
- 入出力本文はSHA-256ハッシュで保存（原文は保存しない）
- ログ保持期間: デフォルト90日
- RLSでユーザー間分離

---

## 7. データモデル

### 7.1 ER概要

EvalProject 1:N PromptSet 1:N PromptItem。EvalProject 1:N EvalRun 1:N ModelResponse 1:1 JudgeScore。EvalRun 1:1 EvalReport。

### 7.2 スキーマ

**EvalProject**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userId | String | Supabase Auth user ID |
| name | String | プロジェクト名 |
| useCaseProfile | Json | Stage 1で生成した構造化プロファイル |
| status | Enum (DRAFT / RUNNING / COMPLETED / FAILED) | |
| createdAt | DateTime | |
| updatedAt | DateTime | |
| isArchived | Boolean (false) | |

**PromptSet**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| projectId | String (FK → EvalProject) | |
| source | Enum (GENERATED / IMPORTED) | 自動生成かインポートか |
| generationConfig | Json? | ヒアリング回答、配分ルール等 |
| createdAt | DateTime | |

**PromptItem**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| promptSetId | String (FK → PromptSet) | |
| category | Enum (ACCURACY / RELEVANCE / CONCISENESS / TONE / INSTRUCTION / EDGE_CASE / GENERAL) | |
| prompt | Text | プロンプト本文 |
| evaluationFocus | String | 何を評価するかの説明 |
| goldStandardHint | Text? | 理想的な回答の方向性 |
| orderIndex | Int | 表示順 |

**EvalRun**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| projectId | String (FK → EvalProject) | |
| promptSetId | String (FK → PromptSet) | |
| targetModels | String[] | 評価対象モデル |
| judgeModel | String | ジャッジに使うモデル |
| status | Enum (PENDING / RUNNING / SCORING / COMPLETED / FAILED) | |
| estimatedCostUsd | Decimal? | 事前見積もり |
| actualCostUsd | Decimal? | 実績 |
| createdAt | DateTime | |
| completedAt | DateTime? | |

**ModelResponse**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| evalRunId | String (FK → EvalRun) | |
| promptItemId | String (FK → PromptItem) | |
| provider | Enum (OPENAI / ANTHROPIC / GOOGLE) | |
| model | String | |
| content | Text | AI回答 |
| inputTokens | Int | |
| outputTokens | Int | |
| estimatedCostUsd | Decimal | |
| latencyMs | Int | |
| status | Enum (COMPLETED / FAILED / TIMEOUT / REFUSED) | |
| piiMasked | Boolean | |
| createdAt | DateTime | |

**JudgeScore**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| modelResponseId | String (FK → ModelResponse, unique) | 1:1 |
| judgeModel | String | 採点に使ったモデル |
| accuracy | Int | 1-5 |
| relevance | Int | 1-5 |
| conciseness | Int | 1-5 |
| tone | Int | 1-5 |
| instructionFollowing | Int | 1-5 |
| reasons | Json | 各軸の採点理由 |
| createdAt | DateTime | |

**EvalReport**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| evalRunId | String (FK → EvalRun, unique) | 1:1 |
| rankings | Json | モデル別総合スコアとランキング |
| scoreMatrix | Json | 全指標×全モデルのスコアテーブル |
| highlights | Json | 注目すべき回答例のピックアップ |
| costProjection | Json | 月次コスト試算 |
| recommendation | Text | LLM生成の推奨アクション |
| createdAt | DateTime | |

**UserApiKey**（既存流用）

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userId | String (FK) | |
| provider | Enum (OPENAI / ANTHROPIC / GOOGLE) | |
| encryptedKey | String | AES-256-GCM暗号化済 |
| keyHint | String | 末尾4文字 |
| isActive | Boolean | |

**UsageLog**（既存流用）

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userId | String (FK) | |
| modelResponseId | String (FK) | |
| provider | Enum | |
| model | String | |
| inputTokens | Int | |
| outputTokens | Int | |
| estimatedCostUsd | Decimal | |
| createdAt | DateTime | |

**EventLog**（既存流用）

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userId | String (FK) | |
| eventType | String | eval_run / model_response / judge / cost / pii_mask |
| payload | Json | イベント固有データ |
| createdAt | DateTime | |

---

## 8. API設計

全APIは `/api` プレフィックス。認証はSupabase JWTをAuthorizationヘッダーで送信。

### 8.1 Projects API

| メソッド | パス | 説明 |
|---|---|---|
| POST | /api/projects | 新規プロジェクト作成 |
| GET | /api/projects | プロジェクト一覧 |
| GET | /api/projects/:id | プロジェクト詳細 |
| PATCH | /api/projects/:id | 更新（name, isArchived） |
| DELETE | /api/projects/:id | ソフトデリート |

### 8.2 Prompt Sets API

| メソッド | パス | 説明 |
|---|---|---|
| POST | /api/projects/:id/prompt-set/generate | ヒアリングからプロンプトセット自動生成。Body: `{ answers: {...} }` |
| POST | /api/projects/:id/prompt-set/import | CSV/JSONインポート。Body: multipart/form-data |
| GET | /api/projects/:id/prompt-set | プロンプトセット + 全PromptItem取得 |
| PATCH | /api/projects/:id/prompt-set/items/:itemId | 個別プロンプト編集 |
| POST | /api/projects/:id/prompt-set/items | プロンプト追加 |
| DELETE | /api/projects/:id/prompt-set/items/:itemId | プロンプト削除 |

### 8.3 Eval Runs API

| メソッド | パス | 説明 |
|---|---|---|
| POST | /api/projects/:id/eval-runs | 評価実行開始。Body: `{ targetModels, judgeModel }` |
| GET | /api/projects/:id/eval-runs | 評価実行履歴一覧 |
| GET | /api/projects/:id/eval-runs/:runId | 実行状況詳細 |
| GET | /api/projects/:id/eval-runs/:runId/progress | SSE: リアルタイム進捗 |
| GET | /api/projects/:id/eval-runs/:runId/responses | 全ModelResponse取得 |
| GET | /api/projects/:id/eval-runs/:runId/responses/:responseId | 個別レスポンス + JudgeScore |

### 8.4 Reports API

| メソッド | パス | 説明 |
|---|---|---|
| GET | /api/projects/:id/eval-runs/:runId/report | レポート取得（JSON） |
| GET | /api/projects/:id/eval-runs/:runId/report/export?format=pdf | PDFエクスポート |
| GET | /api/projects/:id/eval-runs/:runId/report/export?format=md | Markdownエクスポート |

### 8.5 Connectors API（既存流用）

| メソッド | パス | 説明 |
|---|---|---|
| GET | /api/connectors | 利用可能プロバイダー/モデル一覧 |
| POST | /api/connectors/keys | APIキー登録 |
| DELETE | /api/connectors/keys/:id | APIキー削除 |
| POST | /api/connectors/test | 接続テスト |

### 8.6 Usage API（既存流用）

| メソッド | パス | 説明 |
|---|---|---|
| GET | /api/usage | 利用統計（?period=day\|week\|month） |
| GET | /api/usage/limits | 現在の利用上限と残量 |

---

## 9. 技術スタック

### 9.1 アーキテクチャ

モノリス・フルスタックNext.js構成。既存Platon AIと同一。

| レイヤー | 技術 | 説明 |
|---|---|---|
| Frontend | Next.js 14 (App Router) + React 18 | ダッシュボード型SPA |
| State | Zustand + React Query | グローバル状態とサーバーステート分離 |
| API | Next.js Route Handlers (REST) + SSE | App Router /api/* |
| DB | PostgreSQL (Supabase) | マネージドDB + Auth + Realtime |
| ORM | Prisma | 型安全なDBアクセス |
| AI Gateway | カスタムConnector層（既存流用） | プロバイダーごとのアダプター |
| Auth | Supabase Auth | JWTベース |
| Deploy | Vercel | Next.js最適化ホスティング |

### 9.2 主要パッケージ

| カテゴリ | パッケージ |
|---|---|
| Framework | next 14.x |
| React | react, react-dom 18.x |
| State | zustand 4.x |
| Server State | @tanstack/react-query 5.x |
| ORM | prisma 5.x |
| UI | tailwindcss, @radix-ui/* |
| Charts | recharts（レーダーチャート、バーチャート） |
| Markdown | react-markdown, remark-gfm |
| PDF | @react-pdf/renderer（レポートエクスポート） |
| AI SDKs | openai, @anthropic-ai/sdk, @google/generative-ai |
| Auth | @supabase/supabase-js |
| Validation | zod 3.x |
| CSV | papaparse（インポート処理） |

### 9.3 サポートモデル（MVP）

| プロバイダー | モデル | 入力 ($/1M) | 出力 ($/1M) |
|---|---|---|---|
| OpenAI | gpt-4o | $2.50 | $10.00 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 |
| Anthropic | claude-sonnet-4-20250514 | $3.00 | $15.00 |
| Anthropic | claude-haiku-4-5-20251001 | $0.80 | $4.00 |
| Google | gemini-2.0-flash | $0.10 | $0.40 |
| Google | gemini-2.0-pro | $1.25 | $5.00 |

※ 単価は参考値。設定ファイルで外部化し更新可能。

### 9.4 状態管理（Zustand）

| Store | 状態 | アクション |
|---|---|---|
| useProjectStore | projects[], activeProjectId | fetchProjects, createProject, selectProject |
| usePromptSetStore | promptSet, promptItems[] | generatePromptSet, importPromptSet, editItem |
| useEvalStore | evalRuns[], activeRunId, progress | startEvalRun, pollProgress |
| useReportStore | report, exportFormat | fetchReport, exportReport |
| useConnectorStore | availableModels[], selectedModels[] | toggleModel, addApiKey, testConnection |
| useUsageStore | dailyUsage, monthlyUsage, limits | fetchUsage, checkLimits |

### 9.5 ディレクトリ構成

```
platon-ai-eval/
├─ src/app/
│  ├─ api/projects/                # Projects API
│  ├─ api/eval-runs/               # Eval Runs API
│  ├─ api/connectors/              # Connectors API（既存流用）
│  ├─ api/usage/                   # Usage API（既存流用）
│  ├─ (dashboard)/                 # プロジェクト一覧画面
│  ├─ (eval)/                      # 評価フロー画面
│  │  ├─ [projectId]/onboarding/   # ヒアリング
│  │  ├─ [projectId]/prompts/      # プロンプト確認・編集
│  │  ├─ [projectId]/run/          # 評価実行・進捗
│  │  └─ [projectId]/report/       # レポート表示
│  ├─ settings/                    # APIキー管理、利用状況
│  └─ layout.tsx
├─ src/lib/connectors/             # AI Provider adapters（既存流用）
│  ├─ base.ts
│  ├─ openai.ts / anthropic.ts / google.ts
│  └─ registry.ts
├─ src/lib/eval/                   # ★ 評価エンジン（新規）
│  ├─ prompt-generator.ts          # Stage 1-3: プロンプトセット生成
│  ├─ execution-engine.ts          # Phase 1: 一括実行オーケストレーション
│  ├─ metrics-calculator.ts        # Phase 2: 客観指標計算
│  ├─ judge.ts                     # Phase 3: LLM-as-a-Judge
│  ├─ score-aggregator.ts          # Phase 4: スコア統合
│  ├─ report-generator.ts          # Phase 4: レポート生成
│  └─ types.ts                     # 型定義
├─ src/lib/cost/                   # Token counting & cost calc（既存流用）
├─ src/lib/governance/             # ガバナンス基盤（一部流用）
│  ├─ pii-masker.ts                # PIIマスキング（既存流用）
│  ├─ cost-controller.ts           # コスト制御（既存流用）
│  └─ event-logger.ts              # イベントログ（既存流用）
├─ src/lib/db/                     # Prisma client & queries
├─ src/components/
│  ├─ project/                     # プロジェクト管理UI
│  ├─ onboarding/                  # ヒアリングフローUI
│  │  └─ OnboardingWizard.tsx
│  ├─ prompt-editor/               # プロンプトセット確認・編集UI
│  │  └─ PromptSetEditor.tsx
│  ├─ eval/                        # 評価実行・進捗UI
│  │  └─ EvalProgress.tsx
│  ├─ report/                      # ★ レポート表示UI
│  │  ├─ RankingCard.tsx
│  │  ├─ ScoreMatrix.tsx
│  │  ├─ RadarChart.tsx
│  │  ├─ ResponseComparison.tsx
│  │  ├─ CostProjection.tsx
│  │  └─ RecommendationCard.tsx
│  └─ common/
├─ src/stores/                     # Zustand stores
├─ prisma/schema.prisma
└─ .env.local
```

### 9.6 環境変数

```
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx
DATABASE_URL=postgresql://xxx
ENCRYPTION_KEY=<32-byte-hex>   # APIキー暗号化用
```

---

## 10. プライシング

### 10.1 プラン設計

**Freeプラン**

| 制限 | 内容 |
|---|---|
| 評価実行 | 月3回まで |
| 対象モデル | 2つまで |
| プロンプトセット | 10問まで |
| レポート | 画面表示のみ（エクスポート不可） |
| ドメインテンプレート | 3種（カスタマーサポート/コード生成/文書要約） |
| カスタムインポート | 不可 |

**Proプラン（$29/月）**

| 制限 | 内容 |
|---|---|
| 評価実行 | 無制限 |
| 対象モデル | 6つまで |
| プロンプトセット | 30問まで |
| レポート | PDF / Markdown エクスポート可 |
| ドメインテンプレート | 全種 |
| カスタムインポート | CSV/JSON対応 |
| 評価履歴 | 保存・過去レポートとの比較 |

### 10.2 課金の考え方

AI APIのコスト自体はBYOKでユーザー持ち。Platon AI側の課金はプラットフォーム利用料（評価エンジン + レポート生成 + ヒアリング自動生成の価値に対する対価）。

プライシングは初期ユーザーの反応を見て調整する前提。MVPローンチ時はFreeのみで開始し、有料化は利用データが溜まってから判断してもよい。

---

## 11. 開発フェーズ

### Phase 1: Foundation（2週間）

| タスク | 詳細 | 完了条件 |
|---|---|---|
| プロジェクトセットアップ | Next.js + Prisma + Supabase初期化 | `npm run dev`で起動確認 |
| DBスキーマ | 全テーブルmigration | prisma migrate dev成功 |
| 認証 | Supabase Auth | ログイン/ログアウト動作 |
| Connector実装 | OpenAI/Anthropic/Google 3プロバイダー（既存流用） | 各send()成功 |
| APIキー管理 | BYOK登録/削除/テストUI | キー登録して接続OK |
| 基本レイアウト | ダッシュボード + サイドバー | プロジェクト一覧表示 |
| ガバナンス基盤 | PII masker、コスト制御、イベントログ（既存流用） | 各モジュール動作確認 |

### Phase 2: プロンプトセット生成（1.5週間）

| タスク | 詳細 | 完了条件 |
|---|---|---|
| ヒアリングUI | OnboardingWizard（5問） | 全質問に回答してプロファイルJSON生成 |
| Stage 1実装 | ヒアリング→ユースケースプロファイル | 構造化JSON正常出力 |
| Stage 2実装 | 評価マトリクス生成（ルールベース） | priority反映した配分計算 |
| Stage 3実装 | プロンプト生成 + バリデーション | 20問のプロンプトセット正常生成 |
| PromptSetEditor | 確認・編集UI | 編集/追加/削除が動作 |
| カスタムインポート | CSV/JSONパーサー + UI | ファイルアップロードでプロンプトセット作成 |
| シードプロンプト | 3ドメイン × 3〜5問 | シード込みで生成品質確認 |

### Phase 3: 評価エンジン（2週間）★ 最重要

| タスク | 詳細 | 完了条件 |
|---|---|---|
| Phase 1実装 | 一括実行エンジン + SSE進捗通知 | 20問×3モデル並列実行完走 |
| Phase 2実装 | 客観指標計算（5指標） | 全指標算出、テスト通過 |
| Phase 3実装 | LLM-as-a-Judge 採点 | 5軸スコア + 理由のJSON正常取得 |
| Phase 4実装 | スコア統合 + 総合スコア算出 | 重み付きスコア計算、ランキング生成 |
| EvalProgress UI | 実行中の進捗表示 | プログレスバー + ステータス表示 |
| エラーハンドリング | タイムアウト、パース失敗、レート制限 | 各障害シナリオで適切な対処 |
| 品質チューニング | 採点プロンプト調整 + テストケース | 10パターン以上で採点品質確認 |

### Phase 4: レポート + Polish（1.5週間）

| タスク | 詳細 | 完了条件 |
|---|---|---|
| レポート生成 | 6セクションの構造化レポート | 全セクション正常表示 |
| RankingCard | 推奨モデル + スコアバー | ランキング表示 |
| ScoreMatrix | 全指標×全モデルのテーブル | 色分け付きテーブル表示 |
| RadarChart | レーダーチャート | recharts使用、軸別比較 |
| ResponseComparison | 注目回答例の並列表示 | 最大3問ピックアップ表示 |
| CostProjection | 月次コスト試算 | 利用回数入力で動的算出 |
| RecommendationCard | 推奨アクション | LLM生成テキスト表示 |
| PDF/MDエクスポート | レポート出力 | ダウンロード動作確認 |
| レスポンシブ | モバイル対応 | スマホでレポート閲覧可 |
| E2Eテスト | 全フロー統合テスト | ヒアリング→生成→実行→レポート完走 |

**総開発期間: 約7週間**（フルタイム・1人開発の場合）

**Phase 3（評価エンジン）に最もリソースを投下する。** ここがプロダクトの価値を決める。

---

## 12. 旧Platon AIからの転用マッピング

### 12.1 そのまま流用

| コンポーネント | 転用先 |
|---|---|
| Connectorシステム（base.ts, openai.ts, anthropic.ts, google.ts, registry.ts） | 評価対象モデルへのリクエスト送信 |
| BYOK基盤（AES-256-GCM暗号化、接続テスト） | そのまま |
| コスト計算（トークンカウント、単価計算） | そのまま |
| コスト制御（日次/月次上限、degrade） | そのまま |
| PIIマスキング | 評価プロンプト送信時に適用 |
| イベントログ | イベント種別を変更して流用 |
| Supabase Auth | そのまま |

### 12.2 形を変えて転用

| 旧コンポーネント | 転用先 |
|---|---|
| マルチ送信基盤（Promise.allSettled並列実行） | 一括評価実行エンジン |
| INTEGRATE Step 1（構造抽出） | LLM-as-a-Judge（回答の構造化採点） |
| INTEGRATE Step 1.5（ルールベース処理） | 客観指標計算 + スコア統合 |
| INTEGRATE Step 2（統合結論生成） | 推奨アクション生成 |

### 12.3 削除

| コンポーネント | 理由 |
|---|---|
| Room / UserMessage / AssistantMessage | チャット型データ構造が不要 |
| ハンドオフシステム全体（VERIFY / DEBATE / INTEGRATE） | AI間転送の概念がなくなる |
| モードシステム（厳密検証 / 多角的レビュー） | 評価ツールには不要 |
| IntegrateCard | UI不要（ロジックは転用） |
| ループ検出 | ハンドオフがないため不要 |
| プロバイダー別送信制御 | 評価ツールでは全プロバイダーに送信する前提 |

---

## 13. 将来の拡張（V2以降）

### V2: 精度向上 + 拡張

| 機能 | 優先度 | 説明 |
|---|---|---|
| クロスジャッジ | 高 | 2モデル相互採点によるバイアス軽減 |
| ゴールドスタンダード比較 | 高 | ユーザー提供の期待回答との類似度自動採点 |
| ドメインテンプレート拡張 | 中 | 翻訳、データ分析、法務等 |
| 評価履歴の比較 | 中 | 異なるモデルバージョン間のスコア推移 |
| ストリーミング評価 | 中 | 回答の逐次表示（リアルタイム体験向上） |
| カスタム評価軸 | 中 | ユーザー独自の採点基準を追加 |
| チーム共有 | 低 | プロジェクト・レポートのチーム内共有 |

### V3: プラットフォーム化

| 機能 | 優先度 | 説明 |
|---|---|---|
| ペアワイズ比較（Eloレーティング） | 高 | Chatbot Arena方式のランキング |
| API提供 | 高 | 外部サービスからの評価実行 |
| CI/CDインテグレーション | 中 | GitHub Actions等からの自動評価 |
| コミュニティプロンプトセット | 中 | ユーザー間でのプロンプトセット共有 |
| VAP連携 | 低 | 評価結果のVAP準拠証跡記録 |

---

*End of Document*