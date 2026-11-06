# PR #2 deployment readiness

This procedure prepares the remaining encryption and migration changes in
[PR #2](https://github.com/veritaschain/platon/pull/2) for a deployment decision.
The reviewed code baseline is
`5990632ecced49b9faf724f7f43c9f2b25a72b65`, incorporating main
`36283f44a24482e4cbc06acbdf0886b8d4c1fa59`. Record the final reviewed source commit
with each execution. Documentation updates do not establish a new runtime test
result or target deployment.

**Current target status: not inspected.** The database inventory, historical-key
assessment, runtime-key compatibility and target authentication/role checks
remain required. The synthetic CI results are recorded in
[the hardening notes](SECURITY-HARDENING-20261101.md).

## 1. Prepare the reviewed source and the intended read connection

Use a clean checkout of the reviewed PR revision with Node.js 24.22.1, matching
the committed CI. Install the existing lockfile and generate the client locally:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install prisma generate
```

These two commands do not apply migrations. Do not run the database test suites
against an application database; those tests create and remove synthetic data in
a dedicated disposable PostgreSQL service.

The environment operator must identify the intended database and supply a
dedicated authorized read connection as `PLATON_AUDIT_DATABASE_URL` through the
existing secret mechanism. No connection value belongs in a command argument,
PR, chat or test artifact. The audit does not load `.env` files and does not use
`DATABASE_URL` or `DIRECT_URL` as a fallback. Its schema is fixed to `public`.

The read role must be authorized to inspect all `UserApiKey` rows. The audit sets
`row_security = off` to make a policy-filtered read fail; this setting does not
grant access. If that role cannot perform the complete read, use the separately
reviewed database-access procedure. Do not disable RLS or give an arbitrary
application role broader privileges to make the command pass.

## 2. Capture the existing aggregate-only key audit

Run in the controlled environment that has the approved read connection. Keep
shell tracing disabled and client/engine debug logging unset. The CLI rejects
nonempty `DEBUG`, `RUST_LOG` and `RUST_BACKTRACE` before opening a client.

The following Bash snippet creates a restricted directory outside the checkout,
preserves the CLI's real exit status and keeps failed output separate:

```bash
set -euo pipefail
umask 077
git diff --quiet
git diff --cached --quiet
PLATON_REVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/platon-readiness.XXXXXXXX")"
git rev-parse HEAD > "$PLATON_REVIEW_DIR/source-commit.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$PLATON_REVIEW_DIR/recorded-at-utc.txt"
node --version > "$PLATON_REVIEW_DIR/node-version.txt"
node -p "require('@prisma/client/package.json').version" > "$PLATON_REVIEW_DIR/prisma-client-version.txt"
sha256sum scripts/audit-database.cjs src/lib/crypto.ts src/lib/crypto/encryption.ts \
  prisma/migrations/*/migration.sql > "$PLATON_REVIEW_DIR/source.sha256"
if node scripts/audit-database.cjs --read-only \
  > "$PLATON_REVIEW_DIR/key-inventory.json" \
  2> "$PLATON_REVIEW_DIR/key-inventory.stderr.json"; then
  PLATON_AUDIT_EXIT=0
else
  PLATON_AUDIT_EXIT=$?
fi
printf '%s\n' "$PLATON_AUDIT_EXIT" > "$PLATON_REVIEW_DIR/key-inventory.exit"
```

Retain the directory through the approved restricted evidence store before its
temporary storage expires. Aggregate results can still describe the deployment;
review them before publishing any summary. Do not attach raw database exports,
connection values, keys, ciphertext, plaintext or user identifiers.

| CLI exit | Interpretation | Next step |
| --- | --- | --- |
| `0` | The scan completed, every value was structurally inspectable, and neither of the two known public keys authenticated a value. | Continue the other readiness checks. This does not prove that the intended runtime key can decrypt all retained records or that unknown keys are safe. |
| `2` | At least one value authenticated with the historical development key or public zero key. | Keep deployment pending; review restricted backup, affected credentials and a separately designed rotation/data-conversion plan. Also inspect malformed/oversized counts because exit `2` takes precedence over `3`. |
| `3` | No known-key match was found, but malformed or oversized values remain uninspected. | Investigate those values through the restricted data procedure; retain the unresolved count. |
| `1` | Configuration, connection, read authorization, transaction, scan or cleanup failed. | Treat this as an incomplete audit. The CLI emits only a fixed error code and no completed JSON report; resolve the cause and rerun. |

The report inventories only ten current application tables: existence, RLS
flags, SELECT privilege flags and policy counts. It does not export their
definitions, owners, full grants, policy expressions, legacy-table inventory or
`_prisma_migrations` history. Those are separate inputs to the next step. The CLI
does not compare records with the proposed runtime key, rewrite rows or rotate
credentials. A valid 64-hex-character configuration alone does not establish key
secrecy or historical compatibility.

## 3. Decide the migration path from the target inventory

Obtain a restricted, read-only schema/history inventory from the database
operator. It must cover the table definitions, indexes and foreign keys; owners,
grants and RLS/policies; and migration names, checksums, completion/rollback
states, including any changes made through `db push`. Do not export application
rows or migration error logs into a public review. Record a private evidence
reference and a dated assessment of these facts.

Compare that inventory with the five committed migrations. The candidate adds
`20261104120000_add_eval_platform_and_rls`, creates seven evaluation tables and
preserves legacy chat data and the old `UsageLog.modelRunId` relationship. See
[the migration](../prisma/migrations/20261104120000_add_eval_platform_and_rls/migration.sql).

| Observed target state | Required plan before applying changes |
| --- | --- |
| Only the four tracked legacy migrations are applied; no conflicting evaluation objects exist. | Rehearse the additive migration on a disposable, appropriately protected restored copy. Verify preserved legacy data and relationships, evaluation writes, RLS and the intended runtime key before scheduling target application. |
| Any evaluation objects already exist but are not represented by the tracked migration history. | Compare exact definitions and history, then prepare a reviewed reconciliation/baseline plan. The additive migration deliberately fails on conflicting objects. |
| The new migration is already recorded as applied. | Verify its checksum and actual definitions, plus application/key compatibility. A history entry alone does not establish the current schema. |
| A migration is failed, partial, rolled back, or the target/history is uncertain. | Resolve that recorded state before an application deployment. Do not infer readiness from a successful clean-database CI job. |

For a **new empty development database**, or for the agreed staged migration
rehearsal, the repository command is `npx --no-install prisma migrate deploy`.
It applies tracked migrations. `npm run db:migrate` invokes `prisma migrate dev`
and is not the update command for an existing deployment. The repository has no
`db:push` npm script. No reset, dropped legacy table, automatic `IF NOT EXISTS`,
or unreviewed migration-history rewrite is part of this procedure.

## 4. Complete the target-specific checks

The runtime operator must confirm the actual hosting target, branch/revision and
secret delivery path; `amplify.yml` and the Vercel setup notes do not identify the
currently running deployment. Confirm the configured key is non-public and
compatible with retained ciphertext using the restricted review procedure. A
new random key must not be substituted for the current key merely to satisfy the
format check. The current PR performs no re-encryption or credential rotation.

Using separate synthetic users and records in the agreed staging environment,
verify the real Supabase JWT/session boundary and database roles. Check that a
foreign prompt PATCH/DELETE and foreign run initialization are rejected before
mutation, and that same-owner controls still work. Confirm direct
anon/authenticated database access remains denied where expected and that
server-owner access relies on the application predicates. Provider transport in
the existing CI is synthetic; it is not evidence about hosted provider calls.

Prepare a restricted backup and restoration plan compatible with any new writes
before the eventual deployment. Application rollback does not by itself reverse
schema or key changes. This runbook performs no migration, rollout or rollback.

## Readiness record

Keep PR #2 in draft while any required row is pending. Fill this record with
dated evidence references; never paste secret values into it.

| Required item | Evidence reference / outcome |
| --- | --- |
| Reviewed final commit and relevant CI | Pending final review |
| Confirmed target/environment and authorized read role | Not collected |
| Complete key audit, exit code and unresolved counts | Not collected |
| Restricted schema/history comparison and chosen migration path | Not collected |
| Runtime key provenance and retained-ciphertext compatibility | Not collected |
| Staged migration, legacy preservation and restoration rehearsal | Not collected |
| Target authentication and database-role tests | Not collected |
| Deployment operator and agreed application/rollback plan | Not collected |

This record does not assert production safety, absence of past disclosure,
VAP/VCP conformance or a successful deployment.
