# PHASE 75.0 — PRODUCTION PRE-FLIGHT VERIFICATION

## 1. Monorepo compile (`npx pnpm build`)

**PASSED** (exit 0, ~13 min). Full pipeline:

- `@legion/core` — `tsc` OK
- `@legion/sentinels` — `tsc` OK
- All `packages/*` and `apps/*` workspace builds OK (Next.js apps included)

## 2. `apps/api/dist/index.js`

**Initial finding:** `tsc` emitted to `dist/apps/api/src/index.js`, not Docker’s `dist/index.js`.

**Remediation:**

- Added `scripts/flatten-api-dist.mjs` — normalizes nested emit to canonical `apps/api/dist/index.js`
- Wired into `@legion/api` build: `… && tsc && node ../../scripts/flatten-api-dist.mjs`
- Added `@legion/core/scout/asset-scanner` to `packages/core/package.json` `exports` (runtime resolution)

**Verified:** `Test-Path apps/api/dist/index.js` → `True` after build.

## 3. `.gitignore` shield

**PASSED** — `git check-ignore`:

| Path | Rule |
|------|------|
| `.env` | `.env*` |
| `node_modules` | `node_modules/` |
| `logs/test.log` | `logs/` |
| `tmp/foo.log` | `*.log` |

Hardened with explicit `.env`, `.env.*`, and `tmp/**/*.log` entries. No `.env` / `node_modules` tracked in git index.

## Telemetry

**PRE_FLIGHT_PASSED: The engine is ready to break terminal bounds and ascend to cloud infrastructure.**
