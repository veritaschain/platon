// Exercise the real full evaluator with a relation-aware synthetic database.
// Historical cross-project response rows must not reach judging or reporting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');

function load(file, mocks) {
  const filename = path.resolve(ROOT, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw Error('Unexpected test import: ' + name);
  }, module, module.exports);
  return module.exports;
}

function matches(row, where) {
  return row && Object.entries(where || {}).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return matches(row[key], value.is || value);
    }
    return row[key] === value;
  });
}

function setup(contamination) {
  const project = { id: 'project-a', userId: 'owner-a', useCaseProfile: null };
  const promptSet = { id: 'set-a', projectId: project.id, project };
  const item = { id: 'item-a', promptSetId: promptSet.id, promptSet,
    prompt: 'Synthetic permitted prompt', goldStandardHint: null, category: 'GENERAL' };
  const run = { id: 'run-a', projectId: project.id, project, promptSetId: promptSet.id,
    promptSet: { ...promptSet, promptItems: [item] },
    targetModels: ['synthetic-model'], judgeModel: 'synthetic-judge', status: 'PENDING' };
  const allowed = { id: 'response-a', evalRunId: run.id, evalRun: run,
    promptItemId: item.id, promptItem: item, status: 'COMPLETED',
    content: 'Synthetic permitted answer', provider: 'OPENAI', model: 'synthetic-model',
    inputTokens: 10, outputTokens: 10, judgeScore: null };
  const rows = [allowed];
  if (contamination) {
    const foreignProject = contamination === 'another-set'
      ? project
      : { id: 'foreign-project', userId: contamination === 'foreign-owner' ? 'owner-b' : 'owner-a' };
    const foreignSet = { id: 'foreign-set', projectId: foreignProject.id, project: foreignProject };
    const foreignItem = { ...item, id: 'foreign-item', promptSetId: foreignSet.id, promptSet: foreignSet,
      prompt: 'FOREIGN_PRIVATE_PROMPT', goldStandardHint: 'FOREIGN_PRIVATE_HINT' };
    rows.push({ ...allowed, id: 'foreign-response', promptItemId: foreignItem.id,
      promptItem: foreignItem, content: 'FOREIGN_PRIVATE_ANSWER' });
  }
  const captured = { execution: [], judging: [], metrics: [], reports: [], updates: [], progress: [] };
  const prisma = {
    evalRun: {
      findUniqueOrThrow: async ({ where }) => {
        assert.ok(matches(run, where));
        return run;
      },
      update: async ({ data }) => { captured.updates.push(data.status); return run; },
    },
    evalProject: { update: async () => project },
    modelResponse: { findMany: async ({ where }) => rows.filter(row => matches(row, where)) },
    evalReport: { create: async ({ data }) => { captured.reports.push(data); return data; } },
  };
  const mocks = {
    '@/lib/db/client': { prisma },
    '@/lib/governance/event-logger': { logEvent: () => {} },
    './execution-engine': { executeEvaluation: async params => { captured.execution.push(params); } },
    './judge': { judgeAllResponses: async params => { captured.judging.push(params.responses); } },
    './metrics-calculator': {
      calculateObjectiveMetrics: responses => { captured.metrics.push(responses); return []; },
      normalizeScores: value => value,
    },
    './score-aggregator': {
      getDefaultWeights: () => ({}), computeWeightedRanking: () => [], buildScoreMatrix: () => [],
    },
    './report-generator': {
      selectHighlights: (_prompts, responses) => responses,
      buildCostProjection: responses => responses,
      generateRecommendation: async () => 'Synthetic recommendation',
    },
  };
  return { mocks, captured, rows };
}

for (const contamination of [null, 'foreign-owner', 'another-project', 'another-set']) {
  test('full evaluator keeps response scope: ' + (contamination || 'valid current run'), async () => {
    const { mocks, captured, rows } = setup(contamination);
    const before = JSON.stringify(rows);
    await load('src/lib/eval/orchestrator.ts', mocks).runFullEvaluation('run-a', 'owner-a',
      event => captured.progress.push(event.type));

    assert.equal(captured.execution.length, 1);
    assert.deepEqual(captured.execution[0].promptItems.map(item => item.id), ['item-a']);
    assert.equal(captured.judging.length, 1);
    assert.deepEqual(captured.judging[0].map(response => response.modelResponseId), ['response-a']);
    assert.equal(captured.metrics.length, 1);
    assert.deepEqual(captured.metrics[0].map(response => response.id), ['response-a']);
    assert.equal(captured.reports.length, 1);
    assert.equal(captured.reports[0].highlights.length, 1);
    assert.equal(captured.reports[0].costProjection.length, 1);
    assert.ok(!JSON.stringify(captured.reports).includes('FOREIGN_PRIVATE'));
    assert.ok(captured.updates.includes('COMPLETED'));
    assert.ok(captured.progress.includes('complete'));
    assert.equal(JSON.stringify(rows), before, 'Historical records must not be silently rewritten');
  });
}
