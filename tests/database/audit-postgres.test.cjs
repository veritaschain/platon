'use strict';

// Real PostgreSQL 16 integration tests. The dedicated public schema must have
// already received `prisma migrate deploy`. Never run against application data.
// No environment/connection details, stored values, identifiers, or driver
// errors are printed, including assertion and cleanup failure paths.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { auditDatabase, SQL, TABLE_NAMES, BATCH_SIZE, MAX_ENCRYPTED_TEXT_BYTES } =
  require('../../scripts/audit-database.cjs');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function checkedTestDatabaseUrl(value) {
  requireCondition(typeof value === 'string' && value.length > 0,
    'PLATON_TEST_DATABASE_URL is required; application URLs are never used.');
  requireCondition(value === value.trim() && !/[\x00-\x20\x7f\\?#]/.test(value),
    'Test database URL must not contain whitespace, control characters, options, or fragments.');
  let parsed;
  let username;
  let password;
  try {
    parsed = new URL(value);
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new Error('Invalid test database URL.');
  }
  requireCondition(['postgres:', 'postgresql:'].includes(parsed.protocol), 'PostgreSQL URL required.');
  requireCondition(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    'Audit database tests require a loopback host.');
  requireCondition(parsed.pathname === '/platon_security_test',
    'Audit database tests require exactly the dedicated platon_security_test database.');
  requireCondition(parsed.search === '' && parsed.hash === '', 'Test URL options and fragments are forbidden.');
  requireCondition(/^[A-Za-z_][A-Za-z0-9_]*$/.test(username), 'An explicit test database user is required.');
  requireCondition(!/[\x00-\x1f\x7f]/.test(password), 'Invalid test database password encoding.');
  requireCondition(parsed.port === '' || (Number(parsed.port) >= 1 && Number(parsed.port) <= 65535),
    'Invalid test database port.');
  return parsed.href;
}

async function safeStep(label, action) {
  try { return await action(); }
  catch { throw new Error(label); }
}

function quoteGeneratedRole(role) {
  requireCondition(/^platon_audit_role_[a-f0-9]{24}$/.test(role), 'Invalid generated audit test role.');
  return '"' + role + '"';
}

function encryptFixture(key) {
  const plaintext = Buffer.from('synthetic-audit-fixture', 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  try {
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join(':');
  } finally {
    plaintext.fill(0);
    cipher.destroy();
  }
}

function seedRows(prefix) {
  const legacy = crypto.scryptSync('dev-key', 'salt', 32);
  const zero = Buffer.alloc(32);
  const random = crypto.randomBytes(32);
  try {
    const values = [
      ...Array.from({ length: 101 }, () => encryptFixture(legacy)),
      ...Array.from({ length: 2 }, () => encryptFixture(zero)),
      ...Array.from({ length: 3 }, () => encryptFixture(random)),
      'synthetic-malformed-envelope',
      'x'.repeat(MAX_ENCRYPTED_TEXT_BYTES + 1),
    ];
    return values.map((encryptedKey, index) => ({
      id: prefix + 'key_' + index,
      userId: prefix + 'user_' + index,
      provider: 'OPENAI', encryptedKey, keyHint: 'fixture',
      isActive: index % 2 === 0,
    }));
  } finally {
    legacy.fill(0);
    zero.fill(0);
    random.fill(0);
  }
}

// PostgreSQL hashes rows internally. Only counts and digests enter the test
// process; they are compared as booleans so assertion output cannot reveal them.
async function snapshotApplicationRows(db) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const snapshots = [];
    for (const table of TABLE_NAMES) {
      const rows = await tx.$queryRawUnsafe(`SELECT count(*)::text AS "count",
        pg_catalog.md5(COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.id)::text, '[]')) AS "digest"
        FROM public."${table}" t`);
      requireCondition(Array.isArray(rows) && rows.length === 1 && typeof rows[0].digest === 'string',
        'Could not snapshot application rows.');
      snapshots.push([table, rows[0].count, rows[0].digest]);
    }
    return JSON.stringify(snapshots);
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 15000 });
}

function transactionClient(db, { role, query } = {}) {
  return {
    $transaction(callback, options) {
      return db.$transaction(async tx => {
        if (role) await tx.$executeRawUnsafe('SET LOCAL ROLE ' + quoteGeneratedRole(role));
        return callback({
          $executeRawUnsafe: (...args) => tx.$executeRawUnsafe(...args),
          $queryRawUnsafe: (...args) => query ? query(tx, ...args) : tx.$queryRawUnsafe(...args),
        });
      }, options);
    },
  };
}

test('Audit PostgreSQL URL guard requires an explicit isolated connection', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    requireCondition(typeof checkedTestDatabaseUrl(`postgresql://postgres:synthetic@${host}:5432/platon_security_test`) === 'string',
      'A supported loopback URL was rejected.');
  }
  for (const value of [
    undefined, '', 'not-a-url',
    'https://localhost/platon_security_test',
    'postgresql://postgres:synthetic@remote.invalid/platon_security_test',
    'postgresql://postgres:synthetic@127.0.0.1/postgres',
    'postgresql://postgres:synthetic@127.0.0.1/platon_security_test_other',
    'postgresql://postgres:synthetic@127.0.0.1/platon_security_test/',
    'postgresql://postgres:synthetic@127.0.0.1/%70laton_security_test',
    'postgresql://postgres:synthetic@127.0.0.1/platon_security_test?schema=public',
    'postgresql://postgres:synthetic@127.0.0.1/platon_security_test?host=remote.invalid',
    'postgresql://postgres:synthetic@127.0.0.1/platon_security_test?',
    'postgresql://postgres:synthetic@127.0.0.1/platon_security_test#fragment',
    'postgresql://postgres:synthetic@127.0.0.1/platon_security_test#',
    'postgresql://postgres:synthetic@127.0.0.1:0/platon_security_test',
    'postgresql://127.0.0.1/platon_security_test',
    'postgresql://postgres:%00@127.0.0.1/platon_security_test',
    ' postgresql://postgres:synthetic@127.0.0.1/platon_security_test',
  ]) assert.throws(() => checkedTestDatabaseUrl(value));
});

test('PostgreSQL audit counts known public keys without changing existing rows', { timeout: 120000 }, async t => {
  const url = checkedTestDatabaseUrl(process.env.PLATON_TEST_DATABASE_URL);
  requireCondition(!['DEBUG', 'RUST_LOG', 'RUST_BACKTRACE'].some(name => process.env[name]?.trim()),
    'Disable client and engine debug logging for database audit tests.');
  requireCondition(require('@prisma/client/package.json').version === '5.22.0',
    'Audit integration tests require the lockfile Prisma 5.22 client.');
  const db = await safeStep('Could not initialize the isolated audit test client.', async () => {
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({ datasources: { db: { url } }, log: [], errorFormat: 'minimal' });
  });
  const token = crypto.randomBytes(12).toString('hex');
  const prefix = 'platon_audit_fixture_' + token + '_';
  const role = 'platon_audit_role_' + token;
  let roleCreated = false;
  let seedAttempted = false;
  let initialRows;
  let fixtureRows;
  let baseline;

  t.after(async () => {
    let failed = false;
    // Continue all cleanup steps even when an earlier one fails. Only this
    // run's generated role and dual-prefixed fixture rows may be removed.
    if (roleCreated) {
      for (const statement of [
        'REVOKE SELECT ON TABLE public."UserApiKey" FROM ' + quoteGeneratedRole(role),
        'REVOKE USAGE ON SCHEMA public FROM ' + quoteGeneratedRole(role),
        'DROP ROLE ' + quoteGeneratedRole(role),
      ]) {
        try { await db.$executeRawUnsafe(statement); }
        catch { failed = true; }
      }
    }
    if (seedAttempted) {
      try {
        await db.userApiKey.deleteMany({ where: {
          id: { startsWith: prefix }, userId: { startsWith: prefix },
        } });
        requireCondition(await db.userApiKey.count({ where: { id: { startsWith: prefix } } }) === 0,
          'Audit fixture rows remain after cleanup.');
        requireCondition(initialRows === await snapshotApplicationRows(db),
          'Pre-existing application rows changed during the audit tests.');
      } catch { failed = true; }
    }
    try { await db.$disconnect(); }
    catch { failed = true; }
    requireCondition(!failed, 'Isolated audit test cleanup or preservation verification failed.');
  });

  await safeStep('Isolated audit database preflight failed.', async () => {
    const preflight = await db.$queryRawUnsafe(`SELECT
      pg_catalog.current_database() = 'platon_security_test' AS "dedicatedDatabase",
      pg_catalog.current_setting('server_version_num')::integer BETWEEN 160000 AND 169999 AS "supportedVersion",
      r.rolsuper AS "setupSuperuser"
      FROM pg_catalog.pg_roles r WHERE r.rolname = CURRENT_USER`);
    requireCondition(preflight.length === 1 && preflight[0].dedicatedDatabase === true &&
      preflight[0].supportedVersion === true && preflight[0].setupSuperuser === true,
      'Use only the isolated PostgreSQL 16 test service setup role.');
    requireCondition(await db.userApiKey.count({ where: { OR: [
      { id: { startsWith: prefix } }, { userId: { startsWith: prefix } },
    ] } }) === 0, 'Generated fixture prefix already exists.');
  });

  // Parse and plan the exact exported query against PostgreSQL before any
  // fixture writes. A DB double cannot detect SQL grammar/catalog mistakes.
  // EXPLAIN without ANALYZE does not execute this metadata SELECT. Never print
  // its plan or the driver error; the fixed stage label identifies the failure.
  await safeStep('PostgreSQL could not plan the audit metadata SQL.', async () => {
    const plan = await db.$queryRawUnsafe('EXPLAIN (COSTS OFF) ' + SQL.metadata);
    requireCondition(Array.isArray(plan) && plan.length > 0, 'Metadata SQL did not produce a query plan.');
  });

  await safeStep('Initial aggregate audit failed after metadata SQL planning.', async () => {
    baseline = await auditDatabase(db, { readOnly: true });
  });
  await safeStep('The isolated public schema is missing required tables or row security.', async () => {
    requireCondition(baseline.tables.every(table => table.present && table.rowSecurityEnabled),
      'Apply the current migrations to the isolated public schema before this suite.');
  });
  await safeStep('Could not snapshot application rows before fixture creation.', async () => {
    initialRows = await snapshotApplicationRows(db);
  });
  await safeStep('Synthetic audit fixture insertion failed.', async () => {
    const rows = seedRows(prefix);
    seedAttempted = true;
    const inserted = await db.userApiKey.createMany({ data: rows });
    requireCondition(inserted.count === 108, 'Synthetic key fixtures were not inserted completely.');
    for (const row of rows) row.encryptedKey = null;
  });
  await safeStep('Could not snapshot application rows after fixture creation.', async () => {
    fixtureRows = await snapshotApplicationRows(db);
  });

  await t.test('real cursor aggregates legacy, zero, other, malformed and oversize fixtures', async () => {
    await safeStep('Real cursor aggregation or transaction-state verification failed.', async () => {
      let fetches = 0;
      let states = 0;
      const inspectedClient = transactionClient(db, { async query(tx, sql, ...params) {
        if (sql === SQL.fetch) {
          const state = await tx.$queryRawUnsafe(SQL.state);
          requireCondition(state.length === 1 && state[0].readOnly === true &&
            state[0].repeatableRead === true && state[0].rowSecurityErrorsOnFilter === true,
            'Audit transaction protections were not retained at cursor fetch.');
          states += 1;
        }
        const rows = await tx.$queryRawUnsafe(sql, ...params);
        if (sql === SQL.fetch) {
          fetches += 1;
          requireCondition(rows.length <= BATCH_SIZE, 'Audit cursor exceeded its fixed batch size.');
        }
        return rows;
      } });
      const report = await auditDatabase(inspectedClient, { readOnly: true });
      const deltas = { stored: 108, inspected: 108,
        decryptableWithLegacyFallback: 101, decryptableWithPublicZeroKey: 2,
        decryptableWithEitherKnownPublicKey: 103, notDecryptableWithKnownPublicKeys: 3,
        malformed: 1, oversized: 1 };
      for (const [name, delta] of Object.entries(deltas)) {
        requireCondition(report.keys[name] - baseline.keys[name] === delta,
          'A known-fixture aggregate count did not match.');
      }
      requireCondition(fetches >= 3 && states === fetches, 'Real cursor did not exercise multiple protected batches.');
      requireCondition(report.scanComplete && report.knownPublicKeyMatchesFound && !report.cryptographicCoverageComplete,
        'Audit completion flags did not reflect the synthetic fixtures.');
      requireCondition(fixtureRows === await snapshotApplicationRows(db), 'Audit changed application rows.');
    });
  });

  await t.test('the actual audit transaction rejects a write with PostgreSQL read-only SQLSTATE', async () => {
    await safeStep('PostgreSQL did not enforce the audit read-only transaction.', async () => {
      let attempted = false;
      let rejectedReadOnly = false;
      let failedClosed = false;
      const probe = transactionClient(db, { async query(tx, sql, ...params) {
        const rows = await tx.$queryRawUnsafe(sql, ...params);
        if (sql === SQL.state && !attempted) {
          attempted = true;
          try {
            await tx.$executeRawUnsafe('UPDATE public."UserApiKey" SET "keyHint" = $1 WHERE id = $2',
              'synthetic-write-probe', prefix + 'key_0');
          } catch (error) {
            rejectedReadOnly = error?.code === 'P2010' && error?.meta?.code === '25006';
            throw error;
          }
          // If the protection regresses, roll back the fixture-only probe anyway.
          throw new Error('Unexpected write acceptance inside the audit.');
        }
        return rows;
      } });
      try { await auditDatabase(probe, { readOnly: true }); }
      catch (error) { failedClosed = error?.code === 'AUDIT_DATABASE_FAILED'; }
      requireCondition(attempted && rejectedReadOnly && failedClosed,
        'The write was not rejected for read-only transaction enforcement.');
      requireCondition(fixtureRows === await snapshotApplicationRows(db), 'The write probe changed application rows.');
    });
  });

  await t.test('a real RLS-filtered role cannot receive a successful incomplete audit', async () => {
    await safeStep('PostgreSQL RLS incomplete-audit protection failed.', async () => {
      await db.$executeRawUnsafe('CREATE ROLE ' + quoteGeneratedRole(role) +
        ' NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION');
      roleCreated = true;
      await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO ' + quoteGeneratedRole(role));
      await db.$executeRawUnsafe('GRANT SELECT ON TABLE public."UserApiKey" TO ' + quoteGeneratedRole(role));

      const filteredCount = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE ' + quoteGeneratedRole(role));
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe('SET LOCAL row_security = on');
        const flags = await tx.$queryRawUnsafe(`SELECT r.rolsuper AS "superuser", r.rolbypassrls AS "bypass",
          r.oid = (SELECT c.relowner FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'UserApiKey') AS "tableOwner"
          FROM pg_catalog.pg_roles r WHERE r.rolname = CURRENT_USER`);
        requireCondition(flags.length === 1 && flags[0].superuser === false &&
          flags[0].bypass === false && flags[0].tableOwner === false,
          'Generated role must be subject to row security.');
        const rows = await tx.$queryRawUnsafe(SQL.count);
        return BigInt(rows[0].stored);
      });
      requireCondition(filteredCount < BigInt(baseline.keys.stored + 108),
        'The generated role did not exercise a policy-filtered view.');

      let rlsFailureAtCount = false;
      let failedClosed = false;
      const restrictedClient = transactionClient(db, { role, async query(tx, sql, ...params) {
        try { return await tx.$queryRawUnsafe(sql, ...params); }
        catch (error) {
          if (sql === SQL.count) rlsFailureAtCount = error?.code === 'P2010' && error?.meta?.code === '42501';
          throw error;
        }
      } });
      try { await auditDatabase(restrictedClient, { readOnly: true }); }
      catch (error) { failedClosed = error?.code === 'AUDIT_DATABASE_FAILED'; }
      requireCondition(rlsFailureAtCount && failedClosed,
        'A filtered role did not fail closed when row_security was set off.');
      requireCondition(fixtureRows === await snapshotApplicationRows(db), 'RLS audit changed application rows.');
    });
  });
});
