#!/usr/bin/env node
'use strict';

// Aggregate-only audit. This module never rotates keys or writes database rows.
// The CLI needs a dedicated URL; it does not load .env files or reuse the app DB
// singleton. Injected clients (including integration tests) must disable logging.
// Exit codes: 0 = no known public-key match and no uninspected values;
// 2 = known public-key match; 3 = malformed/oversized values need investigation;
// 1 = configuration, connection, transaction, or incomplete-scan failure.
const crypto = require('node:crypto');

const BATCH_SIZE = 100;
const MAX_ENCRYPTED_TEXT_BYTES = 65_536;
const TABLE_NAMES = Object.freeze([
  'UserApiKey', 'UsageLog', 'EventLog', 'EvalProject', 'PromptSet',
  'PromptItem', 'EvalRun', 'ModelResponse', 'JudgeScore', 'EvalReport',
]);

// All SQL is fixed source text. No URL, flag, identifier, or row value is
// interpolated into SQL. Unsafe-suffixed Prisma APIs accept these constant
// statements so the same small interface can also be exercised with a DB double.
const SQL = Object.freeze({
  readOnly: 'SET TRANSACTION READ ONLY',
  rowSecurity: 'SET LOCAL row_security = off',
  statementTimeout: "SET LOCAL statement_timeout = '10000ms'",
  lockTimeout: "SET LOCAL lock_timeout = '3000ms'",
  state: `SELECT
    pg_catalog.current_setting('transaction_read_only') = 'on' AS "readOnly",
    pg_catalog.current_setting('transaction_isolation') = 'repeatable read' AS "repeatableRead",
    pg_catalog.current_setting('row_security') = 'off' AS "rowSecurityErrorsOnFilter"`,
  metadata: `WITH requested ("name") AS (VALUES
      ('UserApiKey'), ('UsageLog'), ('EventLog'), ('EvalProject'), ('PromptSet'),
      ('PromptItem'), ('EvalRun'), ('ModelResponse'), ('JudgeScore'), ('EvalReport'))
    SELECT requested."name", c.oid IS NOT NULL AS "present",
      COALESCE(c.relrowsecurity, false) AS "rowSecurityEnabled",
      COALESCE(c.relforcerowsecurity, false) AS "rowSecurityForced",
      COALESCE(pg_catalog.has_table_privilege(c.oid, 'SELECT'), false) AS "selectGranted",
      (SELECT count(*)::text FROM pg_catalog.pg_policy p
        WHERE p.polrelid = c.oid) AS "policyCount",
      (SELECT count(*)::text FROM pg_catalog.pg_policy p
        WHERE p.polrelid = c.oid AND p.polcmd IN ('r', '*')) AS "selectPolicyCount"
    FROM requested
    LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
      AND c.relname = requested."name" AND c.relkind IN ('r', 'p')`,
  count: 'SELECT count(*)::text AS "stored" FROM public."UserApiKey"',
  declare: `DECLARE platon_api_key_audit NO SCROLL CURSOR WITHOUT HOLD FOR
    SELECT CASE WHEN pg_catalog.octet_length("encryptedKey") <= 65536
        THEN "encryptedKey" ELSE NULL END AS "encryptedKey",
      pg_catalog.octet_length("encryptedKey") > 65536 AS "oversized"
    FROM public."UserApiKey"`,
  fetch: 'FETCH FORWARD 100 FROM platon_api_key_audit',
  close: 'CLOSE platon_api_key_audit',
});

const ERROR_CODES = new Set([
  'READ_ONLY_REQUIRED', 'AUDIT_URL_REQUIRED', 'AUDIT_URL_INVALID',
  'AUDIT_DEBUG_LOGGING_FORBIDDEN', 'INVALID_DATABASE_RESPONSE',
  'READ_ONLY_NOT_CONFIRMED', 'SNAPSHOT_NOT_CONFIRMED', 'ROW_SECURITY_NOT_CONFIRMED',
  'API_KEY_TABLE_UNAVAILABLE', 'AUDIT_ROW_COUNT_MISMATCH',
  'AUDIT_DATABASE_FAILED', 'AUDIT_CRYPTO_FAILED', 'AUDIT_CONNECTION_CLEANUP_FAILED',
]);

class AuditError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AuditError';
    this.code = code;
  }
}

function safeError(error) {
  return error instanceof AuditError && ERROR_CODES.has(error.code)
    ? error : new AuditError('AUDIT_DATABASE_FAILED');
}

function checkedCount(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^\d+$/.test(value))) {
    throw new AuditError('INVALID_DATABASE_RESPONSE');
  }
  const count = BigInt(value);
  if (count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AuditError('INVALID_DATABASE_RESPONSE');
  }
  return Number(count);
}

function checkTransactionState(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new AuditError('INVALID_DATABASE_RESPONSE');
  if (rows[0].readOnly !== true) throw new AuditError('READ_ONLY_NOT_CONFIRMED');
  if (rows[0].repeatableRead !== true) throw new AuditError('SNAPSHOT_NOT_CONFIRMED');
  if (rows[0].rowSecurityErrorsOnFilter !== true) throw new AuditError('ROW_SECURITY_NOT_CONFIRMED');
}

function safeMetadata(rows) {
  if (!Array.isArray(rows) || rows.length !== TABLE_NAMES.length) {
    throw new AuditError('INVALID_DATABASE_RESPONSE');
  }
  const names = new Set(rows.map(row => row.name));
  if (names.size !== TABLE_NAMES.length || TABLE_NAMES.some(name => !names.has(name))) {
    throw new AuditError('INVALID_DATABASE_RESPONSE');
  }
  return TABLE_NAMES.map(name => {
    const row = rows.find(item => item.name === name);
    const item = { name };
    for (const flag of ['present', 'rowSecurityEnabled', 'rowSecurityForced', 'selectGranted']) {
      if (typeof row[flag] !== 'boolean') throw new AuditError('INVALID_DATABASE_RESPONSE');
      item[flag] = row[flag];
    }
    item.policyCount = checkedCount(row.policyCount);
    item.selectPolicyCount = checkedCount(row.selectPolicyCount);
    if (item.selectPolicyCount > item.policyCount) throw new AuditError('INVALID_DATABASE_RESPONSE');
    return item;
  });
}

// AES-GCM may produce unauthenticated plaintext in update(), before final()
// rejects a tag. Wipe every output buffer on both paths; never decode it to a
// JavaScript string, concatenate it, return it, or include it in an error.
function authenticatesWithKey(envelope, key, makeDecipher = crypto.createDecipheriv) {
  let decipher;
  let plaintext;
  let tail;
  try {
    decipher = makeDecipher('aes-256-gcm', key, envelope.iv);
    decipher.setAuthTag(envelope.tag);
    plaintext = decipher.update(envelope.data);
    try {
      tail = decipher.final();
      return true;
    } catch {
      // With a validated GCM envelope, final() rejects an authentication failure.
      return false;
    }
  } catch {
    // Initialization/update failures are not proof of a nonmatching key.
    throw new AuditError('AUDIT_CRYPTO_FAILED');
  } finally {
    if (Buffer.isBuffer(plaintext)) plaintext.fill(0);
    if (Buffer.isBuffer(tail)) tail.fill(0);
    if (decipher) decipher.destroy();
  }
}

function classifyEncryptedKey(value, keys) {
  if (typeof value !== 'string') return { malformed: true };
  if (Buffer.byteLength(value, 'utf8') > MAX_ENCRYPTED_TEXT_BYTES) return { oversized: true };
  const parts = value.split(':');
  if (parts.length !== 3 || !/^[0-9a-fA-F]{24}$/.test(parts[0]) ||
      !/^[0-9a-fA-F]{32}$/.test(parts[1]) || !/^(?:[0-9a-fA-F]{2})*$/.test(parts[2])) {
    return { malformed: true };
  }
  const envelope = {
    iv: Buffer.from(parts[0], 'hex'),
    tag: Buffer.from(parts[1], 'hex'),
    data: Buffer.from(parts[2], 'hex'),
  };
  try {
    return {
      legacyFallback: authenticatesWithKey(envelope, keys.legacyFallback),
      publicZeroKey: authenticatesWithKey(envelope, keys.publicZeroKey),
    };
  } finally {
    envelope.iv.fill(0);
    envelope.tag.fill(0);
    envelope.data.fill(0);
  }
}

async function auditDatabase(client, { readOnly = false } = {}) {
  if (readOnly !== true) throw new AuditError('READ_ONLY_REQUIRED');
  const keys = {
    // Historical, publicly known values; never use either to encrypt new data.
    legacyFallback: crypto.scryptSync('dev-key', 'salt', 32),
    publicZeroKey: Buffer.alloc(32),
  };
  try {
    return await client.$transaction(async tx => {
      await tx.$executeRawUnsafe(SQL.readOnly);
      await tx.$executeRawUnsafe(SQL.rowSecurity);
      await tx.$executeRawUnsafe(SQL.statementTimeout);
      await tx.$executeRawUnsafe(SQL.lockTimeout);
      checkTransactionState(await tx.$queryRawUnsafe(SQL.state));

      const tables = safeMetadata(await tx.$queryRawUnsafe(SQL.metadata));
      const keyTable = tables.find(table => table.name === 'UserApiKey');
      if (!keyTable.present || !keyTable.selectGranted) throw new AuditError('API_KEY_TABLE_UNAVAILABLE');

      // row_security=off makes a restricted role fail instead of reporting a
      // policy-filtered zero. Counts and cursor share one Repeatable Read snapshot.
      const rows = await tx.$queryRawUnsafe(SQL.count);
      if (!Array.isArray(rows) || rows.length !== 1) throw new AuditError('INVALID_DATABASE_RESPONSE');
      const counts = {
        stored: checkedCount(rows[0].stored),
        inspected: 0,
        decryptableWithLegacyFallback: 0,
        decryptableWithPublicZeroKey: 0,
        decryptableWithEitherKnownPublicKey: 0,
        notDecryptableWithKnownPublicKeys: 0,
        malformed: 0,
        oversized: 0,
      };
      await tx.$executeRawUnsafe(SQL.declare);
      for (;;) {
        const batch = await tx.$queryRawUnsafe(SQL.fetch);
        if (!Array.isArray(batch) || batch.length > BATCH_SIZE) throw new AuditError('INVALID_DATABASE_RESPONSE');
        if (batch.length === 0) break;
        for (const row of batch) {
          try {
            if (!row || typeof row.oversized !== 'boolean') throw new AuditError('INVALID_DATABASE_RESPONSE');
            const result = row.oversized ? { oversized: true } : classifyEncryptedKey(row.encryptedKey, keys);
            counts.inspected += 1;
            if (counts.inspected > counts.stored) throw new AuditError('AUDIT_ROW_COUNT_MISMATCH');
            if (result.oversized) counts.oversized += 1;
            else if (result.malformed) counts.malformed += 1;
            else {
              if (result.legacyFallback) counts.decryptableWithLegacyFallback += 1;
              if (result.publicZeroKey) counts.decryptableWithPublicZeroKey += 1;
              if (result.legacyFallback || result.publicZeroKey) counts.decryptableWithEitherKnownPublicKey += 1;
              else counts.notDecryptableWithKnownPublicKeys += 1;
            }
          } finally {
            // Release this immutable ciphertext string as soon as it is classified.
            if (row && typeof row === 'object') row.encryptedKey = null;
          }
        }
      }
      await tx.$executeRawUnsafe(SQL.close);
      if (counts.inspected !== counts.stored) throw new AuditError('AUDIT_ROW_COUNT_MISMATCH');
      checkTransactionState(await tx.$queryRawUnsafe(SQL.state));
      return {
        formatVersion: 1,
        status: 'completed',
        schema: 'public',
        readOnly: true,
        repeatableRead: true,
        rowSecurityErrorsOnFilter: true,
        scanComplete: true,
        cryptographicCoverageComplete: counts.malformed === 0 && counts.oversized === 0,
        knownPublicKeyMatchesFound: counts.decryptableWithEitherKnownPublicKey > 0,
        tables,
        keys: counts,
      };
    }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 60_000 });
  } catch (error) {
    // Driver errors can contain the connection string, query, or row values.
    // Never attach their cause, stack, message, or metadata to our safe error.
    throw safeError(error);
  } finally {
    keys.legacyFallback.fill(0);
    keys.publicZeroKey.fill(0);
  }
}

function auditUrl(argv, env) {
  if (argv.length !== 1 || argv[0] !== '--read-only') throw new AuditError('READ_ONLY_REQUIRED');
  const value = env.PLATON_AUDIT_DATABASE_URL;
  if (typeof value !== 'string' || !value.trim()) throw new AuditError('AUDIT_URL_REQUIRED');
  try {
    const parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname ||
        !parsed.pathname || parsed.pathname === '/' ||
        (parsed.searchParams.has('schema') && parsed.searchParams.get('schema') !== 'public')) {
      throw new Error();
    }
  } catch {
    throw new AuditError('AUDIT_URL_INVALID');
  }
  // Fail before loading Prisma if engine/client debug output could bypass log:[].
  if (['DEBUG', 'RUST_LOG', 'RUST_BACKTRACE'].some(name => typeof env[name] === 'string' && env[name].trim())) {
    throw new AuditError('AUDIT_DEBUG_LOGGING_FORBIDDEN');
  }
  return value;
}

function createPrismaClient(url) {
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url } }, log: [], errorFormat: 'minimal' });
}

async function runCli({
  argv = process.argv.slice(2), env = process.env,
  createClient = createPrismaClient, stdout = process.stdout, stderr = process.stderr,
} = {}) {
  let client;
  let report;
  let failure;
  try {
    client = createClient(auditUrl(argv, env));
    report = await auditDatabase(client, { readOnly: true });
  } catch (error) {
    failure = safeError(error);
  } finally {
    if (client) {
      try { await client.$disconnect(); }
      catch { if (!failure) failure = new AuditError('AUDIT_CONNECTION_CLEANUP_FAILED'); }
    }
  }
  if (failure) {
    stderr.write(JSON.stringify({ status: 'failed', code: failure.code }) + '\n');
    return 1;
  }
  stdout.write(JSON.stringify(report) + '\n');
  if (report.knownPublicKeyMatchesFound) return 2;
  return report.cryptographicCoverageComplete ? 0 : 3;
}

module.exports = {
  auditDatabase, runCli, classifyEncryptedKey, authenticatesWithKey,
  SQL, TABLE_NAMES, BATCH_SIZE, MAX_ENCRYPTED_TEXT_BYTES,
};

if (require.main === module) {
  runCli().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write('{"status":"failed","code":"AUDIT_DATABASE_FAILED"}\n');
    process.exitCode = 1;
  });
}
