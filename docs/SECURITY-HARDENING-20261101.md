# Tenant boundary and key-configuration repair (draft)

This change is not a production deployment or a complete security audit.

## November 5 refresh against current main

This draft now incorporates main
`36283f44a24482e4cbc06acbdf0886b8d4c1fa59`, which includes the separate tenant
repair (PR #3), supported Next.js 15 migration (PR #4), and compatible dependency
patches (PR #5). The previous draft head was
`709802806f1da8c2829ebe548ba3235487c3073d`; both histories are preserved by the
merge. Earlier validation counts in the historical provenance below apply to
their named revisions, not automatically to this refreshed candidate.

The resulting application keeps main's Next.js 15.5.29 / React 19.2.9 versions,
lockfile, asynchronous cookie/client/route-parameter APIs, and merged tenant
predicates. The original draft's strict encryption implementation, additive
migration, aggregate-only audit CLI, crypto/audit tests and rollout gates are
retained. The only application-source differences from current main are the two
encryption entrypoints. Existing `iv:tag:ciphertext` format compatibility does not
establish which key was used for any deployed record.

All three workflows remain enabled. The Prisma schema is identical in the old
draft and current main (SHA-256
`1b1d5003a2498c57fc921a091cac9efc2afda25f7e9a493b9a3004dadf8c9033`), so the existing
tenant job's exact schema/fixture guards remain valid and unchanged:

| Workflow path | What it verifies |
| --- | --- |
| `tenant-boundaries.yml` | Existing desired-schema compatibility in a fresh `db push` fixture, real route/evaluator predicates, and the strict three-failure/two-valid-control check against `062d09e...`. |
| `security-regression.yml` | Strict crypto/audit regressions, actual tracked migration application, legacy data preservation, RLS/rollback/audit integration, and four named evaluator failures plus the valid control against `bf19c64...`. |
| `next-framework.yml` | Ordinary production compilation/type checking and synthetic-setting HTTP smoke checks on Next 15. |

The two PostgreSQL jobs use separate disposable service databases on separate
runners. The `db push` fixture is not evidence that the tracked migration has
passed, and no `db push` step is added to the migration job. No schema guard,
negative control, authorization assertion or production rollout gate is relaxed.
The tenant source archive also includes `scripts`, because the combined security
suite now exercises the retained audit CLI.

Local refresh verification: all **94 security tests passed**, including the
retained encryption/audit cases and the six Next async-request cases; no failures
or skips. Clean lockfile installation, Prisma client generation, TypeScript
checking, production build/HTTP smoke, and the strict old-source tenant control
also passed. The smoke check used synthetic settings, returned 200 for login,
redirected the anonymous dashboard to login and returned 401 for all five API
checks; no synchronous request-API warning or synthetic private-setting marker
in public static files was observed. The latest CI results for this refreshed commit must separately
establish the real PostgreSQL outcomes; the previous draft's 107-result run is
historical evidence only.

### Evidence still required before this draft can leave draft status

| Required evidence | Current state and safe next step |
| --- | --- |
| Target database inventory | Not collected in this refresh. Confirm the actual target, table definitions, `_prisma_migrations` history, any prior `db push`, owners, grants and policies. Existing evaluation tables need a reviewed reconciliation/baseline plan before applying the additive migration. |
| Historical key inventory | Not collected in this refresh. Run the existing aggregate-only audit with a dedicated authorized read role and `PLATON_AUDIT_DATABASE_URL` supplied through the approved secret mechanism. Resolve known-public-key matches, malformed/oversized or otherwise uninspected records before strict-key deployment. Never paste a URL, key, ciphertext or plaintext into PR evidence. |
| Deployment key configuration | Not inspected or changed here. Verify that the intended runtime has a valid non-public key compatible with retained encrypted records. Any re-encryption or credential rotation requires its own reviewed procedure and restricted backup; this branch performs neither. |
| Target Supabase authentication/roles | Not tested here. Verify the real target's authentication/JWT and database-role behavior using separate synthetic users before rollout. Disposable PostgreSQL tests do not substitute for the deployed Supabase configuration. |

These missing inventories are deployment prerequisites, not failures inferred
from unavailable production access. No production environment, database or key
was read or changed during this refresh. Keep PR #2 **Draft** even if the refreshed
CI jobs pass.

## Retained hardening scope

Project ownership is part of the child query/mutation for prompt PATCH/DELETE and eval-run, response, report and export reads. Progress execution checks the run's project and owner before invoking the evaluator. Step execution checks the run before parsing its requested action, rejects prompt IDs outside that run's prompt set before fetching API keys, and never mutates a supplied run ID on authentication failure.

The November 4 follow-up binds the full evaluator and step evaluator to the requesting user, project, run and original prompt set. The worker independently authorizes its entry instead of relying on an earlier SSE handler check. Current ownership and prompt/response membership are checked again immediately before each provider dispatch and retry. ModelResponse, JudgeScore and EvalReport persistence uses scoped relational `connect` predicates; status and cost mutations retain their owner/project predicates. A committed ownership or membership change during a provider call therefore blocks later persistence. Authorization failures are propagated rather than treated as provider failures, and raw database errors are not returned in the SSE stream. Failed progress notifications cannot discard an already obtained execution result.

These checks are not an atomic authorization lease over an external request. Ownership can change after the final query and before the provider receives a request, and already transmitted input cannot be recalled. The implementation deliberately avoids holding a database transaction open across provider calls. Production review must define the supported ownership-transfer/revocation behavior, concurrent or repeated evaluation behavior, and deployment execution model. No tenant-isolation claim is made for code paths outside the reviewed handlers and evaluators.

The legacy encryption import path re-exports the canonical AES-256-GCM implementation. Both paths require exactly 64 hexadecimal ENCRYPTION_KEY characters. Invalid or absent configuration raises an error on encryption/decryption; there is no public fixed-key fallback. Properly configured existing iv:tag:ciphertext records retain compatibility. The parser validates IV, tag and ciphertext hexadecimal encoding.

## Rollout gates

Keep this PR in draft until the target database has been inventoried, existing key records have been audited, and deployment-specific Supabase authentication and database roles have been verified with separate synthetic users. The new CI job uses real PostgreSQL 16 and the lockfile's Prisma 5.22 client. It executes actual handlers and evaluators, while authentication, provider transport and API-key lookup remain synthetic. This verifies PostgreSQL query behavior and RLS in the disposable service database; it is not a test of the deployed Supabase project, its JWT configuration, grants, networking, or customer data. Type checking is recorded separately from runtime tests.

Before rollout, determine whether any records were encrypted using the old public development key or the all-zero key previously shown in `.env.local.example`. Back up affected data with restricted access and use an explicit, separately reviewed migration/credential rotation procedure. Do not silently retry decryption with a known fallback key and do not rewrite customer data from this PR. The example now requires a separately generated key instead of supplying a public value.

### Read-only inventory and key audit

The [rollout readiness procedure](ROLLOUT-READINESS-20261106.md) provides the
exact audit capture command, exit-code interpretation, migration decision table
and outstanding target-evidence record. It does not collect or approve target
evidence by itself.

`node scripts/audit-database.cjs --read-only` requires the dedicated `PLATON_AUDIT_DATABASE_URL` environment variable. Set that variable through the approved secret mechanism; do not paste a connection string into a PR, command history, test artifact or chat. The command never falls back to application `DATABASE_URL` or `DIRECT_URL` values.

The audit creates a quiet Prisma client and a repeatable-read, read-only transaction. It verifies transaction settings, inventories the fixed ten current application tables, and scans encrypted keys in bounded batches. Setting `row_security = off` makes a filtered read fail instead of incorrectly reporting zero rows; it does not grant a role access to protected rows. Use a database role authorized to read all UserApiKey rows. The audit outputs only table existence/RLS/SELECT flags, policy counts, and aggregate key counts. It never prints the connection URL, identifiers, ciphertext, plaintext, or raw database errors. It does not alter tables, roles, keys or policies.

The two known public keys are tested through authenticated AES-GCM decryption. A non-match only means those two keys did not authenticate that value; it does not establish that the record or its encryption key is secure. Malformed and oversized records are explicitly counted as uninspected. Exit status is 0 for a completed audit with no known-key match or uninspected record, 2 for known-key matches, 3 for malformed/oversized records without a match, and 1 for an incomplete or failed audit. No credential rotation or data rewrite is performed by this command.

### Migration inventory requirement

The tracked pre-existing migration history creates the earlier chat application but not the seven evaluation tables in the current Prisma schema. `20261104120000_add_eval_platform_and_rls` adds those seven tables, their enums/indexes/foreign keys, and RLS in one transaction. It preserves all legacy tables, rows, enums and the old UsageLog foreign key. The old `UsageLog.modelRunId` becomes nullable and the new nullable `modelResponseId` is added, allowing both historical chat usage and evaluation usage to remain readable.

No RLS policies are added: ordinary anon/authenticated database roles are denied direct access, even when table privileges have been granted. Server-side table-owner access still works and still requires application-level tenant predicates. These tests must not be described as per-user RLS policies.

An existing deployment may already contain evaluation tables created outside tracked migrations, for example by `prisma db push`. Do not apply this migration blindly to that deployment. First inspect its table definitions, `_prisma_migrations` history, owners, grants and policies; compare them with the reviewed migration and make a separately reviewed baseline/reconciliation plan. The migration deliberately fails on conflicting existing tables rather than using `IF NOT EXISTS` to hide schema drift. Do not use `migrate reset`, drop the preserved legacy tables, or regenerate a destructive migration to make the deployment fit this PR.

The full evaluator used by the SSE progress route now applies the same run/project/owner and prompt-set/project/owner predicates to both response queries. Historical ModelResponse rows that reference another owner's prompt, another project of the same owner, or another prompt set cannot reach the judge or report aggregation through those queries. This filters the processing scope; it does not delete or rewrite historical records. Investigate any such associations and previously generated reports separately; these filters do not erase previously exported or leaked data. No exploitation, leakage or absence of leakage has been established by these synthetic tests.

Both judge entrypoints and recommendation generation apply the existing PII masker to the complete outgoing message. Judge coverage includes the original prompt, gold-standard hint, use-case description and model response, including retries, without modifying stored inputs. Recommendation coverage includes the assembled use-case profile, rankings and score matrix. Connector-capture tests verify that synthetic email and phone fixtures do not reach these provider boundaries. This reuses the current regex-based detection policy; it does not establish exhaustive PII detection or cover every other AI egress path, including prompt generation.

Provider integration, end-to-end evaluation, full application security and formal VAP conformity remain unestablished.

## Historical test provenance

Baseline source: 062d09ea1420e427769d5c7fe42c589e9d2d6369. The regression-only commit a517598c61ef892a7e2a379703567d9aeef77e87 produced 31 cases, 19 failures and 12 passes against unmodified application code. Some failures concern explicit error classification rather than distinct security vulnerabilities. Its initial workflow status incorrectly reflected tee's exit status, so the TAP output, not that green status, is the baseline evidence. The updated workflow uses explicit bash pipefail. Fixes and additional execution-boundary cases are recorded in subsequent CI runs.

The expanded 41-case suite was also run locally against baseline 062d09ea1420e427769d5c7fe42c589e9d2d6369: 12 passed and 29 failed. Against the existing repair commit e8cd422f8ead20baa7f3199c68a495c75f7866e2, the 38 authorization/encryption cases passed while the three new judge-egress cases failed. With the judge-egress repair, all 41 passed (`node --test --test-isolation=none --test-reporter=tap tests/security/*.test.cjs`). `prisma generate` and `tsc --noEmit` also passed. These are synthetic tests and type checks, not a deployed database or provider-integration result.

A separate four-case regression executes the real full evaluator with synthetic relational records. Before the response-scope repair, the normal case passed and all three historical-contamination cases failed because the foreign row reached judging. After the repair, all four pass, including assertions that only the permitted row reaches judging, objective metrics, highlights and cost projection, and that historical rows remain unchanged. The combined suite now has 45 passes and zero failures. The earlier progress-route success fixture uses a completed run and does not cover this evaluator path; the new regression covers the evaluator directly.

### November 4 follow-up automation

The current `security-regression.yml` workflow retains TAP output, the exact reviewed source archive, source/migration checksums, checkout SHA and the pinned PostgreSQL image reference. Its PostgreSQL job checks fresh migration, legacy-row preservation, idempotent redeployment, transactional rollback on conflicting schema, owner/anon/authenticated-equivalent CRUD, real handler predicates, committed ownership/membership changes, and read-only audit behavior. All data are synthetic; provider requests are captured locally.

Database tests require `PLATON_TEST_DATABASE_URL` explicitly and reject external hosts, non-test database names and URL option overrides. They do not inherit application connection URLs. The service database is named `platon_security_test`; migration fixtures use separate randomly named schemas and generated roles. Route/evaluator/audit fixtures remove only records they created. Run with `node --test --test-concurrency=1 tests/database/*.test.cjs` after generating Prisma Client and deploying migrations to that disposable database.

The workflow also checks out immutable pre-follow-up source `bf19c64fbe52cea0551b9b525f4df37ac59acbf5` and runs a positive full-evaluation control plus four authorization cases against that source and real PostgreSQL. The negative-control step requires precisely the four named expected failures and a passing valid-run control; an arbitrary test crash or a changed function signature cannot satisfy it. Current CI results, rather than the existence of this automation, determine whether the integration gate has passed. The PR remains a deployment draft even if all disposable-database checks pass.
