// Exercise the real worker and step handler with a relation-aware database
// double. No production database, provider request, or real backoff is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');
const STEP = 'src/app/api/projects/[id]/eval-runs/[runId]/step/route.ts';

function load(file, mocks) {
  const filename = path.resolve(ROOT, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', source)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === '@/lib/eval/scope') return load('src/lib/eval/scope.ts', mocks);
    if (name.startsWith('.')) return load(path.relative(ROOT, path.resolve(path.dirname(filename), name + '.ts')), mocks);
    throw Error('Unexpected test import: ' + name);
  }, module, module.exports, callback => { queueMicrotask(callback); return 0; });
  return module.exports;
}

function matches(row, where) {
  return !!row && Object.entries(where || {}).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Object.hasOwn(value, 'in')) return value.in.includes(row[key]);
      return matches(row[key], value.is || value);
    }
    return row[key] === value;
  });
}

function missing() {
  return Object.assign(new Error('Synthetic missing scoped record'), { code: 'P2025' });
}

function setup() {
  const project = { id: 'project-a', userId: 'owner-a', useCaseProfile: null, status: 'DRAFT' };
  const otherProject = { id: 'project-b', userId: 'owner-b', status: 'DRAFT' };
  const ownSet = { id: 'set-a', projectId: project.id, project };
  const otherSet = { id: 'set-b', projectId: otherProject.id, project: otherProject };
  const anotherSet = { id: 'set-a2', projectId: project.id, project };
  const item = { id: 'item-a', promptSetId: ownSet.id, promptSet: ownSet,
    prompt: 'Synthetic database prompt', goldStandardHint: null, category: 'GENERAL' };
  const foreignItem = { ...item, id: 'item-b', promptSetId: otherSet.id, promptSet: otherSet,
    prompt: 'Synthetic foreign prompt' };
  const run = { id: 'run-a', projectId: project.id, project, promptSetId: ownSet.id,
    promptSet: ownSet, targetModels: ['synthetic-target'], judgeModel: 'synthetic-judge', status: 'PENDING' };
  const foreignRun = { ...run, id: 'run-b', projectId: otherProject.id, project: otherProject,
    promptSetId: otherSet.id, promptSet: otherSet };
  const items = [item, foreignItem];
  const runs = [run, foreignRun];
  const responses = [{ id: 'response-a', evalRunId: run.id, evalRun: run,
    promptItemId: item.id, promptItem: item, provider: 'OPENAI', model: 'synthetic-target',
    status: 'COMPLETED', content: 'Synthetic prior answer', judgeScore: null,
    inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.01 }];
  const state = {
    calls: [], saved: [], reports: [], scores: [], updates: [],
    onApiKey: async () => {}, onItemCheck: async () => {}, onResponseCheck: async () => {},
    onSend: async () => ({ content: 'Synthetic provider answer', inputTokens: 1, outputTokens: 1 }),
    recommendationError: null,
  };
  const lookupRun = where => {
    const row = runs.find(candidate => matches(candidate, where));
    if (!row) throw missing();
    return structuredClone({ ...row, promptSet: { ...row.promptSet,
      promptItems: items.filter(candidate => candidate.promptSetId === row.promptSetId) } });
  };
  const prisma = {
    evalProject: {
      findFirst: async ({ where }) => [project, otherProject].find(row => matches(row, where)) || null,
      update: async ({ where, data }) => {
        const row = [project, otherProject].find(candidate => matches(candidate, where));
        if (!row) throw missing();
        state.updates.push({ kind: 'project', id: row.id, data });
        Object.assign(row, data);
        return row;
      },
    },
    evalRun: {
      findFirst: async ({ where }) => { try { return lookupRun(where); } catch { return null; } },
      findUnique: async ({ where }) => { try { return lookupRun(where); } catch { return null; } },
      findUniqueOrThrow: async ({ where }) => lookupRun(where),
      update: async ({ where, data }) => {
        const row = runs.find(candidate => matches(candidate, where));
        if (!row) throw missing();
        state.updates.push({ kind: 'run', id: row.id, data });
        Object.assign(row, data);
        return row;
      },
    },
    promptItem: {
      findMany: async ({ where }) => structuredClone(items.filter(row => matches(row, where))),
      findUniqueOrThrow: async ({ where }) => {
        await state.onItemCheck();
        const row = items.find(candidate => matches(candidate, where));
        if (!row) throw missing();
        return structuredClone(row);
      },
    },
    modelResponse: {
      findMany: async ({ where }) => structuredClone(responses.filter(row => matches(row, where))),
      findUniqueOrThrow: async ({ where }) => {
        await state.onResponseCheck();
        const row = responses.find(candidate => matches(candidate, where));
        if (!row) throw missing();
        return structuredClone(row);
      },
      count: async ({ where }) => responses.filter(row => matches(row, where)).length,
      create: async ({ data }) => {
        lookupRun(data.evalRun.connect);
        if (!items.some(row => matches(row, data.promptItem.connect))) throw missing();
        state.saved.push(data);
        return { id: 'saved-' + state.saved.length, ...data };
      },
    },
    judgeScore: { create: async ({ data }) => { state.scores.push(data); return data; } },
    evalReport: { create: async ({ data }) => {
      lookupRun(data.evalRun.connect);
      state.reports.push(data);
      return data;
    } },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (value, options) => Response.json(value, options) } },
    '@/lib/db/client': { prisma },
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: project.userId } } }) } }) },
    '@/lib/connectors/registry': { getConnector: () => ({
      send: async messages => { state.calls.push(structuredClone(messages)); return state.onSend(); },
      estimateCost: () => 0.01,
    }) },
    '@/lib/db/api-keys': { getUserApiKey: async () => { await state.onApiKey(); return 'synthetic-test-only-key'; } },
    '@/lib/governance/pii-masker': { maskPII: content => ({ masked: content, maskCount: 0, patterns: [] }) },
    '@/lib/governance/event-logger': { logEvent: () => {} },
    '@/lib/connectors/types': { SUPPORTED_MODELS: [
      { model: 'synthetic-target', provider: 'OPENAI' }, { model: 'synthetic-judge', provider: 'OPENAI' },
    ], MODEL_PRICING: {} },
    '@/lib/eval/judge': {},
    '@/lib/eval/metrics-calculator': { calculateObjectiveMetrics: () => [], normalizeScores: () => [] },
    '@/lib/eval/score-aggregator': { getDefaultWeights: () => ({}), computeWeightedRanking: () => [], buildScoreMatrix: () => [] },
    '@/lib/eval/report-generator': {
      selectHighlights: () => [], buildCostProjection: () => [],
      generateRecommendation: async () => {
        if (state.recommendationError) throw state.recommendationError;
        return 'Synthetic recommendation';
      },
    },
  };
  const params = { evalRunId: run.id, projectId: project.id, userId: project.userId,
    promptSetId: ownSet.id, promptItems: [{ id: item.id, prompt: 'UNTRUSTED_CALLER_PROMPT', goldStandardHint: null }],
    targetModels: run.targetModels };
  const foreignSnapshot = () => JSON.stringify([otherProject, foreignRun, foreignItem]);
  const removeItem = () => items.splice(items.indexOf(item), 1);
  const moveItem = () => { item.promptSetId = anotherSet.id; item.promptSet = anotherSet; };
  const execute = extra => load('src/lib/eval/execution-engine.ts', mocks).executeEvaluation({ ...params, ...extra });
  const post = body => load(STEP, mocks).POST(
    new Request('https://synthetic.test/', { method: 'POST', body: JSON.stringify(body) }),
    { params: { id: project.id, runId: run.id } }
  );
  return { state, params, run, execute, post, removeItem, moveItem, foreignSnapshot };
}

for (const change of ['removeItem', 'moveItem']) {
  for (const entrypoint of ['worker', 'step']) {
    test(entrypoint + ' blocks a prompt whose membership changes before dispatch: ' + change, async () => {
      const fixture = setup();
      const before = fixture.foreignSnapshot();
      fixture.state.onApiKey = async () => fixture[change]();
      if (entrypoint === 'worker') {
        await assert.rejects(fixture.execute(), error => error.code === 'P2025');
      } else {
        const response = await fixture.post({ step: 'execute', model: 'synthetic-target', promptItemIds: ['item-a'] });
        assert.equal(response.status, 404);
      }
      assert.equal(fixture.state.calls.length, 0);
      assert.equal(fixture.state.saved.length, 0);
      assert.equal(fixture.foreignSnapshot(), before, 'Unrelated owner records must remain unchanged');
    });
  }
}

test('worker rechecks prompt membership on a rate-limit retry', async () => {
  const fixture = setup();
  fixture.state.onSend = async () => { fixture.moveItem(); throw new Error('429 synthetic rate limit'); };
  await assert.rejects(fixture.execute(), error => error.code === 'P2025');
  assert.equal(fixture.state.calls.length, 1, 'Revocation before retry must prevent the second provider call');
  assert.equal(fixture.state.saved.length, 0);
});

for (const callback of [
  { name: 'synchronous throw', notify: () => { throw new Error('Synthetic delivery failure'); } },
  { name: 'rejected promise', notify: async () => { throw new Error('Synthetic delivery failure'); } },
]) {
  test('worker preserves the response and cost when progress delivery fails: ' + callback.name, async () => {
    const fixture = setup();
    await fixture.execute({ onProgress: callback.notify });
    assert.equal(fixture.state.calls.length, 1);
    assert.equal(fixture.state.calls[0][0].content, 'Synthetic database prompt');
    assert.equal(fixture.state.saved.length, 1);
    assert.equal(fixture.state.saved[0].status, 'COMPLETED');
    assert.equal(fixture.state.saved[0].content, 'Synthetic provider answer');
    assert.equal(fixture.run.actualCostUsd, 0.01);
  });
}

test('worker propagates an unexpected dispatch-check failure instead of resolving an empty evaluation', async () => {
  const fixture = setup();
  const unavailable = new Error('Synthetic database unavailable');
  fixture.state.onItemCheck = async () => { throw unavailable; };
  await assert.rejects(fixture.execute(), error => error === unavailable);
  assert.equal(fixture.state.calls.length, 0);
  assert.equal(fixture.state.saved.length, 0);
  assert.equal(fixture.state.updates.length, 0);
});

for (const step of ['execute', 'judge']) {
  test('step propagates an unexpected ' + step + ' dispatch-check failure as an error response', async () => {
    const fixture = setup();
    const before = fixture.foreignSnapshot();
    const fail = async () => { throw new Error('Synthetic database unavailable'); };
    if (step === 'execute') fixture.state.onItemCheck = fail;
    else fixture.state.onResponseCheck = fail;
    const response = await fixture.post({ step, model: 'synthetic-target', promptItemIds: ['item-a'] });
    assert.equal(response.status, 500);
    assert.equal(fixture.state.calls.length, 0);
    assert.equal(fixture.state.saved.length, 0);
    assert.equal(fixture.state.scores.length, 0);
    assert.equal(fixture.foreignSnapshot(), before);
  });
}

for (const entrypoint of ['worker', 'step']) {
  test(entrypoint + ' still records ordinary provider failures as failed responses', async () => {
    const fixture = setup();
    fixture.state.onSend = async () => { throw new Error('Synthetic provider failure'); };
    if (entrypoint === 'worker') await fixture.execute();
    else assert.equal((await fixture.post({ step: 'execute', model: 'synthetic-target', promptItemIds: ['item-a'] })).status, 200);
    assert.equal(fixture.state.calls.length, 1);
    assert.equal(fixture.state.saved.length, 1);
    assert.equal(fixture.state.saved[0].status, 'FAILED');
    assert.equal(fixture.state.saved[0].content, '');
  });
}

for (const code of ['EVALUATION_SCOPE_LOST', 'P2025']) {
  test('step report must not turn a detected scope failure into a fallback report: ' + code, async () => {
    const fixture = setup();
    fixture.state.recommendationError = Object.assign(new Error('Synthetic lost scope'), { code });
    const response = await fixture.post({ step: 'report' });
    assert.equal(response.status, 404);
    assert.equal(fixture.state.reports.length, 0);
    assert.ok(fixture.state.updates.every(update => update.data.status !== 'COMPLETED'));
  });
}

test('step report retains the fallback for an ordinary recommendation provider failure', async () => {
  const fixture = setup();
  fixture.state.recommendationError = new Error('Synthetic recommendation provider failure');
  const response = await fixture.post({ step: 'report' });
  assert.equal(response.status, 200);
  assert.equal(fixture.state.reports.length, 1);
  assert.match(fixture.state.reports[0].recommendation, /推奨アクションの生成に失敗/);
  assert.equal(fixture.run.status, 'COMPLETED');
});

test('worker rejects a foreign prompt ID before dispatch and leaves that owner unchanged', async () => {
  const fixture = setup();
  const before = fixture.foreignSnapshot();
  await assert.rejects(fixture.execute({ promptItems: [{ id: 'item-b' }] }), error => error.code === 'EVALUATION_SCOPE_LOST');
  assert.equal(fixture.state.calls.length, 0);
  assert.equal(fixture.state.saved.length, 0);
  assert.equal(fixture.foreignSnapshot(), before);
});
