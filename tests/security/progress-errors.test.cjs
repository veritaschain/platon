const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('progress SSE never returns internal evaluator or database error details', async () => {
  const filename = path.resolve(__dirname, '../../src/app/api/projects/[id]/eval-runs/[runId]/progress/route.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const called = [];
  const logs = [];
  const mocks = {
    '@/lib/supabase/server': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fixture-owner' } } }) } }) },
    '@/lib/db/client': { prisma: {
      evalProject: { findFirst: async () => ({ id: 'fixture-project', userId: 'fixture-owner' }) },
      evalRun: { findUnique: async () => ({ id: 'fixture-run', projectId: 'fixture-project', status: 'PENDING' }) },
    } },
    '@/lib/eval/orchestrator': { runFullEvaluation: async (...args) => {
      called.push(args.slice(0, 3));
      throw Object.assign(new Error('PRIVATE_DATABASE_CONNECTION_AND_QUERY_DETAILS'), { code: 'P2025' });
    } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', source)(name => {
    assert.ok(Object.hasOwn(mocks, name), 'Unexpected route import');
    return mocks[name];
  }, module, module.exports, { log() {}, error: (...args) => logs.push(args) });
  const response = await module.exports.GET(new Request('https://synthetic.test/'), {
    params: { id: 'fixture-project', runId: 'fixture-run' },
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.deepEqual(called, [['fixture-run', 'fixture-owner', 'fixture-project']]);
  assert.doesNotMatch(body, /PRIVATE_DATABASE|P2025/);
  assert.match(body, /評価中にエラーが発生しました/);
  assert.deepEqual(logs, [['[progress] Evaluation failed']]);
});
