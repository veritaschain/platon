# Tenant authorization repair without a database or encryption migration

## Why this is separate

At main `062d09ea1420e427769d5c7fe42c589e9d2d6369`, owning the project in a request URL did not establish ownership of a supplied child item or evaluation run. The broader [draft PR #2](https://github.com/veritaschain/platon/pull/2) also changes encryption configuration and database migration handling. Its production database and historical-key review requirements still apply to those changes.

This repair extracts the thirteen non-encryption runtime files from reviewed draft head `709802806f1da8c2829ebe548ba3235487c3073d`. It binds child reads/writes and full/step evaluation to the authenticated owner, requested project, run and original prompt set. It rechecks membership at provider dispatch/retry and scoped persistence, excludes historical foreign responses from new aggregation, masks assembled judge/recommendation inputs and avoids returning raw provider/database errors.

## Compatibility and remaining scope

- The Prisma schema, tracked migrations, package/lock files, encryption implementations and environment examples are unchanged from the main baseline. Every queried field/relation already belongs to that schema; no new table, column or key format is required by this patch.
- As before, a working evaluation deployment needs the evaluation tables already described by that schema. This patch does not establish that any particular production database has them. The old migration-history gap is not repaired here.
- The broader draft remains responsible for inventorying the actual database and migration history, including earlier `db push`, planning any baseline/reconciliation, auditing historical encryption keys and checking the target Supabase authentication/roles with separate synthetic users. Do not reset production data or apply its migration blindly.
- Main's legacy public encryption-key fallback is not repaired by this isolated tenant change. The missing-key test is intentionally excluded, not converted into a pass. Existing encrypted data/key compatibility still requires the broader review.
- A last database check is not an atomic lease over an external AI request. A concurrent ownership change after that check cannot recall already transmitted data. Concurrent/repeated execution behavior and deployment runtime constraints also remain separate review items.
- These tests do not assess all application routes, actual Supabase sessions, production provider transport, dependency vulnerabilities, VAP conformity or absence of past exploitation.

## Verification

The synthetic suites run actual transpiled route/evaluator code with synthetic sessions and relation-aware database doubles. Run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-reporter=tap tests/security/*.test.cjs
npx --no-install prisma generate
npx --no-install tsc --noEmit
```

The `Platon tenant boundary regression` workflow also checks the immutable pre-fix main source. It requires exactly three original authorization failures (foreign prompt PATCH, foreign prompt DELETE and foreign run initialization), all specifically returning 200 where 404 is expected, plus two passing same-project controls. A build crash, import error or unrelated nonzero exit cannot satisfy that negative control.

Its second job uses an empty, disposable loopback PostgreSQL 16 service and the unchanged main Prisma schema. Only that CI service is populated with `prisma db push`; this is a fixture setup command, not a production migration instruction. Hard guards require the exact synthetic URLs, a GitHub Actions runner and the baseline schema SHA-256 `1b1d5003a2498c57fc921a091cac9efc2afda25f7e9a493b9a3004dadf8c9033`. The route/evaluator suites exercise real Prisma relations and ownership changes committed through a second connection. They reject external database hosts and never fall back to application connection URLs. AI transport and authentication remain synthetic.

Successful synthetic/database CI establishes the bounded code regression and schema compatibility in that fixture. It does not establish production deployment or replace the remaining PR #2 rollout gates.
