const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');

function loader(mocks, messages) {
  function load(file) {
    const filename = path.resolve(ROOT, file);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'console', source)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.relative(ROOT, path.resolve(path.dirname(filename), name + '.ts')));
      if (name === 'crypto') return require('node:crypto');
      throw new Error('Unexpected error-privacy test import');
    }, module, module.exports, { error: (...args) => messages.push(args), log: (...args) => messages.push(args) });
    return module.exports;
  }
  return load;
}

test('provider error details do not enter persisted audit events', async () => {
  const marker = 'SYNTHETIC_PROVIDER_CREDENTIAL_MARKER';
  const events = [], logs = [], responses = [];
  const item = { id: 'item', prompt: 'Synthetic input', goldStandardHint: null };
  const prisma = {
    evalRun: { findUniqueOrThrow: async () => ({ id: 'run', promptSetId: 'set', targetModels: ['fixture-model'], judgeModel: 'fixture-model' }), update: async () => ({}) },
    promptItem: { findMany: async () => [item], findUniqueOrThrow: async () => item },
    modelResponse: { create: async ({ data }) => { responses.push(data); return { id: 'response' }; } },
    eventLog: { create: async ({ data }) => { events.push(data); return data; } },
  };
  const load = loader({
    '@/lib/db/client': { prisma },
    '@/lib/db/api-keys': { getUserApiKey: async () => 'synthetic-test-only-key' },
    '@/lib/connectors/types': { SUPPORTED_MODELS: [{ model: 'fixture-model', provider: 'OPENAI' }], MODEL_PRICING: {} },
    '@/lib/connectors/registry': { getConnector: () => ({ send: async () => { throw new Error(marker); }, estimateCost: () => 0 }) },
  }, logs);
  await load('src/lib/eval/execution-engine.ts').executeEvaluation({
    evalRunId: 'run', userId: 'owner', projectId: 'project', promptSetId: 'set',
    promptItems: [item], targetModels: ['fixture-model'],
  });
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 'FAILED');
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.error, 'Provider request failed');
  assert.ok(!JSON.stringify([events, logs, responses]).includes(marker));
});

test('audit logger failure does not print database exception details', async () => {
  const marker = 'SYNTHETIC_DATABASE_CREDENTIAL_MARKER';
  const logs = [];
  const load = loader({ '@/lib/db/client': { prisma: { eventLog: {
    create: async () => { throw new Error(marker); },
  } } } }, logs);
  await load('src/lib/governance/event-logger.ts').logEvent('fixture-owner', 'fixture-run', 'model_run', { status: 'FAILED' });
  assert.deepEqual(logs, [['[event-log] Event persistence failed']]);
  assert.ok(!JSON.stringify(logs).includes(marker));
});
