// Exercise both real judge entrypoints with synthetic inputs and a captured
// connector. Nothing is sent to a provider and no production database is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');

function load(file, mocks = {}) {
  const filename = path.resolve(ROOT, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  function resolve(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('.')) return load(path.relative(ROOT, path.resolve(path.dirname(filename), name + '.ts')), mocks);
    throw Error('Unexpected test import: ' + name);
  }
  new Function('require', 'module', 'exports', source)(resolve, module, module.exports);
  return module.exports;
}

const score = JSON.stringify(Object.fromEntries(
  ['accuracy', 'relevance', 'conciseness', 'tone', 'instruction_following']
    .map(axis => [axis, { score: 4, reason: 'Synthetic score' }])
));

function setup({ retry = false } = {}) {
  const values = {
    domain: 'support-domain@example.test',
    audience: 'audience@example.test',
    hint: 'gold-hint@example.test',
    prompt: 'prompt@example.test',
    answer: 'answer@example.test',
    phone: '090-1234-5678',
  };
  const project = { id: 'project-a', userId: 'owner-a', useCaseProfile: {
    domain: 'Synthetic domain ' + values.domain, audience: values.audience,
  } };
  const promptItem = { id: 'item-a', promptSetId: 'set-a',
    prompt: 'Synthetic question: contact ' + values.prompt + ' on ' + values.phone,
    goldStandardHint: 'Synthetic hint: ' + values.hint };
  const modelResponse = { id: 'response-a', promptItem,
    content: 'Synthetic response: ' + values.answer };
  const run = { id: 'run-a', projectId: project.id, project, promptSetId: 'set-a',
    judgeModel: 'synthetic-model', targetModels: ['synthetic-target'] };
  const calls = [];
  const saved = [];
  const prisma = {
    evalProject: { findFirst: async () => project },
    evalRun: { findFirst: async () => run, findUnique: async () => run, update: async () => run },
    modelResponse: { findMany: async () => [modelResponse], count: async () => 0 },
    judgeScore: { create: async ({ data }) => { saved.push(data); return data; } },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (value, options) => Response.json(value, options) } },
    '@/lib/db/client': { prisma },
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner-a' } } }) } }) },
    '@/lib/connectors/registry': { getConnector: () => ({ send: async (messages) => {
      calls.push(structuredClone(messages));
      return { content: retry && calls.length === 1 ? 'malformed synthetic response' : score };
    } }) },
    '@/lib/db/api-keys': { getUserApiKey: async () => 'synthetic-test-only-key' },
    '@/lib/connectors/types': { SUPPORTED_MODELS: [{ model: 'synthetic-model', provider: 'OPENAI' }], MODEL_PRICING: {} },
    '@/lib/governance/pii-masker': load('src/lib/governance/pii-masker.ts'),
    '@/lib/eval/judge': {}, '@/lib/eval/metrics-calculator': {},
    '@/lib/eval/score-aggregator': {}, '@/lib/eval/report-generator': {},
  };
  return { mocks, calls, saved, values, project, modelResponse, promptItem };
}

function assertMaskedAtConnector(state) {
  for (const messages of state.calls) {
    const outbound = messages.map(message => message.content).join('\n');
    for (const value of Object.values(state.values)) {
      assert.ok(!outbound.includes(value), 'raw synthetic identifier reached the judge connector: ' + value);
    }
    assert.match(outbound, /\[EMAIL_\d+\]/);
    assert.match(outbound, /\[PHONE_JP_\d+\]/);
    assert.match(outbound, /Synthetic question/);
    assert.match(outbound, /Synthetic response/);
  }
}

for (const retry of [false, true]) {
  test('full evaluation masks every judge field before provider egress' + (retry ? ', including retry' : ''), async () => {
    const state = setup({ retry });
    const original = JSON.stringify([state.project, state.modelResponse]);
    await load('src/lib/eval/judge.ts', state.mocks).judgeAllResponses({
      evalRunId: 'run-a', userId: 'owner-a', judgeModel: 'synthetic-model',
      useCaseProfile: state.project.useCaseProfile,
      responses: [{ modelResponseId: state.modelResponse.id, prompt: state.promptItem.prompt,
        goldStandardHint: state.promptItem.goldStandardHint, content: state.modelResponse.content }],
    });
    assert.equal(state.calls.length, retry ? 2 : 1);
    assertMaskedAtConnector(state);
    assert.equal(state.saved.length, 1);
    assert.equal(JSON.stringify([state.project, state.modelResponse]), original);
  });
}

test('batched step evaluation masks every judge field before provider egress', async () => {
  const state = setup();
  const original = JSON.stringify([state.project, state.modelResponse]);
  const route = load('src/app/api/projects/[id]/eval-runs/[runId]/step/route.ts', state.mocks);
  const response = await route.POST(
    new Request('https://synthetic.test/', { method: 'POST', body: JSON.stringify({ step: 'judge', limit: 1 }) }),
    { params: { id: 'project-a', runId: 'run-a' } }
  );
  assert.equal(response.status, 200);
  assert.equal(state.calls.length, 1);
  assertMaskedAtConnector(state);
  assert.equal(state.saved.length, 1);
  assert.equal(JSON.stringify([state.project, state.modelResponse]), original);
});
