// Exercise the actual request handlers with Next 15's promised request APIs.
// All sessions, cookies and database records are synthetic; no network is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOT = process.env.PLATON_TEST_SOURCE_ROOT
  ? path.resolve(process.env.PLATON_TEST_SOURCE_ROOT) : path.resolve(__dirname, '../..');

function load(file, mocks) {
  const filename = path.resolve(ROOT, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert.ok(Object.hasOwn(mocks, name), 'Unexpected fixture import: ' + name);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}

const nextServer = { NextResponse: { json: (value, options) => Response.json(value, options) } };
const asyncClient = user => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
});

test('server auth waits for cookies and preserves the cookie read/write bridge', async () => {
  let resolveCookies;
  const promisedCookies = new Promise(resolve => { resolveCookies = resolve; });
  const writes = [];
  const cookieStore = { getAll: () => [{ name: 'fixture-session', value: 'synthetic' }],
    set: (...args) => writes.push(args) };
  let options;
  let creations = 0;
  const client = { auth: {} };
  const { createClient } = load('src/lib/supabase/server.ts', {
    'next/headers': { cookies: () => promisedCookies },
    '@supabase/ssr': { createServerClient: (_url, _key, config) => {
      creations++; options = config; return client;
    } },
  });
  const pending = createClient();
  assert.equal(creations, 0, 'The promised cookie store must resolve before client creation');
  resolveCookies(cookieStore);
  assert.equal(await pending, client);
  assert.deepEqual(options.cookies.getAll(), cookieStore.getAll());
  options.cookies.setAll([{ name: 'fixture-session', value: 'renewed', options: { httpOnly: true } }]);
  assert.deepEqual(writes, [['fixture-session', 'renewed', { httpOnly: true }]]);
});

for (const user of [{ id: 'owner-a' }, null]) {
  test('auth helper awaits the server client for ' + (user ? 'a signed-in user' : 'an anonymous user'), async () => {
    const { getAuthenticatedUser } = load('src/lib/auth.ts', {
      'next/server': nextServer,
      '@/lib/supabase/server': asyncClient(user),
    });
    assert.deepEqual(await getAuthenticatedUser(), {
      user, error: user ? null : 'Unauthorized',
    });
  });
}

test('project GET resolves promised params before querying the authenticated project', async () => {
  const reads = [];
  const { GET } = load('src/app/api/projects/[id]/route.ts', {
    'next/server': nextServer,
    '@/lib/supabase/server': asyncClient({ id: 'owner-a' }),
    '@/lib/db/client': { prisma: { evalProject: { findFirst: async query => {
      reads.push(query.where);
      return query.where.id === 'project-a' && query.where.userId === 'owner-a'
        ? { id: 'project-a' } : null;
    } } } },
  });
  let resolveParams;
  const pending = GET(new Request('https://synthetic.test/'), {
    params: new Promise(resolve => { resolveParams = resolve; }),
  });
  assert.equal(reads.length, 0);
  resolveParams({ id: 'project-a' });
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'project-a' });
  assert.deepEqual(reads, [{ id: 'project-a', userId: 'owner-a' }]);
});

for (const itemId of ['item-a', 'item-b']) {
  test('promised params retain the PATCH tenant boundary for ' + itemId, async () => {
    const items = [
      { id: 'item-a', projectId: 'project-a', userId: 'owner-a', prompt: 'original-a' },
      { id: 'item-b', projectId: 'project-b', userId: 'owner-b', prompt: 'original-b' },
    ];
    const { PATCH } = load('src/app/api/projects/[id]/prompt-set/items/[itemId]/route.ts', {
      'next/server': nextServer,
      '@/lib/supabase/server': asyncClient({ id: 'owner-a' }),
      '@/lib/db/client': { prisma: {
        evalProject: { findFirst: async ({ where }) =>
          where.id === 'project-a' && where.userId === 'owner-a' ? { id: 'project-a' } : null },
        promptItem: { update: async ({ where, data }) => {
          const item = items.find(row => row.id === where.id && row.projectId === where.promptSet?.projectId
            && row.userId === where.promptSet?.project?.userId);
          if (!item) throw Object.assign(new Error('Synthetic missing record'), { code: 'P2025' });
          Object.assign(item, data); return item;
        } },
      } },
    });
    const response = await PATCH(new Request('https://synthetic.test/', {
      method: 'PATCH', body: JSON.stringify({ prompt: 'changed' }),
    }), { params: Promise.resolve({ id: 'project-a', itemId }) });
    assert.equal(response.status, itemId === 'item-a' ? 200 : 404);
    assert.equal(items[0].prompt, itemId === 'item-a' ? 'changed' : 'original-a');
    assert.equal(items[1].prompt, 'original-b');
  });
}
