# Multi-AI Orchestrator — 統合MVP仕様書

**Opinionated Secure Orchestrator**

| 項目 | 内容 |
|---|---|
| Version | 1.1.0 (MVP) |
| 作成日 | 2026-02-21 |
| ステータス | Draft |
| デプロイ | Vercel + Supabase |
| 対象 | 業務でAIを活用する個人〜小規模チーム |

---

## 1. プロダクト定義

### 1.1 ワンライナー

**「複数AIの思考を統合するエンジン」**

### 1.2 プロダクトの心臓

INTEGRATE（統合）。マルチ送信は手段、ハンドオフは経路、ガバナンスは基盤。ユーザーが最終的に欲しいのは「複数の視点を踏まえた、自分では出せなかった結論」。3つのAIがバラバラに答えて「はい3つの回答です」だけなら、ChatGPTを3タブ開くのと変わらない。「共通見解はこれ、相違点はここ、統合するとこういう結論、信頼度は中」まで出して初めて、このプロダクトでしか得られない価値になる。

### 1.3 プロダクトの人格

- **表の顔：** 複数AIに同時に聞いて、回答を検証・統合できるチャットプラットフォーム
- **裏の保証：** 送信前PIIマスク、プロバイダー別制御、コスト制御、ループ停止、イベントログ。すべて常時ON、設定UIなし、ユーザーに意識させない
- **設計思想：** Opinionated Secure Orchestrator。選択肢を減らし、安全はプロダクトが担保する

### 1.4 解決する課題

| 課題 | 具体例 |
|---|---|
| 単一AIの回答を信用できない | 事実誤認、ハルシネーション、偏り |
| 複数AIを手動で使うのが面倒 | タブ切替、コピペ、比較が煩雑 |
| 複数の回答を自分で統合できない | どれを信じるか判断できない、結論が出せない |
| 複数プロバイダーへの情報拡散が怖い | 機密情報が2〜3社のAPIに同時送信される |
| AIのコストが見えない | 複数モデル利用でコストが予測不能 |

### 1.5 設計原則

1. **統合が心臓** — INTEGRATEの品質がプロダクトの価値を決める。ここに最もリソースを投下する
2. **選択を減らす** — モード選択で抽象化。上級者には詳細を開放するが、デフォルトはシンプル
3. **モデル名は隠さない** — 誰が答えたかは常に見える。BYOKの信頼性とマルチAIの価値を両立
4. **ガバナンスはインフラ** — 安全機能はUIに出さない。常時ON、設定なし、組み合わせ爆発なし
5. **基盤の最小成立** — 「基盤だから全部必要」ではなく「基盤の中でも最小で成立するものだけ入れる」

---

## 2. ユーザー体験設計

### 2.1 モードシステム（Layer 1）

ユーザーはモードを選ぶだけ。裏でモデル選択・実行順序・テンプレートが決まる。MVPは2モードに絞る。

| モード | 説明 | 裏の動作 |
|---|---|---|
| **厳密検証** | 回答を別AIが検証 | 主回答→別モデルでVERIFY自動実行 |
| **多角的レビュー** | 複数AIの視点を並列で見て統合 | 2〜3モデルに同時送信→INTEGRATE自動実行 |

モードを選ばずに通常送信すれば、選択したモデルにそのまま送信される（従来のチャット動作）。

デフォルトのモデル組み合わせはプロダクトが決定する。ただし、**どのモデルが使われているかは常にResponseCardに表示**される。

### 2.2 上級者モード（Layer 2）

トグルで開放される詳細設定：

- モデル個別指定（最大3モデル）
- 転送テンプレート選択（3種）
- ハンドオフの手動実行
- temperature等のモデルパラメータ

Layer 1のモード選択とLayer 2の手動操作は排他ではなく、モードで開始してから手動でハンドオフを追加することも可能。

### 2.3 レイアウト

デスクトップファーストの3ペイン。モバイルではタブ切替。

| エリア | 幅 | 内容 |
|---|---|---|
| 左サイドバー | 280px（折りたたみ可） | ルーム一覧、新規作成、設定リンク |
| 中央 | フレキシブル | モード選択、入力バー、会話タイムライン |
| 右パネル | 400px（トグル） | ハンドオフ履歴、コストダッシュボード |

レスポンシブ：

| ブレークポイント | レイアウト |
|---|---|
| ≥1280px | 3ペイン |
| 768–1279px | 2ペイン（サイドバー折りたたみ） |
| <768px | 1ペイン（タブ切替＋カード縦並び） |

### 2.4 主要UIコンポーネント

**ResponseCard（回答カード）**

| 要素 | 説明 |
|---|---|
| ヘッダー | モデル名＋プロバイダーアイコン＋レイテンシ |
| コンテンツ | Markdownレンダリング、テキスト選択可能 |
| フッター | トークン数＋推定コスト |
| 転送ボタン群 | 検証 / ディベート（Layer 2時のみ表示） |
| コピー | クリップボードコピー |

**IntegrateCard（統合結論カード — 核心UI）**

| 要素 | 説明 |
|---|---|
| 信頼構造バー | 高信頼（緑）/ 条件付き（黄）/ 不確実（赤）の視覚表示 |
| 共通見解セクション | 全AIが一致した要素 |
| コンフリクトセクション | 対立点と前提の違い |
| 統合結論 | 重み付け済みの最終結論 |
| 根拠トレース | 各結論がどのAIの回答に基づくかのリンク |

**HandoffDialog（転送ダイアログ）**

| 要素 | 説明 |
|---|---|
| プレビュー | 送信プロンプト（変数展開済） |
| ターゲット選択 | 転送先モデル（ラジオボタン） |
| 追記テキスト | ユーザー追加指示（任意） |
| 実行ボタン | 転送実行 |

---

## 3. コアチャット機能

### 3.1 マルチモデル同時送信

選択モデル分のModelRunを同時作成し、`Promise.allSettled`で並列実行。

```javascript
async function executeMultiModel(message, targetModels, config) {
  const runs = targetModels.map(m => ({
    model: m,
    promise: connectorRegistry.get(m).send(messages, config)
  }));
  const results = await Promise.allSettled(runs.map(r => r.promise));
  // TIMEOUT/FAILED は status更新してUI通知
}
```

### 3.2 Connectorシステム

**BaseConnectorインターフェース**

```typescript
interface ConnectorConfig {
  provider: Provider;
  model: string;
  apiKey: string;       // 復号化済み
  maxTokens?: number;   // default: 4096
  temperature?: number; // default: 0.7
  timeoutMs?: number;   // default: 30000
}

interface ConnectorResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  raw: any;
}

interface BaseConnector {
  send(msgs: ConnectorMessage[], cfg: ConnectorConfig): Promise<ConnectorResponse>;
  estimateCost(inTok: number, outTok: number, model: string): number;
  validateApiKey(key: string): Promise<boolean>;
}
```

**サポートモデル（MVP）**

| プロバイダー | モデル | 入力 ($/1M) | 出力 ($/1M) |
|---|---|---|---|
| OpenAI | gpt-4o | $2.50 | $10.00 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 |
| Anthropic | claude-sonnet-4-20250514 | $3.00 | $15.00 |
| Anthropic | claude-haiku-4-5-20251001 | $0.80 | $4.00 |
| Google | gemini-2.0-flash | $0.10 | $0.40 |
| Google | gemini-2.0-pro | $1.25 | $5.00 |

※ 単価は参考値。設定ファイルで外部化し更新可能。

### 3.3 BYOK（Bring Your Own Key）

- ユーザーが各プロバイダーのAPIキーを登録
- AES-256-GCMで暗号化しDB保存
- 復号化はサーバーサイドのみ
- 末尾4文字をヒントとして表示（`...a3Bx`）
- 接続テスト機能あり

### 3.4 ルーム管理

- 会話単位のルーム作成・一覧・アーカイブ
- ルーム名は初回メッセージから自動生成
- ソフトデリート対応

---

## 4. ハンドオフシステム

### 4.1 転送テンプレート（MVP: 3種）

MVPでは心臓のINTEGRATEと、最も利用頻度の高いVERIFY・DEBATEに絞る。

**Template 1: VERIFY（検証）**

```
以下は別AIモデル（{{sourceModel}}）の回答です。検証してください。
1. 事実誤認の指摘 2. 論理矛盾の指摘 3. 改善案の提示
4. 問題なければ「検証済み」と記載
---
{{response}}
```

**Template 2: DEBATE（ディベート）**

自動2ステップ実行：

- Step 1（反論）: 対戦相手に「{{sourceModel}}の主張に反論してください」と送信
- Step 2（再反論）: 元モデルに「元の主張＋反論」を渡して再反論要求
- **Step 2後は自動停止。続行にはユーザーの明示的操作が必要。**

**Template 3: INTEGRATE（統合）— 心臓機能**

2段階アーキテクチャで実行。詳細は第5章で定義。

### 4.2 V2以降のテンプレート

| テンプレート | 説明 | 優先度 |
|---|---|---|
| QUESTION_GEN | 回答から次の質問を生成 | 中 |
| ROLE_REVIEW | 法務/PM/セキュリティ等の役割でレビュー | 中 |
| SUMMARIZE | 300字以内に要約して転送 | 低 |

### 4.3 転送実行フロー

```javascript
async function executeHandoff(params) {
  const { sourceModelRunId, targetModel, templateId, userOverride } = params;

  // 1. ソース取得
  const sourceRun = await db.modelRun.findUnique({...include: { assistantMessage: true }});

  // 2. テンプレート展開
  let prompt = template.replace('{{response}}', sourceRun.assistantMessage.content);

  // 3. ユーザー追記付与
  if (userOverride) prompt += `\n追加指示: ${userOverride}`;

  // 4. ★ ガバナンスフック: PIIマスク適用
  prompt = await piiMasker.mask(prompt);

  // 5. ★ ガバナンスフック: プロバイダー送信可否チェック
  await providerPolicy.check(targetModel, prompt);

  // 6. 新規ModelRun作成 + AI実行
  const result = await connector.send([{ role: 'user', content: prompt }], cfg);

  // 7. Handoffレコード保存（composedPromptに全文保存 = 監査ログ）
  await db.handoff.create({ data: { composedPrompt: prompt, ... } });

  // 8. ★ ガバナンスフック: イベントログ記録
  await eventLog.record({ type: 'handoff', ... });
}
```

### 4.4 ループ防止ルール

| ルール | 実装 |
|---|---|
| AI→AI自動連鎖禁止 | 全転送はユーザーのボタンクリックがトリガー |
| ディベート上限 | 最大1往復（2ステップ）で強制停止 |
| 転送チェーン上限 | 1元回答からの転送は最大3回 |
| 同時モデル上限 | 同時送信は最大3モデル |
| ループスコア検出 | 同一内容の堂々巡りをハッシュ比較で検出し警告表示 |

---

## 5. INTEGRATE アーキテクチャ（心臓機能）

プロダクトの核心。単純なLLM丸投げではなく、「構造化→ルールベース前処理→LLM統合」の2段階方式で品質を安定させる。

### 5.1 全体フロー

```
複数AI回答
    ↓
[Step 1] 構造抽出（安価モデル × 各回答）
    ↓
  JSON出力
    ↓
[Step 1.5] ルールベース前処理（コード処理、LLM不使用）
    ↓
  構造化データ
    ↓
[Step 2] 統合結論生成（高性能モデル × 1回）
    ↓
  IntegrateCard表示
```

### 5.2 Step 1: 構造抽出

各AIの回答に対して個別に実行。安価・高速モデル（gpt-4o-mini, gemini-flash等）を使用。

**プロンプト：**

```
以下の回答を、指定されたJSON形式で構造化してください。
回答以外のテキストは一切出力しないでください。

{
  "stance": "agree" | "disagree" | "neutral" | "conditional",
  "premises": ["この回答が前提としている事実や仮定"],
  "claims": [
    {
      "content": "主張の内容",
      "confidence": "high" | "medium" | "low",
      "evidence_type": "data" | "logic" | "authority" | "experience" | "none"
    }
  ],
  "risks": ["指摘されているリスクや懸念"],
  "specificity": "high" | "medium" | "low",
  "bias_tendency": "optimistic" | "pessimistic" | "balanced"
}

---
{{response}}
```

**出力例：**

```json
{
  "stance": "conditional",
  "premises": [
    "現在の市場環境が継続する前提",
    "競合の参入が限定的である仮定"
  ],
  "claims": [
    {
      "content": "3年以内にROI達成可能",
      "confidence": "medium",
      "evidence_type": "logic"
    },
    {
      "content": "初期投資は5000万円以内に抑えるべき",
      "confidence": "high",
      "evidence_type": "data"
    }
  ],
  "risks": ["市場縮小リスク", "技術陳腐化リスク"],
  "specificity": "medium",
  "bias_tendency": "optimistic"
}
```

### 5.3 Step 1.5: ルールベース前処理

LLMを使わない。コードで処理。テスト可能・再現可能。

**処理内容：**

#### ① 立場分類

```typescript
function classifyStances(extractions: Extraction[]): StanceMap {
  // 全AIの stance を集計
  // agree/disagree/neutral/conditional の分布を算出
  return { consensus: boolean, distribution: Record<Stance, string[]> };
}
```

#### ② コンフリクト抽出

```typescript
function extractConflicts(extractions: Extraction[]): Conflict[] {
  // premises の差分を検出（集合演算）
  // claims の矛盾を検出（同一トピックで異なる結論）
  // bias_tendency の偏りを検出
  return conflicts.map(c => ({
    type: 'premise_diff' | 'claim_contradiction' | 'risk_disagreement',
    description: string,
    sources: string[]  // どのモデルが関係しているか
  }));
}
```

#### ③ 重み付け

```typescript
function weightClaims(extractions: Extraction[]): WeightedClaim[] {
  // 各主張に対してスコアを算出
  return claims.map(claim => ({
    ...claim,
    scores: {
      consistency: number,   // 他AIとの整合性（0-1）
      specificity: number,   // 具体性（0-1）
      evidenceStrength: number, // 根拠の強さ（0-1）
      counterResistance: number // 反証耐性（0-1）
    },
    compositeWeight: number  // 合成重み（0-1）
  }));
}
```

スコア算出ロジック：

| スコア | 算出方法 |
|---|---|
| consistency | 同一主張が他AIにも存在する割合 |
| specificity | extraction.specificityをスコア化（high=1.0, medium=0.6, low=0.3） |
| evidenceStrength | evidence_typeをスコア化（data=1.0, logic=0.7, authority=0.5, experience=0.3, none=0.1） |
| counterResistance | DEBATEが実行済みの場合、反論後も維持された主張に加点 |

compositeWeight = (consistency × 0.3) + (specificity × 0.2) + (evidenceStrength × 0.3) + (counterResistance × 0.2)

#### ④ 信頼構造分類

```typescript
function classifyTrust(weightedClaims: WeightedClaim[], conflicts: Conflict[]): TrustStructure {
  return {
    highTrust: claims.filter(c => c.compositeWeight >= 0.7 && appearsInAllModels(c)),
    conditional: claims.filter(c => c.compositeWeight >= 0.4 && !appearsInAllModels(c)),
    uncertain: claims.filter(c => c.compositeWeight < 0.4 || hasConflict(c, conflicts))
  };
}
```

### 5.4 Step 2: 統合結論生成

Step 1.5の構造化データを高性能モデル（gpt-4o, claude-sonnet等）に渡す。入力が構造化済みなので出力品質が安定する。

**プロンプト：**

```
あなたは複数AIの回答を統合する分析者です。
以下の構造化データに基づいて統合結論を生成してください。

## 信頼構造
高信頼（全AI一致）:
{{#each highTrust}}
- {{content}}（重み: {{compositeWeight}}）
{{/each}}

条件付き（一部一致）:
{{#each conditional}}
- {{content}}（重み: {{compositeWeight}}、条件: {{conditions}}）
{{/each}}

不確実（対立あり）:
{{#each uncertain}}
- {{content}}（重み: {{compositeWeight}}、対立: {{conflictDescription}}）
{{/each}}

## コンフリクト
{{#each conflicts}}
- [{{type}}] {{description}}（関係モデル: {{sources}}）
{{/each}}

## 立場分布
{{stanceDistribution}}

---

以下の形式で統合結論を生成してください：

1. **統合結論**（300字以内）: 信頼構造を反映した最終結論
2. **高信頼の要素**: 全AIが一致した点（そのまま採用してよい）
3. **条件付きの要素**: 採用する場合の条件を明示
4. **未解決の対立**: 追加情報なしには判断できない点
5. **推奨アクション**: ユーザーが次に取るべき行動（1-3個）
```

### 5.5 コスト構造

| ステップ | モデル | 回数 | 推定コスト |
|---|---|---|---|
| Step 1: 構造抽出 | gpt-4o-mini / gemini-flash | AI回答数分（2-3回） | $0.001-0.003 |
| Step 1.5: ルールベース | コード処理 | 1回 | $0（CPU処理） |
| Step 2: 統合結論 | gpt-4o / claude-sonnet | 1回 | $0.01-0.03 |
| **合計** | | | **$0.01-0.03/統合** |

### 5.6 エラーハンドリング

| 障害 | 対処 |
|---|---|
| Step 1のJSON出力がパースできない | リトライ1回。失敗時はフォールバック（LLM丸投げINTEGRATE） |
| Step 1.5でデータ不足 | 不足フィールドはデフォルト値で補完 |
| Step 2の出力が期待形式でない | Markdownとしてそのまま表示（構造化UIは非表示） |

フォールバック用の丸投げINTEGRATEテンプレート：

```
以下は同じ質問に対する複数AIの回答です。
{{#each responses}} ## {{modelName}}の回答 {{content}} {{/each}}

統合形式: 1.共通見解 2.相違点 3.統合結論 4.信頼度評価(高/中/低+理由)
```

---

## 6. ガバナンス基盤（常時ON・設定UIなし）

すべてインフラとして固定実装。ユーザーに設定を見せない、選択肢を与えない。

### 6.1 レベル1：構造的安全（MVP実装）

#### 6.1.1 PII送信前マスキング

- **タイミング：** 全プロバイダーAPIへの送信直前
- **MVP対象：** 明確なパターンのみ。電話番号、メールアドレス、クレジットカード番号、マイナンバー
- **氏名：** MVPではマスク対象外。誤検知リスクが高いため、warn（ログ記録のみ）に留める
- **方式：** 正規表現パターンマッチ。`090-1234-5678` → `[PHONE_1]` 等に置換
- **復元：** MVPでは復元なし。マスクしたまま送信・表示
- **適用箇所：** 初回送信、ハンドオフ転送の両方

#### 6.1.2 プロバイダー別送信制御

- **方式：** 固定ルールベース。設定UIなし
- **制御例：** 特定パターン（社内文書マーカー等）を含む場合、外部プロバイダーへの送信をブロック
- **ブロック時UX：** 「この内容は外部AIに送信できません」とトースト表示。送信自体を実行しない
- **MVPルール：** PII検出時に警告表示＋マスク済みで送信

#### 6.1.3 コスト制御＋degrade

| 制限 | 上限 | アクション |
|---|---|---|
| 月額コスト | $20/user | 高額モデルを無効化、安価モデルのみ利用可能に |
| 日次コスト | $5/user | 同上 |
| 出力トークン | 4,096/リクエスト | max_tokensで制御 |
| タイムアウト | 30秒 | TIMEOUTステータス |

従来の「ブロック」ではなく「degrade」：上限接近時に高額モデル（gpt-4o, claude-sonnet）を自動的に安価モデル（gpt-4o-mini, gemini-flash）へフォールバック。ユーザーには「コスト上限に近づいたため、軽量モデルに切り替えました」と通知。

UI表示：
- 各ResponseCardフッターにトークン数と推定コスト
- 右パネルに日次/月次累計コストをプログレスバー表示
- 80%到達で警告トースト

#### 6.1.4 ループ強制停止（簡易版）

- 同一内容の反復をハッシュ比較で検出
- ハンドオフチェーンで同一内容が往復していないかチェック
- 固定上限（転送3回、ディベート1往復）＋ハッシュ比較の併用
- 検出時、ユーザーに「同じ内容の繰り返しが検出されました」と警告

#### 6.1.5 イベントログ保存

全イベントをDBに記録。**「証明」ではなく「ログ保存」が目的。** 改ざん検知はPhase 2で対応。

記録対象：

| イベント種別 | 記録内容 |
|---|---|
| user_message_event | ルームID、入力ハッシュ、送信先モデル、タイムスタンプ |
| model_run_event | モデル名、ステータス、トークン数、コスト、レイテンシ |
| handoff_event | ソースModelRun、ターゲットモデル、テンプレートID、composedPrompt全文 |
| integrate_event | Step 1出力JSON、Step 1.5の信頼構造、Step 2入力プロンプト |
| cost_event | 累計コスト更新、degrade発動の有無 |
| pii_mask_event | マスク適用箇所数、マスクパターン種別 |
| provider_block_event | ブロック理由、対象プロバイダー |

データ保護：
- 入出力本文はSHA-256ハッシュで保存（原文は保存しない。composedPromptのみ例外）
- ログ保持期間：デフォルト90日
- RLSでユーザー間分離

### 6.2 レベル2：監査強化（Phase 2）

- Merkle DAG構造のハッシュチェーン（分岐・合流対応）
- 情報フロー完全追跡
- ハッシュチェーン定期検証バッチ
- 改ざん検知ダッシュボード

### 6.3 レベル3：思想レイヤー（Phase 3以降）

- データ分類エンジン高度化
- Alignment Checker
- Values Registry
- Risk Engineの自動キャリブレーション
- Tool Gateway / Human Review

---

## 7. データモデル

### 7.1 ER概要

Room 1:N UserMessage 1:N ModelRun 1:1 AssistantMessage。HandoffはModelRun間の転送イベント。IntegrateResultはINTEGRATEの構造化データ。EventLogは全操作の証跡。

### 7.2 スキーマ

**Room**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userId | String | Supabase Auth user ID |
| title | String | ルーム名（初回メッセージから自動生成） |
| createdAt | DateTime | |
| updatedAt | DateTime | |
| isArchived | Boolean (false) | |

**UserMessage**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| roomId | String (FK → Room) | |
| content | Text | ユーザー入力テキスト |
| targetModels | String[] | 送信先モデル |
| mode | String? | 使用モード（verify / multi）。null = 通常送信 |
| createdAt | DateTime | |
| orderIndex | Int | 表示順序 |

**ModelRun**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userMessageId | String (FK) | 元UserMessage |
| provider | Enum (OPENAI\|ANTHROPIC\|GOOGLE) | |
| model | String | e.g. "gpt-4o" |
| status | Enum (PENDING\|RUNNING\|COMPLETED\|FAILED\|TIMEOUT) | |
| inputTokens | Int? | |
| outputTokens | Int? | |
| estimatedCostUsd | Decimal? | USD |
| latencyMs | Int? | ms |
| piiMasked | Boolean | PIIマスクが適用されたか |
| settings | Json? | temperature等 |
| createdAt | DateTime | |

**AssistantMessage**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| modelRunId | String (FK, unique) | 1:1 |
| content | Text | AI回答（Markdown） |
| createdAt | DateTime | |

**Handoff**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| roomId | String (FK) | |
| sourceModelRunId | String (FK) | 転送元 |
| targetModelRunId | String (FK) | 転送先（生成後） |
| templateId | String | 使用テンプレートID |
| templateType | Enum (VERIFY\|DEBATE\|INTEGRATE) | |
| composedPrompt | Text | 実際に送信したプロンプト全文（監査用） |
| userOverride | Text? | ユーザー追記 |
| createdAt | DateTime | |

**HandoffTemplate**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String | e.g. "verify" |
| type | Enum | テンプレート種別 |
| name | String | 表示名 |
| promptTemplate | Text | プロンプト（変数埋め込み） |
| variables | String[] | e.g. ["response","role"] |
| isSystem | Boolean | システム定義 |

**IntegrateResult**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| handoffId | String (FK → Handoff) | 対応するINTEGRATEハンドオフ |
| userMessageId | String (FK) | 元の質問 |
| step1Extractions | Json | Step 1の構造抽出結果（全モデル分） |
| step15TrustStructure | Json | Step 1.5の信頼構造（highTrust/conditional/uncertain） |
| step15Conflicts | Json | Step 1.5のコンフリクト一覧 |
| step2Prompt | Text | Step 2に渡したプロンプト |
| step2Output | Text | Step 2の統合結論（Markdown） |
| fallbackUsed | Boolean | フォールバック（丸投げ）が使用されたか |
| createdAt | DateTime | |

**UserApiKey**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userId | String (FK) | |
| provider | Enum | |
| encryptedKey | String | AES-256-GCM暗号化済 |
| keyHint | String | 末尾4文字 |
| isActive | Boolean | |

**UsageLog**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userId | String (FK) | |
| modelRunId | String (FK) | |
| provider | Enum | |
| model | String | |
| inputTokens | Int | |
| outputTokens | Int | |
| estimatedCostUsd | Decimal | |
| createdAt | DateTime | |

**EventLog**

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| userId | String (FK) | |
| sessionId | String | ルームID |
| eventType | String | user_message / model_run / handoff / integrate / cost / pii_mask / provider_block |
| payload | Json | イベント固有データ |
| createdAt | DateTime | |

---

## 8. API設計

全APIは `/api` プレフィックス。認証はSupabase JWTをAuthorizationヘッダーで送信。

### 8.1 Rooms API

| メソッド | パス | 説明 |
|---|---|---|
| GET | /api/rooms | ルーム一覧 |
| POST | /api/rooms | 新規作成 |
| GET | /api/rooms/:id | 詳細取得（メッセージ含む） |
| PATCH | /api/rooms/:id | 更新（title, isArchived） |
| DELETE | /api/rooms/:id | ソフトデリート |

### 8.2 Messages API

| メソッド | パス | 説明 |
|---|---|---|
| POST | /api/messages/send | マルチモデル送信。Body: `{ roomId, content, mode?, targetModels?, settings? }` |
| GET | /api/messages/:id/runs | 特定メッセージの全ModelRun+AssistantMessage取得 |
| GET | /api/messages/:id/runs/:runId | 特定ModelRun詳細 |

`mode`指定時は`targetModels`を省略可能（モードに応じてプロダクトが自動選択）。

### 8.3 Handoff API

| メソッド | パス | 説明 |
|---|---|---|
| POST | /api/handoffs | 転送実行。Body: `{ sourceModelRunId, targetModel, templateId, userOverride? }` |
| POST | /api/handoffs/debate | ディベート実行。Body: `{ sourceModelRunId, opponentModel }` |
| POST | /api/handoffs/integrate | 統合実行。Body: `{ userMessageId, integratorModel }` |
| GET | /api/handoffs/:roomId | ルーム内の転送履歴 |
| GET | /api/handoffs/integrate/:id | INTEGRATE結果詳細（IntegrateResult含む） |

### 8.4 Connectors API

| メソッド | パス | 説明 |
|---|---|---|
| GET | /api/connectors | 利用可能プロバイダー/モデル一覧 |
| POST | /api/connectors/keys | APIキー登録 |
| DELETE | /api/connectors/keys/:id | APIキー削除 |
| POST | /api/connectors/test | 接続テスト |

### 8.5 Usage API

| メソッド | パス | 説明 |
|---|---|---|
| GET | /api/usage | 利用統計（?period=day\|week\|month） |
| GET | /api/usage/limits | 現在の利用上限と残量 |

---

## 9. 技術スタック

### 9.1 アーキテクチャ

モノリス・フルスタックNext.js構成。

| レイヤー | 技術 | 説明 |
|---|---|---|
| Frontend | Next.js 14 (App Router) + React 18 | CSR中心のSPA |
| State | Zustand + React Query | グローバル状態とサーバーステート分離 |
| API | Next.js Route Handlers (REST) | App Router /api/* |
| DB | PostgreSQL (Supabase) | マネージドDB + Auth + Realtime |
| ORM | Prisma | 型安全なDBアクセス |
| AI Gateway | カスタムConnector層 | プロバイダーごとのアダプター |
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
| Markdown | react-markdown, remark-gfm |
| AI SDKs | openai, @anthropic-ai/sdk, @google/generative-ai |
| Auth | @supabase/supabase-js |
| Validation | zod 3.x |

### 9.3 状態管理 (Zustand)

| Store | 状態 | アクション |
|---|---|---|
| useRoomStore | rooms[], activeRoomId | fetchRooms, createRoom, selectRoom |
| useMessageStore | messages[], pendingRuns[] | sendMessage, pollRunStatus, retryRun |
| useHandoffStore | handoffs[], activeHandoff | executeHandoff, executeDebate, executeIntegrate |
| useConnectorStore | availableModels[], selectedModels[] | toggleModel, addApiKey, testConnection |
| useUsageStore | dailyUsage, monthlyUsage, limits | fetchUsage, checkLimits |

### 9.4 ディレクトリ構成

```
multi-ai-orchestrator/
├─ src/app/                        # Next.js App Router
│  ├─ api/rooms/                   # Rooms API
│  ├─ api/messages/                # Messages API
│  ├─ api/handoffs/                # Handoffs API
│  ├─ api/connectors/              # Connectors API
│  ├─ api/usage/                   # Usage API
│  ├─ (chat)/                      # Chat UI routes
│  └─ layout.tsx
├─ src/lib/connectors/             # AI Provider adapters
│  ├─ base.ts                      # BaseConnector interface
│  ├─ openai.ts / anthropic.ts / google.ts
│  └─ registry.ts
├─ src/lib/handoff/                # Handoff logic & templates
├─ src/lib/integrate/              # ★ INTEGRATE心臓機能
│  ├─ step1-extractor.ts           # Step 1: 構造抽出プロンプト
│  ├─ step15-processor.ts          # Step 1.5: ルールベース前処理
│  │  ├─ stance-classifier.ts      # 立場分類
│  │  ├─ conflict-extractor.ts     # コンフリクト抽出
│  │  ├─ claim-weigher.ts          # 重み付け
│  │  └─ trust-classifier.ts       # 信頼構造分類
│  ├─ step2-synthesizer.ts         # Step 2: 統合結論生成プロンプト
│  ├─ fallback.ts                  # フォールバック（丸投げ）
│  └─ types.ts                     # 型定義
├─ src/lib/cost/                   # Token counting & cost calc
├─ src/lib/governance/             # ★ ガバナンス基盤
│  ├─ pii-masker.ts                # PIIマスキング
│  ├─ provider-policy.ts           # プロバイダー送信制御
│  ├─ cost-controller.ts           # コスト制御 + degrade
│  ├─ loop-detector.ts             # ループ検出
│  └─ event-logger.ts              # イベントログ
├─ src/lib/db/                     # Prisma client & queries
├─ src/components/                 # React UI components
│  ├─ room/ message/ handoff/
│  ├─ integrate/                   # ★ IntegrateCard等
│  └─ common/
├─ src/stores/                     # Zustand stores
├─ prisma/schema.prisma
└─ .env.local
```

### 9.5 環境変数

```
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx
DATABASE_URL=postgresql://xxx
ENCRYPTION_KEY=<32-byte-hex>   # APIキー暗号化用
```

---

## 10. 開発フェーズ

### Phase 1: Foundation（2週間）

| タスク | 詳細 | 完了条件 |
|---|---|---|
| プロジェクトセットアップ | Next.js+Prisma+Supabase初期化 | `npm run dev`で起動確認 |
| DBスキーマ | 全テーブルmigration（IntegrateResult, EventLog含む） | prisma migrate dev成功 |
| 認証 | Supabase Auth | ログイン/ログアウト動作 |
| 基本レイアウト | 3ペインレイアウト＋モード選択UI | サイドバー+中央+右パネル |
| ガバナンス基盤 | `src/lib/governance/`の骨格作成 | 各モジュールのインターフェース確定 |

### Phase 2: Core Chat + ガバナンス（2週間）

| タスク | 詳細 | 完了条件 |
|---|---|---|
| Connector実装 | OpenAI/Anthropic/Google 3プロバイダー | 各send()成功 |
| APIキー管理 | BYOK登録/削除/テストUI | キー登録して接続OK |
| マルチ送信 | 並列実行+ステータス管理 | 2-3モデル同時回答表示 |
| PIIマスキング | 送信前自動マスク（明確パターンのみ） | 電話番号・メール等がマスクされて送信 |
| コスト制御 | 計算+上限+degrade | 上限でフォールバック確認 |
| イベントログ | 全操作のEventLog記録 | DB上でイベント確認可能 |

### Phase 3: INTEGRATE心臓機能（2週間）

| タスク | 詳細 | 完了条件 |
|---|---|---|
| Step 1実装 | 構造抽出プロンプト＋JSONパース | 各AI回答から構造化JSON取得 |
| Step 1.5実装 | ルールベース4機能（立場/コンフリクト/重み/信頼） | テスト通過、再現可能 |
| Step 2実装 | 統合結論生成プロンプト | 構造化データから結論生成 |
| IntegrateCard | 信頼構造バー＋セクション表示 | UIで信頼構造が視覚的に確認可能 |
| フォールバック | Step 1失敗時の丸投げINTEGRATE | JSON解析失敗でもユーザーに結果返却 |
| INTEGRATE品質チューニング | プロンプト調整＋テストケース | 10パターン以上で品質確認 |

### Phase 4: Handoff + Polish（1週間）

| タスク | 詳細 | 完了条件 |
|---|---|---|
| VERIFY実装 | 検証テンプレート＋転送UI | ボタン→ダイアログ→検証結果表示 |
| DEBATE実装 | 2ステップ自動＋強制停止 | 反論→再反論→停止確認 |
| ループ検出 | ハッシュ比較＋固定上限 | 堂々巡り検出で警告表示 |
| モードシステム | 2モード実装（厳密検証 / 多角的レビュー） | モード選択で自動実行 |
| レスポンシブ | モバイル対応 | スマホで全機能利用可 |
| エラーハンドリング | タイムアウト・レートリミット | 適切なUIフィードバック |
| E2Eテスト | 主要フロー統合テスト | 送信→INTEGRATE→結論表示完走 |

**総開発期間: 約7週間**（フルタイム・1人開発の場合）

**Phase 3（INTEGRATE）に最もリソースを投下する。** ここがプロダクトの価値を決める。

---

## 11. 将来の拡張（V2以降）

### V2: 機能拡充

| 機能 | 優先度 | 説明 |
|---|---|---|
| ストリーミング表示 | 高 | SSE/WebSocketでリアルタイム回答 |
| 回答差分比較 | 高 | 複数回答の相違点ハイライト |
| QUESTION_GEN | 中 | 回答から次の質問を生成 |
| ROLE_REVIEW | 中 | 法務/PM/セキュリティ等の役割レビュー |
| SUMMARIZE | 低 | 要約転送 |
| カスタムテンプレート | 中 | ユーザー独自の転送テンプレート |
| ファイル添付 | 中 | 画像/PDFを質問に添付 |
| PII氏名対応 | 中 | NERモデルによる氏名検出 |

### V3: エンタープライズ

| 機能 | 優先度 | 説明 |
|---|---|---|
| Merkle DAGログ | 高 | ハッシュチェーンによる改ざん検知 |
| 情報フロー追跡 | 高 | プロバイダー経由の完全追跡 |
| チーム・共有ルーム | 高 | マルチテナント対応 |
| RBAC | 高 | ロールベースアクセス制御 |
| Tool Gateway | 中 | 外部ツール実行の制御 |
| Human Review | 中 | ツール実行の承認キュー |
| Alignment Checker | 低 | 企業理念との整合性チェック |
| Values Registry | 低 | 企業理念の機械可読化 |
| C2PA/VCP連携 | 低 | 外部アンカリング・標準フォーマット |

---

## 12. 競合ポジショニング

| 領域 | 既存 | 本製品の位置づけ |
|---|---|---|
| マルチAIチャット | ChatHub, TypingMind, Poe | 並列表示まではコモディティ |
| AI回答の検証 | 手動コピペ | ワンクリック検証・ディベート |
| **AI回答の統合** | **存在しない** | **★ 最大の差別化。信頼構造付き統合結論** |
| LLMガバナンス | Lakera, Helicone, Langfuse | 裏の保証として内蔵（表には出さない） |

**差別化の核心：** 「複数AIの思考を統合するエンジン」。並列表示は手段であり、信頼構造付きの統合結論がこのプロダクトでしか得られない価値。

---

*End of Document*
