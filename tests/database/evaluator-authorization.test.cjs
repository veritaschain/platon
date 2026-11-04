'use strict';

// Real Prisma/PostgreSQL and actual evaluator source. Only provider transport,
// key lookup and audit-event transport are synthetic; no external AI is called.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');
const ROOT = path.resolve(__dirname, '../..');
const SOURCE_ROOT = process.env.PLATON_TEST_SOURCE_ROOT
  ? path.resolve(process.env.PLATON_TEST_SOURCE_ROOT) : ROOT;
const baselineProbe = process.env.PLATON_TEST_BASELINE_PROBE === '1';
const TARGET = 'fixture-target';
const JUDGE = 'fixture-judge';
const SCORE = JSON.stringify(Object.fromEntries(
  ['accuracy', 'relevance', 'conciseness', 'tone', 'instruction_following']
    .map(axis => [axis, { score: 4, reason: 'Synthetic justified score' }])
));

function testUrl() {
  const value = process.env.PLATON_TEST_DATABASE_URL;
  assert.ok(value, 'PLATON_TEST_DATABASE_URL is required; application URLs are never used.');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Loopback test database required.');
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^platon_security_test(?:_[a-z0-9]+)*$/);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.ok(url.username);
  return url.href;
}

function loader(mocks) {
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(SOURCE_ROOT, file);
    assert.ok(filename.startsWith(SOURCE_ROOT + path.sep), 'Source import escaped the reviewed tree.');
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module);
    new Function('require', 'module', 'exports', source)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.relative(SOURCE_ROOT, path.resolve(path.dirname(filename), name + '.ts')));
      throw new Error('Unexpected evaluator import: ' + name);
    }, module, module.exports);
    return module.exports;
  }
  return load;
}

async function fixture(db) {
  const prefix = 'worker_' + randomBytes(8).toString('hex');
  const ids = Object.fromEntries(['userA', 'userB', 'a', 'b', 'c', 'setA', 'setB', 'setC', 'itemA', 'itemB', 'itemC', 'runA', 'runB', 'runC']
    .map(key => [key, prefix + '_' + key]));
  const profile = { domain: 'Support for domain@example.test', audience: 'audience@example.test', priority: ['accuracy'] };
  for (const [project, owner, set, item, run] of [
    ['a', 'userA', 'setA', 'itemA', 'runA'],
    ['b', 'userB', 'setB', 'itemB', 'runB'],
    ['c', 'userA', 'setC', 'itemC', 'runC'],
  ]) {
    await db.evalProject.create({ data: { id: ids[project], userId: ids[owner], name: 'Synthetic project', useCaseProfile: profile } });
    await db.promptSet.create({ data: { id: ids[set], projectId: ids[project], source: 'IMPORTED' } });
    await db.promptItem.create({ data: {
      id: ids[item], promptSetId: ids[set], category: 'GENERAL', orderIndex: 0,
      prompt: 'Synthetic question: prompt@example.test 090-1234-5678',
      goldStandardHint: 'Synthetic hint: hint@example.test', evaluationFocus: 'Accuracy',
    } });
    await db.evalRun.create({ data: {
      id: ids[run], projectId: ids[project], promptSetId: ids[set], targetModels: [TARGET], judgeModel: JUDGE,
    } });
  }
  const scope = { userId: ids.userA, projectId: ids.a, evalRunId: ids.runA, promptSetId: ids.setA };
  const calls = [];
  const keys = [];
  const state = { ids, scope, calls, keys, profile, onKey: null, onSend: null };
  const load = loader({
    '@/lib/db/client': { prisma: db },
    '@/lib/db/api-keys': { getUserApiKey: async (userId, provider) => {
      keys.push({ userId, provider });
      if (state.onKey) await state.onKey(userId, provider);
      return 'synthetic-test-only-key';
    } },
    '@/lib/connectors/registry': { getConnector: () => ({
      send: async (messages, config) => {
        const call = { messages: structuredClone(messages), model: config.model };
        calls.push(call);
        if (state.onSend) {
          const overridden = await state.onSend(call);
          if (overridden) return overridden;
        }
        return { content: config.model === JUDGE ? SCORE : config.model === TARGET
          ? 'Synthetic answer: answer@example.test' : 'Synthetic recommendation', inputTokens: 12, outputTokens: 8 };
      },
      estimateCost: () => 0.0001,
    }) },
    '@/lib/governance/event-logger': { logEvent: () => {} },
    '@/lib/connectors/types': {
      SUPPORTED_MODELS: [{ model: TARGET, provider: 'OPENAI' }, { model: JUDGE, provider: 'OPENAI' }],
      MODEL_PRICING: { [TARGET]: { input: 0.15, output: 0.6 } },
    },
  });
  state.worker = async (run = ids.runA, user = ids.userA, project = ids.a) => {
    const fn = load('src/lib/eval/orchestrator.ts').runFullEvaluation;
    // The immutable pre-fix source had three arguments. Its negative control
    // must exercise its real behavior, not fail because of a changed signature.
    return fn.length >= 4 ? fn(run, user, project, () => {}) : fn(run, user, () => {});
  };
  state.execute = async () => load('src/lib/eval/execution-engine.ts').executeEvaluation({
    ...scope, targetModels: [TARGET], promptItems: [{
      id: ids.itemA, prompt: 'Stale supplied text must not replace stored input', goldStandardHint: null,
    }],
  });
  state.addResponse = async (itemId = ids.itemA) => db.modelResponse.create({ data: {
    evalRunId: ids.runA, promptItemId: itemId, provider: 'OPENAI', model: TARGET,
    content: 'Synthetic stored response: answer@example.test', inputTokens: 12, outputTokens: 8,
  } });
  state.judge = async response => load('src/lib/eval/judge.ts').judgeAllResponses({
    ...scope, judgeModel: JUDGE, useCaseProfile: profile,
    responses: [{ modelResponseId: response.id, prompt: 'Stale prompt', goldStandardHint: null, content: 'Stale answer' }],
  });
  state.revoke = async writer => writer.evalProject.update({ where: { id: ids.a }, data: { userId: ids.userB } });
  state.cleanup = async () => {
    const projectIds = [ids.a, ids.b, ids.c];
    await db.evalRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.promptSet.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.evalProject.deleteMany({ where: { id: { in: projectIds } } });
  };
  return state;
}

test('PostgreSQL evaluator authorization boundaries', { timeout: 120000 }, async t => {
  const url = testUrl();
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
  const writer = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const [server] = await db.$queryRawUnsafe("SELECT current_database() AS db, current_setting('server_version_num')::int AS version");
    assert.match(server.db, /^platon_security_test(?:_[a-z0-9]+)*$/);
    assert.ok(server.version >= 160000 && server.version < 170000);

    async function scenario(name, run, probe = false) {
      if (baselineProbe && !probe) return;
      await t.test(name, async () => {
        const state = await fixture(db);
        try { await run(state); } finally { await state.cleanup(); }
      });
    }

    await scenario('valid full evaluator persists response score and report', async s => {
      const original = await db.promptItem.findUniqueOrThrow({ where: { id: s.ids.itemA } });
      await s.worker();
      const run = await db.evalRun.findUniqueOrThrow({ where: { id: s.ids.runA }, include: { modelResponses: { include: { judgeScore: true } }, evalReport: true } });
      assert.equal(run.status, 'COMPLETED');
      assert.equal(run.modelResponses.length, 1);
      assert.ok(run.modelResponses[0].judgeScore);
      assert.equal(run.evalReport.recommendation, 'Synthetic recommendation');
      assert.equal(s.calls.length, 3);
      // The positive baseline control only proves the old worker can execute.
      // The fixed-source run additionally verifies every provider boundary.
      if (!baselineProbe) {
        for (const call of s.calls) {
          const text = call.messages.map(message => message.content).join('\n');
          assert.doesNotMatch(text, /[\w.-]+@example\.test|090-1234-5678/);
        }
        assert.match(s.calls[0].messages[0].content, /Synthetic question/);
        assert.doesNotMatch(s.calls[0].messages[0].content, /Stale/);
      }
      assert.deepEqual(await db.promptItem.findUniqueOrThrow({ where: { id: s.ids.itemA } }), original);
    }, true);

    await scenario('foreign owner cannot enter the full worker', async s => {
      await assert.rejects(s.worker(s.ids.runB, s.ids.userA, s.ids.b));
      assert.equal(s.calls.length, 0);
      assert.equal(s.keys.length, 0);
      assert.equal((await db.evalRun.findUniqueOrThrow({ where: { id: s.ids.runB } })).status, 'PENDING');
      assert.equal((await db.evalProject.findUniqueOrThrow({ where: { id: s.ids.b } })).status, 'DRAFT');
    }, true);

    await scenario('same owner cannot substitute another project at worker entry', async s => {
      await assert.rejects(s.worker(s.ids.runC, s.ids.userA, s.ids.a));
      assert.equal(s.calls.length, 0);
      assert.equal((await db.evalRun.findUniqueOrThrow({ where: { id: s.ids.runC } })).status, 'PENDING');
    });

    await scenario('historical cross-project prompt set cannot enter the worker', async s => {
      await writer.evalRun.update({ where: { id: s.ids.runA }, data: { promptSetId: s.ids.setB } });
      await assert.rejects(s.worker());
      assert.equal(s.calls.length, 0);
      assert.equal((await db.evalRun.findUniqueOrThrow({ where: { id: s.ids.runA } })).status, 'PENDING');
    });

    await scenario('owner revoked during key lookup prevents provider dispatch', async s => {
      s.onKey = async () => s.revoke(writer);
      await assert.rejects(s.execute());
      assert.equal(s.calls.length, 0);
      assert.equal(await db.modelResponse.count({ where: { evalRunId: s.ids.runA } }), 0);
      assert.equal((await db.evalRun.findUniqueOrThrow({ where: { id: s.ids.runA } })).actualCostUsd, null);
    }, true);

    await scenario('prompt moved during key lookup prevents provider dispatch', async s => {
      s.onKey = async () => writer.promptItem.update({ where: { id: s.ids.itemA }, data: { promptSetId: s.ids.setB } });
      await assert.rejects(s.execute());
      assert.equal(s.calls.length, 0);
      assert.equal(await db.modelResponse.count({ where: { evalRunId: s.ids.runA } }), 0);
    });

    await scenario('owner revoked during provider call prevents response persistence', async s => {
      s.onSend = async () => { await s.revoke(writer); };
      await assert.rejects(s.execute());
      assert.equal(s.calls.length, 1);
      assert.equal(await db.modelResponse.count({ where: { evalRunId: s.ids.runA } }), 0);
      assert.equal((await db.evalRun.findUniqueOrThrow({ where: { id: s.ids.runA } })).actualCostUsd, null);
    }, true);

    await scenario('changing the bound prompt set during dispatch prevents persistence', async s => {
      const anotherSet = await db.promptSet.create({ data: { projectId: s.ids.a, source: 'IMPORTED' } });
      s.onSend = async () => { await writer.evalRun.update({ where: { id: s.ids.runA }, data: { promptSetId: anotherSet.id } }); };
      await assert.rejects(s.execute());
      assert.equal(s.calls.length, 1);
      assert.equal(await db.modelResponse.count({ where: { evalRunId: s.ids.runA } }), 0);
    });

    await scenario('judge rechecks ownership before retrying malformed output', async s => {
      const response = await s.addResponse();
      s.onSend = async () => { await s.revoke(writer); return { content: 'malformed first response', inputTokens: 1, outputTokens: 1 }; };
      await assert.rejects(s.judge(response));
      assert.equal(s.calls.length, 1);
      assert.equal(await db.judgeScore.count({ where: { modelResponseId: response.id } }), 0);
    }, true);

    await scenario('judge rejects a response whose prompt moved to another set', async s => {
      const response = await s.addResponse();
      s.onKey = async () => writer.promptItem.update({ where: { id: s.ids.itemA }, data: { promptSetId: s.ids.setC } });
      await assert.rejects(s.judge(response));
      assert.equal(s.calls.length, 0);
      assert.equal(await db.judgeScore.count({ where: { modelResponseId: response.id } }), 0);
    });

    await scenario('owner revoked during judge call prevents score persistence', async s => {
      const response = await s.addResponse();
      s.onSend = async () => { await s.revoke(writer); };
      await assert.rejects(s.judge(response));
      assert.equal(s.calls.length, 1);
      assert.equal(await db.judgeScore.count({ where: { modelResponseId: response.id } }), 0);
    });

    await scenario('owner revoked during recommendation prevents report and failure writes', async s => {
      s.onSend = async call => { if (![TARGET, JUDGE].includes(call.model)) await s.revoke(writer); };
      await assert.rejects(s.worker());
      assert.equal(s.calls.length, 3);
      assert.equal(await db.evalReport.count({ where: { evalRunId: s.ids.runA } }), 0);
      assert.equal((await db.evalRun.findUniqueOrThrow({ where: { id: s.ids.runA } })).status, 'SCORING');
      assert.equal((await db.evalProject.findUniqueOrThrow({ where: { id: s.ids.a } })).status, 'RUNNING');
    });

    await scenario('historical foreign response is excluded without rewriting it', async s => {
      const foreign = await s.addResponse(s.ids.itemB);
      await db.modelResponse.update({ where: { id: foreign.id }, data: { content: 'FOREIGN_PRIVATE_RESPONSE' } });
      const before = await db.modelResponse.findUniqueOrThrow({ where: { id: foreign.id } });
      await s.worker();
      const report = await db.evalReport.findUniqueOrThrow({ where: { evalRunId: s.ids.runA } });
      assert.doesNotMatch(JSON.stringify(report), /FOREIGN_PRIVATE_RESPONSE/);
      assert.equal(await db.judgeScore.count({ where: { modelResponseId: foreign.id } }), 0);
      assert.deepEqual(await db.modelResponse.findUniqueOrThrow({ where: { id: foreign.id } }), before);
      assert.equal(s.calls.length, 3);
    });
  } finally {
    await Promise.all([db.$disconnect(), writer.$disconnect()]);
  }
});
