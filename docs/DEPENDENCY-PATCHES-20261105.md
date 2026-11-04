# Compatible dependency patches — 2026-11-05

This follows the Next.js 15 migration. It updates selected package-lock entries
within the dependency ranges already declared by the project and its packages.
There are no changes to `package.json`, application code, framework versions,
schema, encryption, deployment settings, dependency overrides, or test behavior.

## Selected updates

| Dependency | Previous | Updated | Existing parent range / source |
| --- | --- | --- | --- |
| baseline-browser-mapping | 2.10.0 | 2.11.35 | Browserslist `^2.9.0` |
| browserslist | 4.28.1 | 4.29.5 | Autoprefixer `^4.28.1` |
| form-data | 4.0.5 | 4.0.6 | `@types/node-fetch` `^4.0.4` |
| nanoid | 3.3.11 | 3.3.20 | PostCSS `^3.3.6` / `^3.3.11` |
| picomatch | 2.3.1 | 2.3.2 | Existing 2.x parent ranges |
| picomatch (tinyglobby) | 4.0.3 | 4.0.7 | tinyglobby `^4.0.3` |
| postcss (project / Tailwind) | 8.5.6 | 8.5.32 | Project `^8.4.41`, Tailwind `^8.4.47` |
| postcss-selector-parser | 6.1.2 | 6.1.5 | Existing `^6.1.1` / `^6.1.2` ranges |
| source-map-js | 1.2.1 | 1.2.2 | Existing `^1.0.2` / `^1.2.1` ranges |
| ws | 8.19.0 | 8.22.1 | Supabase Realtime `^8.18.2`, OpenAI optional peer `^8.18.0` |

The selected updates also refresh their compatible `caniuse-lite`,
`electron-to-chromium`, `node-releases`, `update-browserslist-db`, and `hasown`
entries. In total, 15 existing lock entries change versions; no package is added
or removed. Next.js stays at 15.5.29 and React / React DOM stay at 19.2.9.

The scoped update command was:

```sh
npm update --package-lock-only --ignore-scripts --no-audit --no-fund baseline-browser-mapping browserslist form-data nanoid picomatch postcss postcss-selector-parser source-map-js ws
```

## Audit result and remaining work

At the time of this update, `npm audit --omit=dev` changed from **13 reported
dependency entries (9 high, 3 moderate, 1 low)** to **5 entries (3 high,
1 moderate, 1 low)**. Neither result contains a critical entry. These are
package/advisory matches, not five independently demonstrated application
exploits.

| Remaining entries | Reason a range-preserving update does not remove them | Observed use and next action |
| --- | --- | --- |
| `postcss` high; `next` moderate through PostCSS | Next.js 15.5.29 pins its own PostCSS to exactly 8.4.31. Updating the project's separate PostCSS cannot replace that copy. | CSS/build tooling is present, but no application route accepting and processing user CSS was found. A future supported Next release or a separately reviewed targeted PostCSS override is needed; this patch does not override Next's exact dependency. |
| `zod` high; `openai` high through its optional Zod peer | The project declares Zod `^3.23.8`, and OpenAI 4.104.0 declares the same optional peer range. The advisory's patched version is 4.6.6, outside those ranges. | No Zod import was found in `src`, `prisma`, or the committed tests. The app's OpenAI calls use `chat.completions.create` and `models.list`, not Zod schema parsing. Confirm whether the direct Zod dependency is needed before choosing removal or a separately tested Zod / SDK migration. No conclusion of runtime immunity is made. |
| `esbuild` low | tsx 4.21.0 requires `~0.27.0`; the patched esbuild version is 0.28.1. | The advisory concerns esbuild's development server on Windows. This repo uses tsx for the Prisma seed command and does not define an esbuild serving command. A tsx minor update within the project's `^4.21.0` range is possible (current 4.23.15 uses esbuild `~0.28.0`), but it also changes the TypeScript execution toolchain and its platform binaries; it is kept separate from these high-priority lock patches. |

The static source/manifest checks above are limited to this checkout. No
deployment access, production-data inspection, exploit requests, or live API
provider calls were used. Most removed CSS/glob/browser-target findings arise
through build tools; `ws` is also present through Supabase Realtime and OpenAI's
optional peer. The package inventory alone does not show which paths are exposed
in a deployed environment.

Relevant advisory records and upstream reports:

- [Zod oversized-collection validation](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [PostCSS source-map loading](https://github.com/postcss/postcss/security/advisories/GHSA-r28c-9q8g-f849)
- [PostCSS incomplete source-map fix](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp)
- [esbuild Windows development server](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr)

## Validation

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ls --omit=dev --all
npx --no-install prisma generate
node --test --test-reporter=tap tests/security/*.test.cjs
node tests/framework/build-and-smoke.cjs
```

Local clean installation, dependency-tree validation, Prisma generation,
production compilation/type checking, and the complete HTTP smoke test passed.
All 61 security tests passed without failures or skips. The fresh production
build's 66 public static files contained no synthetic private-setting markers;
login returned 200, the anonymous dashboard redirected to login, and all five
anonymous API checks returned 401. This check does not exercise a hosted
authenticated session or a real provider account.

The existing authorization and framework workflows should run on this lockfile
before integration, including their disposable PostgreSQL fixture. No
`npm audit fix --force`, ignored peer dependencies, or test suppression is used.
