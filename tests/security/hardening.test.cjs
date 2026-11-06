// Synthetic regression tests execute the actual TypeScript handlers with fake
// sessions and an in-memory relation-aware DB. No real accounts or AI calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOT = process.env.PLATON_TEST_SOURCE_ROOT
  ? path.resolve(process.env.PLATON_TEST_SOURCE_ROOT) : path.resolve(__dirname, '../..');

function load(file, mocks = {}) {
  const filename = path.resolve(ROOT, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  function resolve(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === '@/lib/eval/scope') return load('src/lib/eval/scope.ts', mocks);
    if (name.startsWith('.')) return load(path.relative(ROOT, path.resolve(path.dirname(filename), name + '.ts')), mocks);
    throw Error('Unexpected test import: ' + name);
  }
  new Function('require', 'module', 'exports', source)(resolve, module, module.exports);
  return module.exports;
}
function matches(row, where) {
  return row && Object.entries(where || {}).every(([key, value]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(v => matches(row, v));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Object.hasOwn(value, 'in')) return value.in.includes(row[key]);
      return matches(row[key], value.is || value);
    }
    return row[key] === value;
  });
}
function setup(user = { id: 'owner-a' }) {
  const projects = [
    { id: 'project-a', userId: 'owner-a', name: 'A' },
    { id: 'project-b', userId: 'owner-b', name: 'B' },
    { id: 'project-c', userId: 'owner-a', name: 'C' },
  ];
  const sets = projects.map((project, i) => ({ id: 'set-' + 'abc'[i], projectId: project.id, project }));
  const items = sets.map((promptSet, i) => ({ id: 'item-' + 'abc'[i], promptSetId: promptSet.id,
    promptSet, prompt: 'synthetic ' + i, category: 'GENERAL', evaluationFocus: 'accuracy' }));
  const runs = projects.map((project, i) => ({ id: 'run-' + 'abc'[i], projectId: project.id,
    project, promptSetId: sets[i].id, promptSet: { ...sets[i], promptItems: [items[i]] }, status: 'COMPLETED' }));
  const reports = runs.map(evalRun => ({ evalRunId: evalRun.id, evalRun, rankings: [], scoreMatrix: [],
    highlights: [], costProjection: [], recommendation: 'synthetic' }));
  const responses = runs.map((evalRun, i) => ({ id: 'response-' + i, evalRunId: evalRun.id, evalRun, promptItem: items[i] }));
  const calls = [];
  function model(name, rows) {
    const get = async ({ where }) => { calls.push([name, 'read', where]); return rows.find(r => matches(r, where)) || null; };
    return {
      findFirst: get, findUnique: get,
      findUniqueOrThrow: async args => { const row = await get(args); if (!row) throw Object.assign(Error('not found'), { code: 'P2025' }); return row; },
      findMany: async ({ where }) => rows.filter(r => matches(r, where)),
      update: async ({ where, data }) => {
        calls.push([name, 'update', where]);
        const row = rows.find(r => matches(r, where));
        if (!row) throw Object.assign(Error('not found'), { code: 'P2025' });
        Object.assign(row, data); return row;
      },
      delete: async ({ where }) => {
        calls.push([name, 'delete', where]);
        const index = rows.findIndex(r => matches(r, where));
        if (index < 0) throw Object.assign(Error('not found'), { code: 'P2025' });
        return rows.splice(index, 1)[0];
      },
    };
  }
  const prisma = { evalProject: model('project', projects), promptItem: model('item', items),
    evalRun: model('run', runs), modelResponse: model('response', responses), evalReport: model('report', reports) };
  const mocks = {
    'next/server': { NextResponse: { json: (value, options) => Response.json(value, options) } },
    '@/lib/db/client': { prisma },
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    '@/lib/eval/orchestrator': { runFullEvaluation: async () => { throw Error('No evaluation permitted in synthetic GET fixture'); } },
  };
  return { mocks, calls, items, responses };
}
const prefix = 'src/app/api/projects/[id]/eval-runs/[runId]/';
for (const route of ['route.ts', 'responses/route.ts', 'report/route.ts', 'report/export/route.ts', 'progress/route.ts']) {
  for (const child of ['run-b', 'run-c']) {
    test(route + ' rejects child outside requested owned project: ' + child, async () => {
      const { mocks } = setup();
      const response = await load(prefix + route, mocks).GET(new Request('https://synthetic.test/?format=json'),
        { params: { id: 'project-a', runId: child } });
      assert.equal(response.status, 404);
    });
  }
  test(route + ' retains same-project access', async () => {
    const { mocks } = setup();
    const response = await load(prefix + route, mocks).GET(new Request('https://synthetic.test/?format=json'),
      { params: { id: 'project-a', runId: 'run-a' } });
    assert.equal(response.status, 200);
    await response.text();
  });
}
const itemRoute = 'src/app/api/projects/[id]/prompt-set/items/[itemId]/route.ts';
for (const method of ['PATCH', 'DELETE']) {
  for (const item of ['item-b', 'item-c']) {
    test(method + ' refuses foreign-project child without changing it: ' + item, async () => {
      const { mocks, items } = setup();
      const before = JSON.stringify(items);
      const request = new Request('https://synthetic.test/', { method, body: method === 'PATCH' ? JSON.stringify({ prompt: 'changed' }) : undefined });
      const response = await load(itemRoute, mocks)[method](request, { params: { id: 'project-a', itemId: item } });
      assert.equal(response.status, 404);
      assert.equal(JSON.stringify(items), before);
    });
  }
  test(method + ' retains same-project operation', async () => {
    const { mocks } = setup();
    const request = new Request('https://synthetic.test/', { method, body: method === 'PATCH' ? JSON.stringify({ prompt: 'changed' }) : undefined });
    const response = await load(itemRoute, mocks)[method](request, { params: { id: 'project-a', itemId: 'item-a' } });
    assert.equal(response.status, 200);
  });
}
test('unauthenticated access is rejected before any DB operation', async () => {
  const { mocks, calls } = setup(null);
  const response = await load(itemRoute, mocks).DELETE(new Request('https://synthetic.test/'),
    { params: { id: 'project-a', itemId: 'item-a' } });
  assert.equal(response.status, 401); assert.equal(calls.length, 0);
});
for (const file of ['src/lib/crypto.ts', 'src/lib/crypto/encryption.ts']) {
  for (const key of [undefined, '', 'short', 'g'.repeat(64)]) {
    test(file + ' rejects missing/malformed key ' + String(key), () => {
      const previous = process.env.ENCRYPTION_KEY;
      try {
        if (key === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = key;
        const crypto = load(file, { crypto: require('node:crypto') });
        assert.throws(() => crypto.encrypt('synthetic secret'), /ENCRYPTION_KEY/);
      } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
    });
  }
}
test('both encryption entrypoints share the existing AES-GCM wire format', () => {
  const previous = process.env.ENCRYPTION_KEY;
  try {
    process.env.ENCRYPTION_KEY = '3a'.repeat(32);
    const a = load('src/lib/crypto.ts', { crypto: require('node:crypto') });
    const b = load('src/lib/crypto/encryption.ts', { crypto: require('node:crypto') });
    assert.equal(a.decrypt(b.encrypt('合成のAPIキー')), '合成のAPIキー');
    assert.equal(b.decrypt(a.encrypt('synthetic')), 'synthetic');
    assert.equal(a.decrypt(a.encrypt('')), '');
    const parts = a.encrypt('synthetic').split(':'); parts[1] = '00'.repeat(16);
    assert.throws(() => a.decrypt(parts.join(':')));
  } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
});

function stepMocks(state) {
  const fail = async () => { throw Error('Provider call forbidden in authorization test'); };
  Object.assign(state.mocks, {
    '@/lib/connectors/registry': { getConnector: () => ({ send: fail }) },
    '@/lib/db/api-keys': { getUserApiKey: fail },
    '@/lib/governance/pii-masker': { maskPII: text => ({ masked: text, maskCount: 0 }) },
    '@/lib/connectors/types': { SUPPORTED_MODELS: [], MODEL_PRICING: {} },
    '@/lib/eval/judge': {}, '@/lib/eval/metrics-calculator': {},
    '@/lib/eval/score-aggregator': {}, '@/lib/eval/report-generator': {},
  });
  return state.mocks;
}
for (const step of ['init', 'execute', 'judge', 'report']) {
  test('step ' + step + ' rejects a different-project run before any mutation', async () => {
    const state = setup();
    const response = await load(prefix + 'step/route.ts', stepMocks(state)).POST(
      new Request('https://synthetic.test/', { method: 'POST', body: JSON.stringify({ step }) }),
      { params: { id: 'project-a', runId: 'run-b' } });
    assert.equal(response.status, 404);
    assert.equal(state.calls.filter(c => c[1] === 'update' || c[1] === 'delete').length, 0);
  });
}
test('step rejects foreign prompt IDs before reading API keys or calling a provider', async () => {
  const state = setup();
  const runModel = state.mocks['@/lib/db/client'].prisma.evalRun;
  const original = runModel.findFirst;
  runModel.findFirst = async args => { const run = await original(args); if (run) run.targetModels = ['synthetic-model']; return run; };
  const response = await load(prefix + 'step/route.ts', stepMocks(state)).POST(
    new Request('https://synthetic.test/', { method: 'POST', body: JSON.stringify({ step: 'execute', model: 'synthetic-model', promptItemIds: ['item-b'] }) }),
    { params: { id: 'project-a', runId: 'run-a' } });
  assert.equal(response.status, 404);
  assert.equal(state.calls.filter(c => c[1] === 'update').length, 0);
});
test('step authentication failure cannot mutate the supplied run in the catch path', async () => {
  const state = setup();
  stepMocks(state);
  state.mocks['@/lib/supabase/server'] = { createClient: () => ({ auth: { getUser: async () => { throw Error('synthetic auth unavailable'); } } }) };
  const response = await load(prefix + 'step/route.ts', state.mocks).POST(
    new Request('https://synthetic.test/', { method: 'POST', body: '{}' }),
    { params: { id: 'project-a', runId: 'run-b' } });
  assert.equal(response.status, 500);
  assert.equal(state.calls.filter(c => c[1] === 'update').length, 0);
});
test('scope is checked again at mutation after the earlier parent read', async () => {
  const state = setup();
  const db = state.mocks['@/lib/db/client'].prisma;
  const find = db.evalProject.findFirst;
  db.evalProject.findFirst = async args => { const row = await find(args); if (row) row.userId = 'new-owner'; return row; };
  const response = await load(itemRoute, state.mocks).PATCH(
    new Request('https://synthetic.test/', { method: 'PATCH', body: JSON.stringify({ prompt: 'changed' }) }),
    { params: { id: 'project-a', itemId: 'item-a' } });
  assert.equal(response.status, 404);
  assert.equal(state.items[0].prompt, 'synthetic 0');
});
