import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Seed HandoffTemplates
  const templates = [
    {
      id: 'verify',
      type: 'VERIFY' as const,
      name: '検証',
      description: '別AIが回答の事実誤認・論理矛盾を指摘',
      promptTpl: `以下は別AIモデル（{{sourceModel}}）の回答です。検証してください。
1. 事実誤認の指摘
2. 論理矛盾の指摘
3. 改善案の提示
4. 問題なければ「検証済み」と記載

---
{{response}}`,
      isDefault: true,
    },
    {
      id: 'debate_step1',
      type: 'DEBATE' as const,
      name: 'ディベート（反論）',
      description: '自動2ステップで反論を生成',
      promptTpl: `以下は{{sourceModel}}の主張です。この主張に対して反論してください。
論理的かつ根拠を持って反論し、代替案や別の視点を示してください。

---
{{response}}`,
      isDefault: true,
    },
    {
      id: 'debate_step2',
      type: 'DEBATE' as const,
      name: 'ディベート（再反論）',
      description: '自動2ステップで再反論を生成',
      promptTpl: `あなたの元の主張と、それに対する反論を提示します。
元の主張を維持しつつ、反論に対して再反論してください。

## あなたの元の主張:
{{originalResponse}}

## 反論:
{{debateResponse}}

---
上記を踏まえて、あなたの立場から再反論してください。`,
      isDefault: true,
    },
    {
      id: 'integrate',
      type: 'INTEGRATE' as const,
      name: '統合',
      description: '複数AIの回答を統合',
      promptTpl: `以下は同じ質問に対する複数AIの回答です。

{{responses}}

統合形式:
1. 共通見解
2. 相違点
3. 統合結論
4. 信頼度評価（高/中/低＋理由）`,
      isDefault: true,
    },
  ]

  for (const template of templates) {
    await prisma.handoffTemplate.upsert({
      where: { id: template.id },
      update: template,
      create: template,
    })
  }

  console.log('Seeding completed.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
