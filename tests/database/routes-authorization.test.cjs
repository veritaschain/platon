'use strict';

// Actual Prisma/PostgreSQL and actual transpiled route/helper code. Only the
// Supabase session, provider connector and API-key lookup are synthetic.
// CI populates an empty disposable service database from the unchanged main
// Prisma schema. No production migration or RLS policy change is tested here.
// No app DATABASE_URL/DIRECT_URL fallback and no external provider requests.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomBytes } = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const runRouteRoot = 'src/app/api/projects/[id]/eval-runs/[runId]/';
const itemRoutePath = 'src/app/api/projects/[id]/prompt-set/items/[itemId]/route.ts';
const targetModel = 'gpt-4o-mini';
const judgeModel = 'gpt-4o';
const syntheticKey = 'synthetic-platon-db-test-key';
const judgeResult = JSON.stringify(Object.fromEntries(
  ['accuracy', 'relevance', 'conciseness', 'tone', 'instruction_following']
    .map(axis => [axis, { score: 4, reason: 'Synthetic database test score' }])
));

function checkedDatabaseUrl(value) {
  assert.ok(typeof value === 'string' && value.length > 0,
    'PLATON_TEST_DATABASE_URL is required; application database URLs are never used.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid test database URL.'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required.');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only loopback test databases are allowed.');
  assert.equal(url.search, '', 'Test database URL options are forbidden.');
  assert.equal(url.hash, '', 'Test database URL fragments are forbidden.');
  let database, username, password;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { throw new Error('Invalid test database URL encoding.'); }
  assert.match(database, /^platon_security_test(?:_[a-z0-9]+)*$/, 'A dedicated platon_security_test database is required.');
  assert.match(username, /^[A-Za-z_][A-Za-z0-9_]*$/, 'An explicit test database user is required.');
  assert.doesNotMatch(password, /[\x00-\x1f\x7f]/, 'Invalid password characters.');
  url.searchParams.set('schema', 'public');
  return { url: url.href, database };
}

function runtimeLoader(prisma, state) {
  const cache = new Map();
  const connector = {
    async send(messages, config) {
      assert.equal(config.apiKey, syntheticKey);
      assert.ok([targetModel, judgeModel].includes(config.model));
      state.providerCalls.push(structuredClone({ messages, config }));
      if (state.onProvider) await state.onProvider(messages, config);
      return {
        content: config.model === judgeModel ? judgeResult : 'Synthetic permitted provider answer',
        inputTokens: 7, outputTokens: 11, latencyMs: 1,
      };
    },
    estimateCost: () => 0.000001,
  };
  const injections = {
    '@/lib/db/client': { prisma },
    '@/lib/db/prisma': { prisma },
    '@/lib/supabase/server': {
      createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) } }),
    },
    '@/lib/connectors/registry': {
      getConnector(provider) { assert.equal(provider, 'OPENAI'); return connector; },
    },
    '@/lib/db/api-keys': {
      async getUserApiKey(userId, provider) {
        assert.equal(userId, state.userId);
        assert.equal(provider, 'OPENAI');
        state.keyCalls.push({ userId, provider });
        if (state.onKey) await state.onKey(userId, provider);
        return syntheticKey;
      },
    },
  };
  function load(relative) {
    const filename = path.resolve(root, relative);
    assert.ok(filename.startsWith(path.join(root, 'src') + path.sep), 'Load repository source only.');
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    function localRequire(name) {
      if (Object.hasOwn(injections, name)) return injections[name];
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
      if (['next/server', '@prisma/client', 'crypto', 'node:crypto'].includes(name)) return require(name);
      throw new Error('Unexpected route-test import: ' + name);
    }
    // Run in the host realm so real NextResponse/Prisma see their normal Date,
    // Array and Error objects. The injected DB is a real client, not a double.
    const execute = new vm.Script('(function(require, module, exports, fetch) {\n' + source + '\n})', { filename }).runInThisContext();
    execute(localRequire, module, module.exports, async () => { throw new Error('Live HTTP is forbidden in database route tests.'); });
    return module.exports;
  }
  return load;
}

function request(method = 'GET', body) {
  return new Request('https://synthetic-platon.test/?format=json', {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

test('route database guard rejects unsafe connections without falling back to app URLs', () => {
  assert.equal(checkedDatabaseUrl('postgresql://postgres:fixture@127.0.0.1/platon_security_test').database, 'platon_security_test');
  for (const value of [
    undefined, '', 'invalid', 'https://localhost/platon_security_test',
    'postgresql://postgres:fixture@db.example/platon_security_test',
    'postgresql://postgres:fixture@127.0.0.1/production',
    'postgresql://postgres:fixture@127.0.0.1/postgres',
    'postgresql://postgres:fixture@127.0.0.1/platon_security_test?schema=public',
    'postgresql://postgres:fixture@127.0.0.1/platon_security_test?host=db.example',
    'postgresql://postgres:fixture@127.0.0.1/platon_security_test#fragment',
  ]) assert.throws(() => checkedDatabaseUrl(value));
});

test('real PostgreSQL routes preserve project scope across reads, writes and provider waits', { timeout: 180000 }, async t => {
  const connection = checkedDatabaseUrl(process.env.PLATON_TEST_DATABASE_URL);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(require('@prisma/client/package.json').version, lock.packages['node_modules/@prisma/client'].version);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: connection.url } }, log: [] });
  const otherConnection = new PrismaClient({ datasources: { db: { url: connection.url } }, log: [] });
  const prefix = 'route-security-' + randomBytes(8).toString('hex');
  const userA = prefix + '-user-a';
  const userB = prefix + '-user-b';
  const users = [userA, userB];
  const fixture = Object.fromEntries(['a', 'b', 'c'].map(label => [label, {
    project: prefix + '-project-' + label,
    set: prefix + '-set-' + label,
    responsePrompt: prefix + '-response-prompt-' + label,
    item: prefix + '-editable-prompt-' + label,
    run: prefix + '-run-' + label,
    response: prefix + '-response-' + label,
    report: prefix + '-report-' + label,
    marker: prefix + '-PRIVATE-' + label.toUpperCase(),
  }]));
  const projectIds = Object.values(fixture).map(row => row.project);
  let seeded = false;
  const state = {
    userId: userA, providerCalls: [], keyCalls: [], onProvider: null, onKey: null,
    afterParentRead: null, parentHookCalls: 0, queryCount: 0,
  };
  // This middleware delegates every operation to the real database first.
  // A second client commits an ownership change after the initial read returns,
  // before the handler can issue its later scoped read/write.
  prisma.$use(async (params, next) => {
    state.queryCount++;
    const result = await next(params);
    if (state.afterParentRead && params.model === 'EvalProject' && params.action === 'findFirst' &&
        params.args?.where?.id === fixture.a.project && params.args?.where?.userId === userA && result) {
      const hook = state.afterParentRead;
      state.afterParentRead = null;
      state.parentHookCalls++;
      await hook();
    }
    return result;
  });

  async function cleanup() {
    if (!seeded) return;
    // Only this invocation's random IDs/users are touched. Remove dependents
    // explicitly so legacy/current foreign-key restrictions remain intact.
    await otherConnection.$transaction(async tx => {
      await tx.judgeScore.deleteMany({ where: { modelResponse: { evalRun: { projectId: { in: projectIds } } } } });
      await tx.usageLog.deleteMany({ where: { userId: { in: users } } });
      await tx.eventLog.deleteMany({ where: { userId: { in: users } } });
      await tx.evalReport.deleteMany({ where: { evalRun: { projectId: { in: projectIds } } } });
      await tx.modelResponse.deleteMany({ where: { evalRun: { projectId: { in: projectIds } } } });
      await tx.evalRun.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.promptItem.deleteMany({ where: { promptSet: { projectId: { in: projectIds } } } });
      await tx.promptSet.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.evalProject.deleteMany({ where: { id: { in: projectIds } } });
    });
    seeded = false;
  }
  t.after(async () => {
    state.afterParentRead = null;
    try { await cleanup(); } finally { await Promise.all([prisma.$disconnect(), otherConnection.$disconnect()]); }
  });
  const [server] = await otherConnection.$queryRaw`SELECT current_database() AS database, current_schema() AS schema, current_setting('server_version_num')::integer AS version`;
  assert.equal(server.database, connection.database);
  assert.equal(server.schema, 'public');
  assert.ok(server.version >= 160000 && server.version < 170000, 'PostgreSQL 16 is required.');

  async function reset() {
    state.afterParentRead = null;
    state.onProvider = null;
    state.onKey = null;
    await cleanup();
    await otherConnection.$transaction(async tx => {
      for (const [label, row] of Object.entries(fixture)) {
        await tx.evalProject.create({ data: {
          id: row.project, userId: label === 'b' ? userB : userA, name: row.marker,
          status: 'COMPLETED', useCaseProfile: { domain: 'Synthetic domain', audience: 'Synthetic audience', priority: [] },
        } });
        await tx.promptSet.create({ data: { id: row.set, projectId: row.project, source: 'IMPORTED' } });
        await tx.promptItem.createMany({ data: [
          { id: row.responsePrompt, promptSetId: row.set, category: 'GENERAL', prompt: row.marker + ' response prompt', evaluationFocus: 'Synthetic focus', orderIndex: 0 },
          { id: row.item, promptSetId: row.set, category: 'GENERAL', prompt: row.marker + ' editable prompt', evaluationFocus: 'Synthetic focus', goldStandardHint: 'Synthetic hint', orderIndex: 1 },
        ] });
        await tx.evalRun.create({ data: {
          id: row.run, projectId: row.project, promptSetId: row.set,
          targetModels: [targetModel], judgeModel, status: 'COMPLETED',
        } });
        await tx.modelResponse.create({ data: {
          id: row.response, evalRunId: row.run, promptItemId: row.responsePrompt,
          provider: 'OPENAI', model: targetModel, content: row.marker + ' response',
          inputTokens: 7, outputTokens: 11, estimatedCostUsd: 0.000001, latencyMs: 1, status: 'COMPLETED',
        } });
        await tx.evalReport.create({ data: {
          id: row.report, evalRunId: row.run, rankings: [], scoreMatrix: [], highlights: [], costProjection: [], recommendation: row.marker + ' recommendation',
        } });
      }
    });
    seeded = true;
    Object.assign(state, { userId: userA, providerCalls: [], keyCalls: [], parentHookCalls: 0, queryCount: 0 });
  }
  async function snapshot() {
    return JSON.stringify(await Promise.all([
      otherConnection.evalProject.findMany({ where: { id: { in: projectIds } }, orderBy: { id: 'asc' } }),
      otherConnection.promptSet.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: 'asc' } }),
      otherConnection.promptItem.findMany({ where: { promptSet: { projectId: { in: projectIds } } }, orderBy: { id: 'asc' } }),
      otherConnection.evalRun.findMany({ where: { projectId: { in: projectIds } }, orderBy: { id: 'asc' } }),
      otherConnection.modelResponse.findMany({ where: { evalRun: { projectId: { in: projectIds } } }, orderBy: { id: 'asc' } }),
      otherConnection.judgeScore.findMany({ where: { modelResponse: { evalRun: { projectId: { in: projectIds } } } }, orderBy: { id: 'asc' } }),
      otherConnection.evalReport.findMany({ where: { evalRun: { projectId: { in: projectIds } } }, orderBy: { id: 'asc' } }),
    ]));
  }
  async function scenario(name, body) {
    await t.test(name, async () => {
      await reset();
      try { await body(); } finally {
        state.afterParentRead = null;
        state.onKey = null;
        state.onProvider = null;
      }
    });
  }
  const load = runtimeLoader(prisma, state);
  const itemRoute = load(itemRoutePath);
  const stepRoute = load(runRouteRoot + 'step/route.ts');
  const readRoutes = ['route.ts', 'responses/route.ts', 'report/route.ts', 'report/export/route.ts', 'progress/route.ts'];

  for (const routePath of readRoutes) {
    const route = load(runRouteRoot + routePath);
    for (const [label, child, actor] of [
      ['foreign owner child', fixture.b, userA],
      ['same owner, different project child', fixture.c, userA],
      ['foreign user of the requested parent', fixture.a, userB],
    ]) {
      await scenario(`GET ${routePath} denies ${label}`, async () => {
        state.userId = actor;
        const before = await snapshot();
        const response = await route.GET(request(), { params: { id: fixture.a.project, runId: child.run } });
        assert.equal(response.status, 404);
        const body = await response.text();
        for (const row of Object.values(fixture)) assert.ok(!body.includes(row.marker));
        assert.equal(await snapshot(), before);
        assert.equal(state.providerCalls.length, 0);
        assert.equal(state.keyCalls.length, 0);
      });
    }
    await scenario(`GET ${routePath} allows the actual owner and requested project`, async () => {
      const before = await snapshot();
      const response = await route.GET(request(), { params: { id: fixture.a.project, runId: fixture.a.run } });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(!body.includes(fixture.b.marker) && !body.includes(fixture.c.marker));
      if (routePath === 'route.ts') assert.equal(JSON.parse(body).id, fixture.a.run);
      else if (routePath === 'responses/route.ts') assert.deepEqual(JSON.parse(body).map(row => row.id), [fixture.a.response]);
      else if (routePath === 'progress/route.ts') assert.match(body, /"type":"complete"/);
      else assert.equal(JSON.parse(body).recommendation, fixture.a.marker + ' recommendation');
      assert.equal(await snapshot(), before);
      assert.equal(state.providerCalls.length, 0, 'Completed progress must not run the evaluator.');
    });
  }

  for (const method of ['PATCH', 'DELETE']) {
    for (const [label, child, actor] of [
      ['foreign owner child', fixture.b, userA],
      ['same owner, different project child', fixture.c, userA],
      ['foreign user of the requested parent', fixture.a, userB],
    ]) {
      await scenario(`${method} prompt item denies ${label}`, async () => {
        state.userId = actor;
        const before = await snapshot();
        const response = await itemRoute[method](request(method, method === 'PATCH' ? { prompt: 'Unauthorized change' } : undefined),
          { params: { id: fixture.a.project, itemId: child.item } });
        assert.equal(response.status, 404);
        assert.equal(await snapshot(), before);
        assert.equal(state.providerCalls.length, 0);
      });
    }
    await scenario(`${method} prompt item allows the actual owner and requested project`, async () => {
      const foreignBefore = await otherConnection.promptItem.findMany({ where: { id: { in: [fixture.b.item, fixture.c.item] } }, orderBy: { id: 'asc' } });
      const response = await itemRoute[method](request(method, method === 'PATCH' ? { prompt: 'Authorized synthetic update' } : undefined),
        { params: { id: fixture.a.project, itemId: fixture.a.item } });
      assert.equal(response.status, 200);
      const stored = await otherConnection.promptItem.findUnique({ where: { id: fixture.a.item } });
      if (method === 'PATCH') assert.equal(stored.prompt, 'Authorized synthetic update');
      else assert.equal(stored, null);
      assert.deepEqual(await otherConnection.promptItem.findMany({ where: { id: { in: [fixture.b.item, fixture.c.item] } }, orderBy: { id: 'asc' } }), foreignBefore);
    });
    await scenario(`${method} prompt item returns 404 if ownership changes after the parent read`, async () => {
      const before = await otherConnection.promptItem.findUnique({ where: { id: fixture.a.item } });
      state.afterParentRead = () => otherConnection.evalProject.update({ where: { id: fixture.a.project }, data: { userId: userB } });
      const response = await itemRoute[method](request(method, method === 'PATCH' ? { prompt: 'Stale authorization write' } : undefined),
        { params: { id: fixture.a.project, itemId: fixture.a.item } });
      assert.equal(state.parentHookCalls, 1, 'The ownership change must happen after a successful real parent query.');
      assert.equal(response.status, 404);
      assert.equal((await otherConnection.evalProject.findUnique({ where: { id: fixture.a.project } })).userId, userB);
      assert.deepEqual(await otherConnection.promptItem.findUnique({ where: { id: fixture.a.item } }), before);
    });
  }

  for (const step of ['execute', 'judge']) {
    const bodyFor = () => step === 'execute'
      ? { step, model: targetModel, promptItemIds: [fixture.a.item] }
      : { step, limit: 1 };
    for (const child of [fixture.b, fixture.c]) {
      await scenario(`${step} rejects a run outside the requested project before provider/key access`, async () => {
        const before = await snapshot();
        const response = await stepRoute.POST(request('POST', bodyFor()), { params: { id: fixture.a.project, runId: child.run } });
        assert.equal(response.status, 404);
        assert.equal(state.keyCalls.length, 0);
        assert.equal(state.providerCalls.length, 0);
        assert.equal(await snapshot(), before);
      });
    }
    await scenario(`${step} succeeds with actual scoped persistence for the current owner`, async () => {
      const response = await stepRoute.POST(request('POST', bodyFor()), { params: { id: fixture.a.project, runId: fixture.a.run } });
      assert.equal(response.status, 200);
      assert.equal(state.providerCalls.length, 1);
      if (step === 'execute') {
        const stored = await otherConnection.modelResponse.findMany({ where: { evalRunId: fixture.a.run, promptItemId: fixture.a.item } });
        assert.equal(stored.length, 1);
        assert.equal(stored[0].content, 'Synthetic permitted provider answer');
        assert.equal(stored[0].status, 'COMPLETED');
      } else {
        const stored = await otherConnection.judgeScore.findUnique({ where: { modelResponseId: fixture.a.response } });
        assert.ok(stored);
        assert.equal(stored.accuracy, 4);
      }
    });
    await scenario(`${step} returns 404 and saves no result after owner change while the provider is in flight`, async () => {
      const beforeResponses = await otherConnection.modelResponse.findMany({ where: { evalRunId: fixture.a.run }, orderBy: { id: 'asc' } });
      const beforeScores = await otherConnection.judgeScore.findMany({ where: { modelResponse: { evalRunId: fixture.a.run } }, orderBy: { id: 'asc' } });
      let changed = 0;
      state.onProvider = async () => {
        await otherConnection.evalProject.update({ where: { id: fixture.a.project }, data: { userId: userB } });
        changed++;
      };
      const response = await stepRoute.POST(request('POST', bodyFor()), { params: { id: fixture.a.project, runId: fixture.a.run } });
      assert.equal(state.providerCalls.length, 1);
      assert.equal(changed, 1);
      assert.equal(response.status, 404);
      assert.equal((await otherConnection.evalProject.findUnique({ where: { id: fixture.a.project } })).userId, userB);
      assert.deepEqual(await otherConnection.modelResponse.findMany({ where: { evalRunId: fixture.a.run }, orderBy: { id: 'asc' } }), beforeResponses);
      assert.deepEqual(await otherConnection.judgeScore.findMany({ where: { modelResponse: { evalRunId: fixture.a.run } }, orderBy: { id: 'asc' } }), beforeScores);
    });
  }

  await scenario('execute rechecks a prompt moved to another owned project during API-key lookup before dispatch', async () => {
    const before = await otherConnection.modelResponse.count({ where: { evalRunId: fixture.a.run } });
    let moved = 0;
    state.onKey = async () => {
      await otherConnection.promptItem.update({ where: { id: fixture.a.item }, data: { promptSetId: fixture.c.set } });
      moved++;
    };
    const response = await stepRoute.POST(request('POST', { step: 'execute', model: targetModel, promptItemIds: [fixture.a.item] }),
      { params: { id: fixture.a.project, runId: fixture.a.run } });
    assert.equal(state.keyCalls.length, 1);
    assert.equal(moved, 1);
    assert.equal((await otherConnection.promptItem.findUnique({ where: { id: fixture.a.item } })).promptSetId, fixture.c.set);
    assert.equal(response.status, 404);
    assert.equal(state.providerCalls.length, 0, 'No cached prompt may leave after it has moved out of scope.');
    assert.equal(await otherConnection.modelResponse.count({ where: { evalRunId: fixture.a.run } }), before);
  });

  for (const method of ['GET', 'PATCH', 'DELETE', 'POST']) {
    await scenario(`${method} rejects an absent session before a database query or provider request`, async () => {
      state.userId = null;
      const response = method === 'GET'
        ? await load(runRouteRoot + 'route.ts').GET(request(), { params: { id: fixture.a.project, runId: fixture.a.run } })
        : method === 'POST'
          ? await stepRoute.POST(request('POST', { step: 'judge' }), { params: { id: fixture.a.project, runId: fixture.a.run } })
          : await itemRoute[method](request(method, method === 'PATCH' ? { prompt: 'Unauthorized' } : undefined), { params: { id: fixture.a.project, itemId: fixture.a.item } });
      assert.equal(response.status, 401);
      assert.equal(state.queryCount, 0);
      assert.equal(state.keyCalls.length, 0);
      assert.equal(state.providerCalls.length, 0);
    });
  }
});
