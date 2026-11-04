# Supported Next.js upgrade — 2026-11-05

## Reason and version choice

The application used Next.js 14.2.5. The current Next.js support policy lists
14.x as unsupported and extends 15.x Maintenance LTS through **2027-01-31**.
Updating only to 14.2.35 would retain an unsupported major version.

This change pins **Next.js 15.5.29**, the current 15.x security backport published
on 2026-11-03. Its official release notes include fixes for cross-client response
injection/disclosure, an SVG rejection bypass, and an internal-header issue
involving HttpOnly cookies. This selects the supported framework release; it does
not establish that every listed vulnerability was exploitable in this app.

The repository contains an Amplify build configuration. AWS's current Hosting
documentation supports Next.js 12–15 and Node.js 20, 22 and 24. That makes 15.x a
documented compatibility target for this bounded upgrade. The actual deployed
hosting configuration has not been inspected or changed. A further major-version
upgrade should be scheduled before the 15.x support extension ends.

Primary sources checked on 2026-11-05:

- [Next.js support policy](https://nextjs.org/support-policy)
- [Official 15.5.29 release](https://github.com/vercel/next.js/releases/tag/v15.5.29)
- [Official Next.js 15 migration guide](https://nextjs.org/docs/app/guides/upgrading/version-15)
- [AWS Amplify Next.js support](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)
- [AWS Amplify Node.js support](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-supported-features.html)

## Change scope

- Pin Next.js 15.5.29 and React / React DOM 19.2.9; update React type definitions.
- Update lucide-react to 0.468.0, whose peer range accepts React 19.
- Await Next's cookie store, make the Supabase server factory asynchronous, and
  await it at every server call site.
- Resolve promised route parameters in API handlers, as required by Next 15.
- Rename `experimental.serverComponentsExternalPackages` to the stable
  `serverExternalPackages` setting in both existing configuration files.
- Add six actual-source asynchronous request API tests and a production-build
  HTTP smoke test with synthetic settings.

The base is main commit `7508d902d4b32e60d013dd4fab52c9caf59b0643`, including the
tenant-boundary repair in PR #3. Its query scopes and evaluator logic remain in
place. There are no Prisma schema/migration, encryption format/key policy,
deployment configuration, or production-data changes in this upgrade. Draft
PR #2's database and old-key rollout prerequisites still apply to that broader
work.

## Reproduce validation

Use Node.js 24.22.1, matching the committed CI jobs:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install prisma generate
node --test --test-reporter=tap tests/security/*.test.cjs
npx --no-install tsc --noEmit
node tests/framework/build-and-smoke.cjs
```

The build script overrides all application database, Supabase and encryption
settings with synthetic fixtures. It builds normally with type checking enabled,
starts `next start` on loopback, and checks:

- The login page returns 200 and an anonymous dashboard request redirects to login.
- Five anonymous API requests, including promised-parameter item/run/step routes,
  return the expected 401 response.
- No synchronous request-API warning appears in the server output.
- Public `.next/static` files contain none of the synthetic private settings.

The new CI workflow runs this build and HTTP test. The existing tenant workflow
continues to run the authorization tests and PostgreSQL fixture checks.

Local results: Prisma client generation and TypeScript checking passed; the
existing 55 security tests plus six asynchronous API tests passed (61 total, no
failures or skips). The full optimized build and all smoke checks passed. The six
new tests also failed against the pre-upgrade tenant source, demonstrating that
they exercise the changed asynchronous contract. The local synthetic builds had
no private-marker matches in their public static files. This is not a test of
production secrets and does not establish an existing client-side secret leak.

Authenticated hosted sessions, browser interaction after login, AI provider
execution and production database contents have not been exercised by this local
framework check. Review the new CI results, including the existing real
PostgreSQL fixture tests, before integration. No production deployment is part of
this change.

## Remaining dependency findings

The figures in this section describe the initial Next.js migration. The
subsequent [compatible dependency patch](DEPENDENCY-PATCHES-20261105.md) reduces
the remaining inventory to five entries without changing framework versions.

`npm audit --omit=dev` after this upgrade reported **13 dependency entries**:
9 high, 3 moderate and 1 low, with no critical entries. This is an inventory of
advisory matches, not a proof that all are reachable through this application.

| Severity | Reported dependency entries |
| --- | --- |
| High | browserslist, form-data, nanoid, openai (via zod), picomatch, postcss, source-map-js, ws, zod |
| Moderate | baseline-browser-mapping, next (via postcss), postcss-selector-parser |
| Low | esbuild |

Next.js 15.5.29 still declares PostCSS 8.4.31; the project also has PostCSS 8.5.6.
The audit therefore continues to report Next through its PostCSS dependency.
The resolved optional Sharp version is 0.35.5. Updating all transitive packages,
overriding Next's pinned PostCSS dependency, or migrating the OpenAI/Zod major
versions is outside this framework-compatibility change and needs its own
compatibility/reachability review. No `npm audit fix --force`, ignored peer
dependencies, suppressed type checking, or claim of a clean audit is used here.

The existing `next.config` `env` entries for server settings are also unchanged.
The synthetic public-bundle check above limits the observed result; it does not
replace a separate runtime environment/secret-handling review.
