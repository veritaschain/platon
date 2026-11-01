# Tenant boundary and key-configuration repair (draft)

This change is not a production deployment or a complete security audit.

Project ownership is now part of the child query/mutation for prompt PATCH/DELETE and eval-run, response, report and export reads. Progress execution checks the run's project and owner before invoking the evaluator. Step execution additionally checks the run before parsing its requested action, rejects prompt IDs outside that run's prompt set before fetching API keys, and never mutates a supplied run ID on authentication failure. Owner filters remain on status mutations and response queries. This does not establish atomic authorization throughout a long-running external AI call; deployment review must address concurrent ownership changes and background execution separately.

The legacy encryption import path re-exports the canonical AES-256-GCM implementation. Both paths require exactly 64 hexadecimal ENCRYPTION_KEY characters. Invalid or absent configuration raises an error on encryption/decryption; there is no public fixed-key fallback. Properly configured existing iv:tag:ciphertext records retain compatibility. The parser validates IV, tag and ciphertext hexadecimal encoding.

## Rollout gates

Do not deploy until the real database/Supabase integration has been tested with two separate synthetic users and owners. Current automated route tests use the actual TypeScript handler source with fake sessions and a relation-aware in-memory DB. They verify emitted predicates and control flow, not PostgreSQL RLS or a production server. Type checking is recorded separately from runtime tests.

Before rollout, determine whether any records were encrypted using the old public development key. Back up affected data with restricted access and use an explicit, separately reviewed migration/credential rotation procedure. Do not silently retry decryption with a known fallback key and do not rewrite customer data from this PR.

Investigate any historical cross-project ModelResponse/PromptItem associations and generated reports; scope filters do not erase previously exported or leaked data. No exploitation, leakage or absence of leakage has been established by these synthetic tests.

The reported unmasked judge-prompt egress remains a separate unresolved privacy item; this change does not claim to fix it. Provider integration, end-to-end evaluation, full application security and formal VAP conformity remain unestablished.

## Test provenance

Baseline source: 062d09ea1420e427769d5c7fe42c589e9d2d6369. The regression-only commit a517598c61ef892a7e2a379703567d9aeef77e87 produced 31 cases, 19 failures and 12 passes against unmodified application code. Some failures concern explicit error classification rather than distinct security vulnerabilities. Its initial workflow status incorrectly reflected tee's exit status, so the TAP output, not that green status, is the baseline evidence. The updated workflow uses explicit bash pipefail. Fixes and additional execution-boundary cases are recorded in subsequent CI runs.
