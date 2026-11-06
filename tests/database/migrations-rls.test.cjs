'use strict';

// Requires PostgreSQL 16, psql and the lockfile-installed Prisma CLI.
// PLATON_TEST_DATABASE_URL must name a disposable, loopback-only
// platon_security_test database (or a platon_security_test_* variant).
// No DATABASE_URL / DIRECT_URL fallback, db reset, public-schema changes or
// existing-role changes are permitted. Only this run's schemas/roles are removed.
// The setup connection is a test superuser; application checks SET ROLE to
// separate NOSUPERUSER / NOBYPASSRLS owner, anon and authenticated equivalents.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const migrationRoot = path.join(root, 'prisma/migrations');
const prismaCli = path.join(root, 'node_modules/prisma/build/index.js');
const addedMigration = '20261104120000_add_eval_platform_and_rls';
const previousMigrations = [
  '20260222150727_init',
  '20260223005343_init',
  '20260224145434_add_xai_provider',
  '20260225104008_enable_rls',
];
const currentTables = [
  'EvalProject', 'EvalReport', 'EvalRun', 'EventLog', 'JudgeScore',
  'ModelResponse', 'PromptItem', 'PromptSet', 'UsageLog', 'UserApiKey',
];
const oldTables = [
  'AssistantMessage', 'EventLog', 'Handoff', 'HandoffTemplate', 'IntegrateResult',
  'ModelRun', 'Room', 'UsageLog', 'UserApiKey', 'UserMessage',
];
const allTables = [...new Set([...currentTables, ...oldTables])].sort();

function checkedDatabaseUrl(value) {
  assert.ok(typeof value === 'string' && value.length > 0,
    'Set PLATON_TEST_DATABASE_URL explicitly; application database URLs are never used.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid test database URL.'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required.');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'Database tests only connect to loopback hosts.');
  assert.equal(url.search, '', 'Database URL options are forbidden; test schemas are generated internally.');
  assert.equal(url.hash, '', 'Database URL fragments are forbidden.');
  let database, username, password;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { throw new Error('Invalid test database URL encoding.'); }
  assert.match(database, /^platon_security_test(?:_[a-z0-9]+)*$/,
    'A dedicated platon_security_test database is required.');
  assert.match(username, /^[A-Za-z_][A-Za-z0-9_]*$/, 'An explicit test database user is required.');
  assert.doesNotMatch(password, /[\x00-\x1f\x7f]/, 'Invalid test database password characters.');
  return { url, database, username, password };
}

function ident(value) {
  assert.match(value, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
  return '"' + value + '"';
}

const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const sqlList = values => values.map(literal).join(', ');

function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // In particular, inherited PGHOSTADDR / PGSERVICE / PGOPTIONS must not
    // redirect libpq away from the guarded test connection.
    if (/^PG[A-Z_]+$/.test(key) || ['DATABASE_URL', 'DIRECT_URL', 'SHADOW_DATABASE_URL'].includes(key)) delete env[key];
  }
  return env;
}

function output(result, label) {
  if (result.error) throw new Error(label + ': ' + (result.error.code || result.error.message));
  const details = ((result.stdout || '') + (result.stderr || ''))
    .replace(/postgres(?:ql)?:\/\/[^\s]+/g, '<database URL redacted>');
  assert.equal(result.status, 0, label + ' failed:\n' + details);
  return (result.stdout || '').trim();
}

function runner(connection) {
  const env = {
    ...cleanEnvironment(),
    PGPASSWORD: connection.password,
    PGCONNECT_TIMEOUT: '5',
    PGSSLMODE: 'disable',
  };
  function raw(sql) {
    return spawnSync('psql', [
      '--no-psqlrc', '--no-password', '--quiet', '--tuples-only', '--no-align',
      '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=verbose', '--pset=pager=off',
      '--host', connection.url.hostname.replace(/^\[|\]$/g, ''),
      '--port', connection.url.port || '5432',
      '--username', connection.username, '--dbname', connection.database,
    ], { input: sql, encoding: 'utf8', env, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  }
  function inSchema(schema, sql, { role, rollback = false, allowFailure = false } = {}) {
    assert.match(schema, /^platon_test_[a-z]+_[a-f0-9]{16}$/);
    const result = raw(`BEGIN;
SET LOCAL search_path = ${ident(schema)};
SET LOCAL statement_timeout = '10s';
${role ? `SET LOCAL ROLE ${ident(role)};` : ''}
SET LOCAL row_security = on;
${sql}
${rollback ? 'ROLLBACK' : 'COMMIT'};`);
    return allowFailure ? result : output(result, 'SQL in ' + schema);
  }
  function cli(args, schema, cwd) {
    assert.match(schema, /^platon_test_[a-z]+_[a-f0-9]{16}$/);
    const url = new URL(connection.url.href);
    url.searchParams.set('schema', schema);
    return spawnSync(process.execPath, [prismaCli, ...args], {
      cwd, encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024,
      env: {
        ...cleanEnvironment(), DATABASE_URL: url.href, DIRECT_URL: url.href,
        CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
    });
  }
  return { raw, inSchema, cli };
}

function stageMigrationHistory(directory, names) {
  fs.mkdirSync(path.join(directory, 'migrations'), { recursive: true });
  fs.copyFileSync(path.join(root, 'prisma/schema.prisma'), path.join(directory, 'schema.prisma'));
  fs.copyFileSync(path.join(migrationRoot, 'migration_lock.toml'), path.join(directory, 'migrations/migration_lock.toml'));
  for (const name of names) {
    fs.mkdirSync(path.join(directory, 'migrations', name));
    fs.copyFileSync(path.join(migrationRoot, name, 'migration.sql'), path.join(directory, 'migrations', name, 'migration.sql'));
  }
}

function rowSnapshot(db, schema, tables) {
  const entries = tables.map(table => `${literal(table)},
    (SELECT COALESCE(jsonb_agg(${table === 'UsageLog' ? "to_jsonb(t) - 'modelResponseId'" : 'to_jsonb(t)'} ORDER BY t.id), '[]'::jsonb) FROM ${ident(table)} t)`);
  return JSON.parse(db.inSchema(schema, `SELECT jsonb_build_object(${entries.join(',')});`));
}

// Compare real database structures to an independently generated schema from
// the installed Prisma CLI. Ignore only the deliberately retained legacy usage
// column/FK; new-column nullability, defaults, indexes, enums and FKs must match.
function schemaCatalog(db, schema, enumNames) {
  return JSON.parse(db.inSchema(schema, `SELECT jsonb_build_object(
    'columns', (SELECT jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY c.relname, a.attname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = current_schema() AND c.relname IN (${sqlList(currentTables)})
        AND a.attnum > 0 AND NOT a.attisdropped
        AND NOT (c.relname = 'UsageLog' AND a.attname = 'modelRunId')),
    'indexes', (SELECT jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', ic.relname, 'unique', i.indisunique,
      'primary', i.indisprimary, 'valid', i.indisvalid, 'method', am.amname,
      'keys', (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid, k.position, false) ORDER BY k.position)
        FROM generate_series(1, i.indnatts) AS k(position)),
      'where', pg_get_expr(i.indpred, i.indrelid)) ORDER BY c.relname, ic.relname)
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam
      WHERE n.nspname = current_schema() AND c.relname IN (${sqlList(currentTables)})),
    'foreignKeys', (SELECT jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', k.conname, 'definition', pg_get_constraintdef(k.oid, false),
      'validated', k.convalidated) ORDER BY c.relname, k.conname)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname IN (${sqlList(currentTables)})
        AND k.contype = 'f' AND k.conname <> 'UsageLog_modelRunId_fkey'),
    'enums', (SELECT jsonb_object_agg(t.typname,
      (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid))
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = current_schema() AND t.typname IN (${sqlList(enumNames)}))
  );`));
}

const oldFixture = `
INSERT INTO "Room" (id, "userId", title, "updatedAt") VALUES ('legacy-room', 'legacy-user', 'Retained chat', CURRENT_TIMESTAMP);
INSERT INTO "UserMessage" (id, "roomId", content, "targetModels", "orderIndex") VALUES ('legacy-message', 'legacy-room', 'Retained prompt', ARRAY['fixture-model'], 0);
INSERT INTO "ModelRun" (id, "userMessageId", provider, model, status, "inputTokens", "outputTokens", "estimatedCostUsd", settings) VALUES ('legacy-run', 'legacy-message', 'OPENAI', 'fixture-model', 'COMPLETED', 7, 11, 0.0012, '{"retained":true}');
INSERT INTO "AssistantMessage" (id, "modelRunId", content) VALUES ('legacy-assistant', 'legacy-run', 'Retained response');
INSERT INTO "HandoffTemplate" (id, type, name, description, "promptTpl", "updatedAt") VALUES ('legacy-template', 'VERIFY', 'Retained template', 'Fixture', 'Verify fixture', CURRENT_TIMESTAMP);
INSERT INTO "Handoff" (id, "roomId", "sourceModelRunId", "templateId", "templateType", "composedPrompt") VALUES ('legacy-handoff', 'legacy-room', 'legacy-run', 'legacy-template', 'VERIFY', 'Retained handoff');
INSERT INTO "IntegrateResult" (id, "handoffId", "userMessageId", "step1Extractions", "step15TrustStructure", "step15Conflicts", "step2Prompt", "step2Output") VALUES ('legacy-integrate', 'legacy-handoff', 'legacy-message', '{}', '{}', '[]', 'Retained input', 'Retained output');
INSERT INTO "UserApiKey" (id, "userId", provider, "encryptedKey", "keyHint", "updatedAt") VALUES ('legacy-key', 'legacy-user', 'OPENAI', 'fixture-not-a-real-key', 'fixture', CURRENT_TIMESTAMP);
INSERT INTO "UsageLog" (id, "userId", "modelRunId", provider, model, "inputTokens", "outputTokens", "estimatedCostUsd") VALUES ('legacy-usage', 'legacy-user', 'legacy-run', 'OPENAI', 'fixture-model', 7, 11, 0.0012);
INSERT INTO "EventLog" (id, "userId", "sessionId", "eventType", payload) VALUES ('legacy-event', 'legacy-user', 'legacy-room', 'LEGACY_FIXTURE', '{"retained":true}');
`;

const currentFixture = `
INSERT INTO "EvalProject" (id, "userId", name, "updatedAt") VALUES ('fixture-project', 'fixture-user', 'Fixture project', CURRENT_TIMESTAMP);
INSERT INTO "PromptSet" (id, "projectId", source) VALUES ('fixture-set', 'fixture-project', 'IMPORTED');
INSERT INTO "PromptItem" (id, "promptSetId", category, prompt, "evaluationFocus", "orderIndex") VALUES ('fixture-prompt', 'fixture-set', 'GENERAL', 'Fixture prompt', 'Fixture focus', 0);
INSERT INTO "EvalRun" (id, "projectId", "promptSetId", "targetModels", "judgeModel") VALUES ('fixture-run', 'fixture-project', 'fixture-set', ARRAY['fixture-model'], 'fixture-judge'), ('spare-run', 'fixture-project', 'fixture-set', ARRAY['fixture-model'], 'fixture-judge');
INSERT INTO "ModelResponse" (id, "evalRunId", "promptItemId", provider, model, content) VALUES ('fixture-response', 'fixture-run', 'fixture-prompt', 'OPENAI', 'fixture-model', 'Fixture response'), ('spare-response', 'spare-run', 'fixture-prompt', 'OPENAI', 'fixture-model', 'Spare response');
INSERT INTO "JudgeScore" (id, "modelResponseId", "judgeModel", accuracy, relevance, conciseness, tone, "instructionFollowing", reasons) VALUES ('fixture-score', 'fixture-response', 'fixture-judge', 3, 3, 3, 3, 3, '{}');
INSERT INTO "EvalReport" (id, "evalRunId", rankings, "scoreMatrix", highlights, "costProjection", recommendation) VALUES ('fixture-report', 'fixture-run', '[]', '{}', '[]', '{}', 'Fixture recommendation');
INSERT INTO "UserApiKey" (id, "userId", provider, "encryptedKey", "keyHint", "updatedAt") VALUES ('fixture-key', 'fixture-user', 'OPENAI', 'fixture-not-a-real-key', 'fixture', CURRENT_TIMESTAMP);
INSERT INTO "UsageLog" (id, "userId", "modelResponseId", provider, model, "inputTokens", "outputTokens", "estimatedCostUsd") VALUES ('fixture-usage', 'fixture-user', 'fixture-response', 'OPENAI', 'fixture-model', 1, 2, 0.0001);
INSERT INTO "EventLog" (id, "userId", "sessionId", "eventType", payload) VALUES ('fixture-event', 'fixture-user', 'fixture-run', 'FIXTURE', '{}');
`;

// Every candidate is valid and has no dependent rows. Spare run/response rows
// keep one-to-one constraints valid, so an INSERT failure cannot be mistaken
// for RLS when it is actually a uniqueness or foreign-key error.
const operations = {
  EvalProject: { id: 'fixture-project', fields: '"userId", name, "updatedAt"', values: "'new-user', 'New project', CURRENT_TIMESTAMP", update: "name = 'Updated project'" },
  EvalReport: { id: 'fixture-report', fields: '"evalRunId", rankings, "scoreMatrix", highlights, "costProjection", recommendation', values: "'spare-run', '[]', '{}', '[]', '{}', 'New report'", update: "recommendation = 'Updated report'" },
  EvalRun: { id: 'fixture-run', fields: '"projectId", "promptSetId", "targetModels", "judgeModel"', values: "'fixture-project', 'fixture-set', ARRAY['fixture-model'], 'new-judge'", update: '"judgeModel" = \'updated-judge\'' },
  EventLog: { id: 'fixture-event', fields: '"userId", "sessionId", "eventType", payload', values: "'new-user', 'new-session', 'NEW_FIXTURE', '{}'", update: '"eventType" = \'UPDATED_FIXTURE\'' },
  JudgeScore: { id: 'fixture-score', fields: '"modelResponseId", "judgeModel", accuracy, relevance, conciseness, tone, "instructionFollowing", reasons', values: "'spare-response', 'new-judge', 3, 3, 3, 3, 3, '{}'", update: '"judgeModel" = \'updated-judge\'' },
  ModelResponse: { id: 'fixture-response', fields: '"evalRunId", "promptItemId", provider, model, content', values: "'fixture-run', 'fixture-prompt', 'XAI', 'fixture-model', 'New response'", update: "content = 'Updated response'" },
  PromptItem: { id: 'fixture-prompt', fields: '"promptSetId", category, prompt, "evaluationFocus", "orderIndex"', values: "'fixture-set', 'ACCURACY', 'New prompt', 'New focus', 1", update: "prompt = 'Updated prompt'" },
  PromptSet: { id: 'fixture-set', fields: '"projectId", source', values: "'fixture-project', 'GENERATED'", update: '"generationConfig" = \'{"updated":true}\'' },
  UsageLog: { id: 'fixture-usage', fields: '"userId", "modelResponseId", provider, model, "inputTokens", "outputTokens", "estimatedCostUsd"', values: "'new-user', 'fixture-response', 'XAI', 'fixture-model', 1, 2, 0.0001", update: "model = 'updated-model'" },
  UserApiKey: { id: 'fixture-key', fields: '"userId", provider, "encryptedKey", "keyHint", "updatedAt"', values: "'new-user', 'XAI', 'fixture-not-a-real-key', 'fixture', CURRENT_TIMESTAMP", update: '"keyHint" = \'updated-hint\'' },
};

test('database URL guard rejects external, application and option-overridden connections', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    assert.equal(checkedDatabaseUrl(`postgresql://postgres:fixture@${host}:5432/platon_security_test`).database, 'platon_security_test');
  }
  for (const value of [
    undefined, '', 'not-a-url', 'https://localhost/platon_security_test',
    'postgresql://postgres:fixture@db.example/platon_security_test',
    'postgresql://postgres:fixture@127.0.0.1/production',
    'postgresql://postgres:fixture@127.0.0.1/postgres',
    'postgresql://postgres:fixture@127.0.0.1/platon_security_test?host=db.example',
    'postgresql://postgres:fixture@127.0.0.1/platon_security_test?schema=public',
    'postgresql://postgres:fixture@127.0.0.1/platon_security_test#anything',
    'postgresql:///platon_security_test',
  ]) assert.throws(() => checkedDatabaseUrl(value));
});

test('PostgreSQL migrations preserve legacy data and enforce server-only RLS', { timeout: 240000 }, async t => {
  const connection = checkedDatabaseUrl(process.env.PLATON_TEST_DATABASE_URL);
  const db = runner(connection);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(require(path.join(root, 'node_modules/prisma/package.json')).version, lock.packages['node_modules/prisma'].version);
  const schemaSource = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  assert.deepEqual([...schemaSource.matchAll(/^model\s+(\w+)\s*\{/gm)].map(match => match[1]).sort(), currentTables);
  assert.deepEqual(Object.keys(operations).sort(), currentTables);
  const enumNames = [...schemaSource.matchAll(/^enum\s+(\w+)\s*\{/gm)].map(match => match[1]);
  const names = fs.readdirSync(migrationRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(names, [...previousMigrations, addedMigration]);

  const server = JSON.parse(output(db.raw(`SELECT json_build_object(
    'database', current_database(), 'version', current_setting('server_version_num')::integer,
    'superuser', rolsuper) FROM pg_roles WHERE rolname = current_user;`), 'Database preflight'));
  assert.equal(server.database, connection.database);
  assert.ok(server.version >= 160000 && server.version < 170000, 'This suite requires PostgreSQL 16.');
  assert.equal(server.superuser, true, 'Use the disposable service database setup superuser, never production credentials.');

  const token = randomBytes(8).toString('hex');
  const schemas = Object.fromEntries(['fresh', 'upgrade', 'reference', 'drift'].map(kind => [kind, `platon_test_${kind}_${token}`]));
  const roles = Object.fromEntries(['owner', 'anon', 'authenticated'].map(kind => [kind, `platon_test_${kind}_${token}`]));
  const createdSchemas = [];
  const createdRoles = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'platon-migration-test-'));
  t.after(() => {
    const failures = [];
    for (const schema of createdSchemas.reverse()) {
      try {
        assert.ok(Object.values(schemas).includes(schema));
        output(db.raw(`DROP SCHEMA ${ident(schema)} CASCADE;`), 'Remove this test schema');
      } catch (error) { failures.push(error); }
    }
    for (const role of createdRoles.reverse()) {
      try {
        assert.ok(Object.values(roles).includes(role));
        output(db.raw(`DROP ROLE ${ident(role)};`), 'Remove this test role');
      } catch (error) { failures.push(error); }
    }
    fs.rmSync(temp, { recursive: true, force: true });
    if (failures.length) throw new AggregateError(failures, 'Test resource cleanup failed.');
  });
  for (const schema of Object.values(schemas)) {
    output(db.raw(`CREATE SCHEMA ${ident(schema)};`), 'Create isolated schema');
    createdSchemas.push(schema);
  }
  const complete = path.join(temp, 'complete');
  const previous = path.join(temp, 'previous');
  stageMigrationHistory(complete, names);
  stageMigrationHistory(previous, previousMigrations);
  const deploy = (schema, directory) => db.cli(['migrate', 'deploy', '--schema', path.join(directory, 'schema.prisma')], schema, directory);

  // Apply actual, unmodified committed migration files through Prisma, not a
  // SQL regex/mock or db push. Both starting states use isolated empty schemas.
  output(deploy(schemas.fresh, complete), 'Fresh migrate deploy');
  output(deploy(schemas.upgrade, previous), 'Legacy migrate deploy');
  db.inSchema(schemas.upgrade, oldFixture);
  const oldRows = rowSnapshot(db, schemas.upgrade, oldTables);
  for (const rows of Object.values(oldRows)) assert.equal(rows.length, 1);
  output(deploy(schemas.upgrade, complete), 'Upgrade migrate deploy');

  await t.test('all old chat records and usage links survive the additive upgrade', () => {
    assert.deepEqual(rowSnapshot(db, schemas.upgrade, oldTables), oldRows);
    const usage = JSON.parse(db.inSchema(schemas.upgrade, `SELECT json_build_object(
      'oldRun', "modelRunId", 'newResponse', "modelResponseId") FROM "UsageLog" WHERE id = 'legacy-usage';`));
    assert.deepEqual(usage, { oldRun: 'legacy-run', newResponse: null });
  });

  const generated = output(db.cli(['migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(complete, 'schema.prisma'), '--script'], schemas.reference, complete), 'Generate reference from current Prisma schema');
  db.inSchema(schemas.reference, generated);
  const expectedCatalog = schemaCatalog(db, schemas.reference, enumNames);
  for (const schema of [schemas.fresh, schemas.upgrade]) {
    await t.test(`${schema === schemas.fresh ? 'fresh' : 'upgraded'} database matches current models while retaining legacy tables`, () => {
      const present = JSON.parse(db.inSchema(schema, `SELECT jsonb_agg(c.relname ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname <> '_prisma_migrations';`));
      assert.deepEqual(present, allTables);
      assert.deepEqual(schemaCatalog(db, schema, enumNames), expectedCatalog);
      const history = JSON.parse(db.inSchema(schema, `SELECT jsonb_agg(jsonb_build_object(
        'name', migration_name, 'checksum', checksum, 'finished', finished_at IS NOT NULL,
        'notRolledBack', rolled_back_at IS NULL, 'steps', applied_steps_count) ORDER BY migration_name) FROM "_prisma_migrations";`));
      assert.deepEqual(history, names.map(name => ({
        name, checksum: createHash('sha256').update(fs.readFileSync(path.join(migrationRoot, name, 'migration.sql'))).digest('hex'),
        finished: true, notRolledBack: true, steps: 1,
      })));
      const before = rowSnapshot(db, schema, ['_prisma_migrations', ...allTables]);
      output(deploy(schema, complete), 'Repeat migrate deploy');
      assert.deepEqual(rowSnapshot(db, schema, ['_prisma_migrations', ...allTables]), before);
    });
    await t.test(`${schema === schemas.fresh ? 'fresh' : 'upgraded'} application tables have default-deny RLS`, () => {
      const state = JSON.parse(db.inSchema(schema, `SELECT jsonb_agg(jsonb_build_object(
        'table', c.relname, 'enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity,
        'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)) ORDER BY c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relname IN (${sqlList(allTables)});`));
      assert.deepEqual(state, allTables.map(table => ({ table, enabled: true, forced: false, policies: 0 })));
    });
  }

  await t.test('pre-existing conflicting objects fail rather than being hidden or partially applied', () => {
    output(deploy(schemas.drift, previous), 'Legacy drift-fixture deploy');
    db.inSchema(schemas.drift, oldFixture + `CREATE TABLE "EvalProject" (id TEXT PRIMARY KEY, marker TEXT NOT NULL);
      INSERT INTO "EvalProject" VALUES ('existing', 'must-survive');`);
    const before = rowSnapshot(db, schemas.drift, [...oldTables, 'EvalProject']);
    const beforeCatalog = schemaCatalog(db, schemas.drift, enumNames);
    const beforeHistory = rowSnapshot(db, schemas.drift, ['_prisma_migrations'])._prisma_migrations;
    function assertApplicationStatePreserved() {
      assert.deepEqual(rowSnapshot(db, schemas.drift, [...oldTables, 'EvalProject']), before);
      assert.deepEqual(schemaCatalog(db, schemas.drift, enumNames), beforeCatalog);
      assert.equal(db.inSchema(schemas.drift, `SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema() AND t.typname IN (${sqlList(enumNames.filter(name => name !== 'Provider'))});`), '0');
      assert.equal(db.inSchema(schemas.drift, `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'UsageLog' AND column_name = 'modelRunId';`), 'NO');
    }

    // Observe PostgreSQL's original error directly. Prisma 5.22 can mask it
    // with 25P02 when it tries to record a failure inside the aborted explicit
    // transaction. Use the unchanged tracked SQL, with its own BEGIN/COMMIT;
    // psql's ON_ERROR_STOP closes the connection and rolls back on the error.
    const migrationSql = fs.readFileSync(path.join(migrationRoot, addedMigration, 'migration.sql'), 'utf8');
    const direct = db.raw(`SET search_path = ${ident(schemas.drift)};
SET statement_timeout = '10s';
${migrationSql}`);
    assert.equal(direct.error, undefined);
    assert.notEqual(direct.status, 0);
    assert.match(direct.stderr, /\b42P07\b/);
    assert.match(direct.stderr, /relation "EvalProject" already exists/);
    assertApplicationStatePreserved();
    assert.deepEqual(rowSnapshot(db, schemas.drift, ['_prisma_migrations'])._prisma_migrations, beforeHistory);

    // Independently require migrate deploy to fail on the same conflicting
    // state, preserving application data/DDL and all prior applied history.
    // A failed migration-history entry is allowed; successful adoption is not.
    const result = deploy(schemas.drift, complete);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.ok(((result.stdout || '') + (result.stderr || '')).includes(addedMigration));
    assertApplicationStatePreserved();
    const afterHistory = rowSnapshot(db, schemas.drift, ['_prisma_migrations'])._prisma_migrations;
    assert.deepEqual(afterHistory.filter(row => row.migration_name !== addedMigration), beforeHistory);
    assert.ok(afterHistory.filter(row => row.migration_name === addedMigration).every(row => row.finished_at === null));
  });

  db.inSchema(schemas.fresh, currentFixture);
  db.inSchema(schemas.upgrade, currentFixture);
  await t.test('new usage can omit a legacy run while both usage foreign keys remain enforced', () => {
    const row = JSON.parse(db.inSchema(schemas.upgrade, `SELECT json_build_object(
      'oldRun', "modelRunId", 'newResponse', "modelResponseId") FROM "UsageLog" WHERE id = 'fixture-usage';`));
    assert.deepEqual(row, { oldRun: null, newResponse: 'fixture-response' });
    for (const [column, constraint] of [['modelRunId', 'UsageLog_modelRunId_fkey'], ['modelResponseId', 'UsageLog_modelResponseId_fkey']]) {
      const result = db.inSchema(schemas.upgrade, `INSERT INTO "UsageLog" (id, "userId", ${ident(column)}, provider, model, "inputTokens", "outputTokens", "estimatedCostUsd")
        VALUES ('invalid-usage', 'fixture-user', 'missing-parent', 'OPENAI', 'fixture-model', 1, 2, 0.0001);`, { rollback: true, allowFailure: true });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /23503/);
      assert.ok(result.stderr.includes(constraint));
    }
    db.inSchema(schemas.upgrade, `INSERT INTO "UsageLog" (id, "userId", "modelResponseId", provider, model, "inputTokens", "outputTokens", "estimatedCostUsd")
      VALUES ('retained-new-usage', 'fixture-user', 'spare-response', 'OPENAI', 'fixture-model', 1, 2, 0.0001);
      DELETE FROM "ModelResponse" WHERE id = 'spare-response';`);
    assert.equal(db.inSchema(schemas.upgrade, `SELECT count(*) FROM "UsageLog" WHERE id = 'retained-new-usage' AND "modelResponseId" IS NULL;`), '1');
    assert.equal(db.inSchema(schemas.upgrade, `SELECT count(*) FROM "UsageLog" WHERE id = 'legacy-usage' AND "modelRunId" = 'legacy-run';`), '1');
  });

  for (const role of Object.values(roles)) {
    output(db.raw(`CREATE ROLE ${ident(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`), 'Create unprivileged test role');
    createdRoles.push(role);
  }
  output(db.raw(`GRANT USAGE ON SCHEMA ${ident(schemas.fresh)} TO ${Object.values(roles).map(ident).join(', ')};
    ${allTables.map(table => `ALTER TABLE ${ident(schemas.fresh)}.${ident(table)} OWNER TO ${ident(roles.owner)};`).join('\n')}
    GRANT SELECT, INSERT, UPDATE, DELETE ON ${currentTables.map(table => `${ident(schemas.fresh)}.${ident(table)}`).join(', ')}
      TO ${ident(roles.anon)}, ${ident(roles.authenticated)};`), 'Configure server-owner and direct-client test roles');

  for (const [kind, role] of Object.entries(roles)) {
    await t.test(`${kind} role has the expected ownership and RLS boundary`, () => {
      const state = JSON.parse(db.inSchema(schemas.fresh, `SELECT jsonb_build_object(
        'role', current_user, 'superuser', r.rolsuper, 'bypass', r.rolbypassrls,
        'ownerMember', pg_has_role(current_user, ${literal(roles.owner)}, 'MEMBER'),
        'allRlsActive', (SELECT bool_and(row_security_active(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema() AND c.relname IN (${sqlList(currentTables)})),
        'tableGrants', (SELECT bool_and(has_table_privilege(current_user, c.oid, 'SELECT') AND has_table_privilege(current_user, c.oid, 'INSERT')
          AND has_table_privilege(current_user, c.oid, 'UPDATE') AND has_table_privilege(current_user, c.oid, 'DELETE'))
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname IN (${sqlList(currentTables)})))
        FROM pg_roles r WHERE r.rolname = current_user;`, { role, rollback: true }));
      assert.deepEqual(state, { role, superuser: false, bypass: false, ownerMember: kind === 'owner', allRlsActive: kind !== 'owner', tableGrants: true });
    });
  }

  const beforeDirectAccess = rowSnapshot(db, schemas.fresh, currentTables);
  for (const table of currentTables) {
    const op = operations[table];
    const candidate = 'candidate-' + table;
    const insert = `INSERT INTO ${ident(table)} (id, ${op.fields}) VALUES (${literal(candidate)}, ${op.values})`;
    await t.test(`server owner can SELECT/INSERT/UPDATE/DELETE ${table}`, () => {
      const counts = db.inSchema(schemas.fresh, `
        SELECT count(*) FROM ${ident(table)} WHERE id = ${literal(op.id)};
        WITH changed AS (${insert} RETURNING id) SELECT count(*) FROM changed;
        WITH changed AS (UPDATE ${ident(table)} SET ${op.update} WHERE id = ${literal(candidate)} RETURNING id) SELECT count(*) FROM changed;
        WITH changed AS (DELETE FROM ${ident(table)} WHERE id = ${literal(candidate)} RETURNING id) SELECT count(*) FROM changed;`,
      { role: roles.owner, rollback: true }).split('\n');
      assert.deepEqual(counts, ['1', '1', '1', '1']);
    });
    for (const kind of ['anon', 'authenticated']) {
      await t.test(`${kind} cannot SELECT/INSERT/UPDATE/DELETE ${table} despite table grants`, () => {
        const counts = db.inSchema(schemas.fresh, `
          SELECT count(*) FROM ${ident(table)};
          WITH changed AS (UPDATE ${ident(table)} SET ${op.update} WHERE id = ${literal(op.id)} RETURNING id) SELECT count(*) FROM changed;
          WITH changed AS (DELETE FROM ${ident(table)} WHERE id = ${literal(op.id)} RETURNING id) SELECT count(*) FROM changed;`,
        { role: roles[kind], rollback: true }).split('\n');
        assert.deepEqual(counts, ['0', '0', '0']);
        const denied = db.inSchema(schemas.fresh, insert + ';', { role: roles[kind], rollback: true, allowFailure: true });
        assert.equal(denied.error, undefined);
        assert.notEqual(denied.status, 0);
        assert.match(denied.stderr, /42501/);
        assert.match(denied.stderr, /new row violates row-level security policy/);
      });
    }
  }
  assert.deepEqual(rowSnapshot(db, schemas.fresh, currentTables), beforeDirectAccess);
});
