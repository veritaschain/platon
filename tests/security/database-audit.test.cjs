'use strict';

// Synthetic cryptographic fixtures and an instrumented DB double only.
// This file never connects to PostgreSQL or any external service. The real-PG
// integration suite can import auditDatabase and use its own isolated database.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  auditDatabase, runCli, classifyEncryptedKey, authenticatesWithKey,
  SQL, TABLE_NAMES, BATCH_SIZE, MAX_ENCRYPTED_TEXT_BYTES,
} = require('../../scripts/audit-database.cjs');

const SYNTHETIC_URL = 'postgresql://audit:synthetic-password@audit.invalid/synthetic_audit';
const SYNTHETIC_PLAINTEXT = 'synthetic-api-key-do-not-log';
const TEST_KEYS = {
  legacyFallback: crypto.scryptSync('dev-key', 'salt', 32),
  publicZeroKey: Buffer.alloc(32),
};
const OTHER_KEY = Buffer.alloc(32, 0x7a);

function encryptSynthetic(key, value = SYNTHETIC_PLAINTEXT) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join(':');
}

function metadata() {
  return TABLE_NAMES.map(name => ({ name, present: true, rowSecurityEnabled: true,
    rowSecurityForced: false, selectGranted: true, policyCount: '0', selectPolicyCount: '0' }));
}

function dbDouble(values = [], options = {}) {
  const calls = [];
  const fetchedRows = [];
  let position = 0;
  let fetches = 0;
  let states = 0;
  let disconnected = false;
  const state = { readOnly: true, repeatableRead: true, rowSecurityErrorsOnFilter: true };
  const client = {
    async $transaction(callback, transactionOptions) {
      calls.push({ method: 'transaction', options: transactionOptions });
      const tx = {
        async $executeRawUnsafe(sql, ...params) {
          calls.push({ method: 'execute', sql });
          assert.equal(params.length, 0);
          assert.ok([SQL.readOnly, SQL.rowSecurity, SQL.statementTimeout, SQL.lockTimeout,
            SQL.declare, SQL.close].includes(sql), 'DB double rejects any unexpected statement');
          if (options.failOn === sql) throw new Error(options.failureMessage || 'synthetic DB failure');
          return 0;
        },
        async $queryRawUnsafe(sql, ...params) {
          calls.push({ method: 'query', sql });
          assert.equal(params.length, 0);
          if (options.failOn === sql) throw new Error(options.failureMessage || 'synthetic DB failure');
          if (sql === SQL.state) {
            states += 1;
            return [{ ...state, ...options.state,
              ...(states > 1 ? options.finalState : {}) }];
          }
          if (sql === SQL.metadata) return options.metadata || metadata();
          if (sql === SQL.count) return [{ stored: options.stored === undefined ? String(values.length) : options.stored }];
          if (sql === SQL.fetch) {
            fetches += 1;
            if (options.failFetch === fetches) throw new Error(options.failureMessage || 'synthetic cursor failure');
            const size = options.fetchSize || BATCH_SIZE;
            const batch = values.slice(position, position + size).map(value => {
              const oversized = typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_ENCRYPTED_TEXT_BYTES;
              return { encryptedKey: oversized ? null : value, oversized };
            });
            position += batch.length;
            fetchedRows.push(...batch);
            return batch;
          }
          throw new Error('DB double rejects unknown query');
        },
      };
      return callback(tx);
    },
    async $disconnect() {
      disconnected = true;
      if (options.disconnectFailure) throw new Error(options.failureMessage || 'synthetic disconnect failure');
    },
  };
  return { client, calls, fetchedRows, get disconnected() { return disconnected; } };
}

function capture() {
  const output = { stdout: '', stderr: '' };
  return { output,
    stdout: { write(text) { output.stdout += text; } },
    stderr: { write(text) { output.stderr += text; } },
  };
}

async function runDouble(fixture, extra = {}) {
  const streams = capture();
  let factoryCalls = 0;
  const code = await runCli({ argv: ['--read-only'],
    env: { PLATON_AUDIT_DATABASE_URL: SYNTHETIC_URL },
    createClient(url) {
      factoryCalls += 1;
      assert.equal(url, SYNTHETIC_URL);
      return fixture.client;
    },
    stdout: streams.stdout, stderr: streams.stderr, ...extra });
  return { code, ...streams.output, factoryCalls };
}

test('real AES-GCM fixtures distinguish each public key, a different key, and a tampered tag', () => {
  assert.deepEqual(classifyEncryptedKey(encryptSynthetic(TEST_KEYS.legacyFallback), TEST_KEYS),
    { legacyFallback: true, publicZeroKey: false });
  assert.deepEqual(classifyEncryptedKey(encryptSynthetic(TEST_KEYS.publicZeroKey), TEST_KEYS),
    { legacyFallback: false, publicZeroKey: true });
  assert.deepEqual(classifyEncryptedKey(encryptSynthetic(OTHER_KEY), TEST_KEYS),
    { legacyFallback: false, publicZeroKey: false });
  const parts = encryptSynthetic(TEST_KEYS.legacyFallback).split(':');
  parts[1] = (parseInt(parts[1].slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') + parts[1].slice(2);
  assert.deepEqual(classifyEncryptedKey(parts.join(':'), TEST_KEYS),
    { legacyFallback: false, publicZeroKey: false });
});

test('empty authenticated plaintext retains the historical wire format', () => {
  assert.deepEqual(classifyEncryptedKey(encryptSynthetic(TEST_KEYS.legacyFallback, ''), TEST_KEYS),
    { legacyFallback: true, publicZeroKey: false });
});

test('malformed or oversized values are classified without attempting a public-key match', () => {
  for (const value of [null, undefined, [], 0, '', 'a:b:c', 'ab'.repeat(12) + ':' + 'cd'.repeat(16) + ':0g',
    'ab'.repeat(12) + ':' + 'cd'.repeat(16) + ':f', encryptSynthetic(OTHER_KEY) + ':extra']) {
    assert.deepEqual(classifyEncryptedKey(value, TEST_KEYS), { malformed: true });
  }
  assert.deepEqual(classifyEncryptedKey('x'.repeat(MAX_ENCRYPTED_TEXT_BYTES + 1), TEST_KEYS), { oversized: true });
});

for (const authenticated of [true, false]) {
  test('plaintext buffers are zeroed after ' + (authenticated ? 'authentication success' : 'authentication failure'), () => {
    const plaintext = Buffer.from(SYNTHETIC_PLAINTEXT);
    const tail = Buffer.from('synthetic-tail');
    let destroyed = false;
    const fake = { setAuthTag() {}, update() { return plaintext; },
      final() { if (!authenticated) throw Error(SYNTHETIC_PLAINTEXT); return tail; },
      destroy() { destroyed = true; } };
    assert.equal(authenticatesWithKey({ iv: Buffer.alloc(12), tag: Buffer.alloc(16), data: Buffer.alloc(0) },
      TEST_KEYS.publicZeroKey, () => fake), authenticated);
    assert.ok(plaintext.every(byte => byte === 0));
    if (authenticated) assert.ok(tail.every(byte => byte === 0));
    assert.equal(destroyed, true);
  });
}

test('crypto setup failures fail the audit instead of counting a nonmatching key', () => {
  assert.throws(() => authenticatesWithKey({}, TEST_KEYS.publicZeroKey,
    () => { throw Error(SYNTHETIC_PLAINTEXT); }), { code: 'AUDIT_CRYPTO_FAILED' });
});

test('DB double: known keys are counted in a bounded cursor with read-only controls before any reads', async () => {
  const legacy = encryptSynthetic(TEST_KEYS.legacyFallback);
  const zero = encryptSynthetic(TEST_KEYS.publicZeroKey);
  const other = encryptSynthetic(OTHER_KEY);
  const values = [...Array(101).fill(legacy), ...Array(102).fill(zero), other, 'invalid'];
  const fixture = dbDouble(values);
  const result = await auditDatabase(fixture.client, { readOnly: true });
  assert.deepEqual(fixture.calls[0].options, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 60_000 });
  assert.deepEqual(fixture.calls.slice(1, 6).map(call => call.sql),
    [SQL.readOnly, SQL.rowSecurity, SQL.statementTimeout, SQL.lockTimeout, SQL.state]);
  assert.equal(fixture.calls.filter(call => call.sql === SQL.fetch).length, 4);
  assert.equal(fixture.calls.filter(call => call.sql === SQL.state).length, 2);
  assert.equal(fixture.calls.at(-2).sql, SQL.close);
  assert.equal(fixture.calls.at(-1).sql, SQL.state);
  assert.deepEqual(result.keys, { stored: 205, inspected: 205,
    decryptableWithLegacyFallback: 101, decryptableWithPublicZeroKey: 102,
    decryptableWithEitherKnownPublicKey: 203, notDecryptableWithKnownPublicKeys: 1,
    malformed: 1, oversized: 0 });
  assert.equal(result.scanComplete, true);
  assert.equal(result.cryptographicCoverageComplete, false);
  assert.equal(result.knownPublicKeyMatchesFound, true);
  assert.deepEqual(result.tables.map(row => row.name), TABLE_NAMES);
  assert.ok(fixture.fetchedRows.every(row => row.encryptedKey === null));
  for (const value of [legacy, zero, other, SYNTHETIC_PLAINTEXT, SYNTHETIC_URL]) {
    assert.equal(JSON.stringify(result).includes(value), false);
  }
});

test('DB double: oversize values are not transferred or treated as safe nonmatches', async () => {
  const fixture = dbDouble(['x'.repeat(MAX_ENCRYPTED_TEXT_BYTES + 1)]);
  const report = await auditDatabase(fixture.client, { readOnly: true });
  assert.equal(report.keys.oversized, 1);
  assert.equal(report.keys.notDecryptableWithKnownPublicKeys, 0);
  assert.equal(report.cryptographicCoverageComplete, false);
});

test('DB double: the explicit read-only option is required before opening a transaction', async () => {
  const fixture = dbDouble();
  for (const options of [undefined, {}, { readOnly: false }, { readOnly: 'true' }]) {
    await assert.rejects(auditDatabase(fixture.client, options), { code: 'READ_ONLY_REQUIRED' });
  }
  assert.equal(fixture.calls.length, 0);
});

for (const [flag, code] of [['readOnly', 'READ_ONLY_NOT_CONFIRMED'],
  ['repeatableRead', 'SNAPSHOT_NOT_CONFIRMED'], ['rowSecurityErrorsOnFilter', 'ROW_SECURITY_NOT_CONFIRMED']]) {
  test('DB double: refuses to scan when ' + flag + ' is not confirmed', async () => {
    const fixture = dbDouble([], { state: { [flag]: false } });
    await assert.rejects(auditDatabase(fixture.client, { readOnly: true }), { code });
    assert.equal(fixture.calls.some(call => call.sql === SQL.metadata || call.sql === SQL.count || call.sql === SQL.fetch), false);
  });
  test('DB double: refuses a completed result when ' + flag + ' changes before transaction completion', async () => {
    const fixture = dbDouble([], { finalState: { [flag]: false } });
    await assert.rejects(auditDatabase(fixture.client, { readOnly: true }), { code });
  });
}

test('DB double: a policy-filtered query error is a failed audit, never an empty inventory', async () => {
  const fixture = dbDouble([], { failOn: SQL.count, failureMessage: 'synthetic RLS error' });
  const result = await runDouble(fixture);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { status: 'failed', code: 'AUDIT_DATABASE_FAILED' });
  assert.equal(fixture.calls.some(call => call.sql === SQL.declare), false);
});

test('DB double: mismatched count, truncated cursor, or oversized fetch cannot produce success', async () => {
  const fixtures = [
    dbDouble([encryptSynthetic(OTHER_KEY)], { stored: '0' }),
    dbDouble([], { stored: '1' }),
    dbDouble(Array(101).fill(encryptSynthetic(OTHER_KEY)), { fetchSize: 101 }),
  ];
  for (const fixture of fixtures) {
    const result = await runDouble(fixture);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
  }
});

test('DB double: missing table, nonconstant metadata, and unsafe count types fail without echoing values', async () => {
  const absent = metadata();
  absent[0].present = false;
  const injected = metadata();
  injected[0].name = SYNTHETIC_PLAINTEXT;
  for (const fixture of [dbDouble([], { metadata: absent }), dbDouble([], { metadata: injected }),
    dbDouble([], { stored: '9007199254740992' }), dbDouble([], { stored: true })]) {
    const result = await runDouble(fixture);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes(SYNTHETIC_PLAINTEXT), false);
  }
});

test('DB double: CLI never uses DATABASE_URL or DIRECT_URL as an audit fallback', async () => {
  for (const extra of [
    { argv: [] }, { argv: ['--read-only', '--write'] }, { argv: ['--read-only=true'] },
    { env: { DATABASE_URL: SYNTHETIC_URL, DIRECT_URL: SYNTHETIC_URL } },
    { env: { PLATON_AUDIT_DATABASE_URL: 'not-a-connection' } },
    { env: { PLATON_AUDIT_DATABASE_URL: 'https://audit.invalid/synthetic_audit' } },
    { env: { PLATON_AUDIT_DATABASE_URL: SYNTHETIC_URL + '?schema=other' } },
  ]) {
    const result = await runDouble(dbDouble(), extra);
    assert.equal(result.code, 1);
    assert.equal(result.factoryCalls, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes(SYNTHETIC_URL), false);
  }
});

test('DB double: debug logging flags are rejected before Prisma is loaded', async () => {
  for (const name of ['DEBUG', 'RUST_LOG', 'RUST_BACKTRACE']) {
    const result = await runDouble(dbDouble(), { env: { PLATON_AUDIT_DATABASE_URL: SYNTHETIC_URL, [name]: '*' } });
    assert.equal(result.code, 1);
    assert.equal(result.factoryCalls, 0);
    assert.deepEqual(JSON.parse(result.stderr), { status: 'failed', code: 'AUDIT_DEBUG_LOGGING_FORBIDDEN' });
  }
});

test('DB double: CLI suppresses driver errors and partial results, then disconnects', async () => {
  const encrypted = encryptSynthetic(TEST_KEYS.legacyFallback);
  const sensitive = [SYNTHETIC_URL, SYNTHETIC_PLAINTEXT, encrypted, 'synthetic-user-id'].join(' ');
  const fixture = dbDouble(Array(101).fill(encrypted), { failFetch: 2, failureMessage: sensitive });
  const result = await runDouble(fixture);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { status: 'failed', code: 'AUDIT_DATABASE_FAILED' });
  assert.equal(fixture.disconnected, true);
  for (const value of sensitive.split(' ')) assert.equal(result.stderr.includes(value), false);
});

test('DB double: CLI connection cleanup failures do not leave a success report', async () => {
  const fixture = dbDouble([], { disconnectFailure: true, failureMessage: SYNTHETIC_URL });
  const result = await runDouble(fixture);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { status: 'failed', code: 'AUDIT_CONNECTION_CLEANUP_FAILED' });
});

test('DB double: CLI exits distinguish complete no-match, confirmed match, and uninspected values', async () => {
  for (const [values, expected] of [
    [[], 0], [[encryptSynthetic(OTHER_KEY)], 0],
    [[encryptSynthetic(TEST_KEYS.legacyFallback)], 2], [[encryptSynthetic(TEST_KEYS.publicZeroKey)], 2],
    [['invalid'], 3], [['x'.repeat(MAX_ENCRYPTED_TEXT_BYTES + 1)], 3],
  ]) {
    const fixture = dbDouble(values);
    const result = await runDouble(fixture);
    assert.equal(result.code, expected);
    assert.equal(JSON.parse(result.stdout).status, 'completed');
    assert.equal(result.stderr, '');
    assert.equal(fixture.disconnected, true);
  }
});

test('audit SQL does not select user identity, key hints, or provider data and has no row mutations', () => {
  assert.match(SQL.fetch, /^FETCH FORWARD 100 /);
  assert.match(SQL.declare, /CASE WHEN pg_catalog\.octet_length\("encryptedKey"\) <= 65536/);
  assert.match(SQL.declare, /CURSOR WITHOUT HOLD/);
  for (const sql of Object.values(SQL)) {
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|GRANT|REVOKE)\b/i);
    assert.doesNotMatch(sql, /"(?:id|userId|keyHint|provider)"/);
  }
});
