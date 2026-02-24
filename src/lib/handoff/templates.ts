export const HANDOFF_TEMPLATES = {
  VERIFY: {
    id: 'verify',
    type: 'VERIFY' as const,
    name: '検証',
    description: '別AIが回答の事実誤認・論理矛盾を指摘',
    buildPrompt: (sourceModel: string, response: string, userOverride?: string) => {
      let prompt = `以下は別AIモデル（${sourceModel}）の回答です。以下の観点で検証してください。

1. 事実誤認の指摘
2. 論理矛盾の指摘
3. 改善案の提示
4. 問題なければ「検証済み」と記載

---
${response}`
      if (userOverride) prompt += `\n\n追加指示: ${userOverride}`
      return prompt
    },
  },
  DEBATE: {
    id: 'debate',
    type: 'DEBATE' as const,
    name: 'ディベート',
    description: '自動2ステップで反論・再反論を生成',
    buildCounterPrompt: (sourceModel: string, response: string) =>
      `以下は${sourceModel}の主張です。この主張に対して批判的な観点から反論してください。

---
${response}`,
    buildRebuttalPrompt: (sourceModel: string, originalResponse: string, counter: string) =>
      `あなたは以下の主張を行いました。

## 元の主張
${originalResponse}

## 反論
${counter}

上記の反論に対して再反論してください。`,
  },
}
