# Deployment Posture — Railway (`@legion/api`)

Manual for shipping the **legion-engine** monorepo API to Railway. Source of truth for boot env keys: `apps/api/src/inject-root-env.ts` and `apps/api/src/config/production-env-inventory.ts`.

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node** | `>=20` (Dockerfile uses `node:20-bookworm-slim`) |
| **pnpm** | `9.15.9` (enforced via Corepack in Dockerfile) |
| **Postgres** | Supabase direct/session URI or Railway PostgreSQL plugin |
| **Redis** | Upstash / Railway Redis — required for SIWE nonces, BullMQ, telemetry lanes |
| **Git** | Railway connected to this repository |

Local `.env` is **not** baked into the image (see `.dockerignore`). All production secrets are injected by Railway at runtime.

---

## 2. Railway — exact push sequence

### Step 1 — Create project and service

1. Open [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. Select the `legion-engine` repository.
3. Add a **single service** for the API (do not deploy Next.js apps from this Dockerfile unless you add separate services later).

### Step 2 — Builder and paths

| Setting | Value |
|---------|--------|
| **Builder** | Dockerfile |
| **Dockerfile path** | `Dockerfile` (repo root) |
| **Root directory** | `/` (monorepo root — required for `pnpm-workspace.yaml` and workspace packages) |
| **Start command** | *(leave empty — Dockerfile `CMD` runs `node dist/index.js` with `WORKDIR /app/apps/api`)* |
| **Config as code** | Repo root `railway.toml` sets `healthcheckPath = "/health"`, `healthcheckTimeout = 300` |

Railway injects **`PORT`** at runtime (dynamic, e.g. `8080`). The app binds **`0.0.0.0:$PORT`** immediately on boot (`apps/api/src/index.ts`). **Do not** set a fixed `PORT` in the Dockerfile or map “Target port” to `4000` in the dashboard — use Railway’s generated **`PORT`** variable only.

### Step 3 — Data plane plugins

1. **PostgreSQL** (Railway plugin) **or** external Supabase — copy the connection string into `DATABASE_URL`.
   - Prefer **direct** or **session** pooler URIs for migrations; transaction pooler (`:6543`) can fail Drizzle migrate operations.
2. **Redis** (Railway plugin) **or** Upstash — copy URL into `REDIS_URL`.

Reference variables from plugin **Variables** tab into the API service (e.g. `${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`).

### Step 4 — Production variables

Configure all **mandatory** keys in §3 before first deploy. Use Railway **Shared Variables** for values reused across services.

### Step 5 — Health check and networking

| Check | Configuration |
|-------|----------------|
| **Health endpoint** | `GET /health` → `200` with `{ "success": true, "data": { "status": "ok" } }` |
| **Health check path (dashboard)** | `/health` — must match `railway.toml` `healthcheckPath` |
| **Health check timeout** | `300` seconds (slow Postgres anchor runs *after* listen) |
| **Public networking** | Service → **Settings → Networking** → generate domain; **do not** hardcode target port `4000` |
| **Target port** | Leave default / use **`$PORT`** — Railway routes to the same port the process listens on |
| **Optional heartbeat** | `GET /health?ping=true` (fires `TELEMETRY_WEBHOOK_URL` if set) |
| **HTTPS** | Terminated at Railway edge; API binds HTTP on `0.0.0.0:$PORT` inside the container |

**If you see 502 on `/health` but logs show “Server listening”:** open **Settings → Networking** and remove any manual “Port” override (e.g. `4000`). Redeploy after `railway.toml` is picked up so health checks use `/health` with a 300s timeout.

### Step 6 — Deploy and verify

1. Push to the connected branch (or **Deploy** manually).
2. Watch build logs: `pnpm install --frozen-lockfile` → `pnpm --filter @legion/api build`.
3. On success, confirm runtime logs include:
   - `OMNI_ENV_LOCKED` / no `FATAL_ENV_VALIDATION`
   - `LANE_STATUS: API_LISTENING host=0.0.0.0 port=…`
4. Smoke test: `curl https://<your-railway-domain>/health`

### Step 7 — Frontend ingress (Vercel / elsewhere)

Point browser apps at the Railway API URL via `NEXT_PUBLIC_LEGION_ENGINE_API_URL` (or equivalent) on the **frontend** project. On the API service, set CORS allow-lists (§3) to those origins.

### Monorepo dev parity (local only)

From repo root:

```bash
pnpm dev
# equivalent: pnpm --filter @legion/api dev
# runs: tsx watch --env-file=../../.env src/index.ts
```

---

## 3. Mandatory production environment variables (`apps/api`)

Railway injects variables as process environment. Boot **fails fast** if required keys are missing (`inject-root-env.ts`, `server.ts`).

### Tier A — Boot blockers (required)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres — chains, anchor verification, Drizzle/pg pools |
| `REDIS_URL` | SIWE nonces, BullMQ extraction queue, telemetry/redis lanes |
| `JWT_SECRET` | Fastify JWT — session signing (min 32 chars; rotate in production) |

### Tier B — Production runtime (strongly required)

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | Set to `production` |
| `PORT` | Railway injects automatically; fallback `4000` in image |
| `API_CORS_ORIGINS` | Comma-separated browser origins allowed to call the API |
| `API_VECTOR_INGRESS_ORIGINS` | Optional merge list (e.g. Airdrop Hub preview hosts) |

Without Tier B CORS keys, `app.ts` falls back to **permissive** origin handling (all origins allowed). Acceptable for local dev; **lock down in production** with explicit origins.

### Tier C — Full operational plane (required for auth + signature routes)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side vault / anchor persistence |
| `SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth routes that verify anon client |
| `SHADOW_VAULT_KEY` **or** `GATEKEEPER_SECRET` | Signature Anchor encryption / gatekeeper plane |
| `KINETIC_INTERNAL_KEY` | Protects `/kinetic-internal` routes |

### Tier D — Recommended for strike / observability

| Variable | Purpose |
|----------|---------|
| `TELEMETRY_WEBHOOK_URL` | Heartbeat + ping-strike webhooks |
| `EVM_ALCHEMY_KEY` | L2 RPC derivation when chain-specific `RPC_*_PRIVATE` unset |
| `RPC_ETHEREUM_PRIVATE` or `NEXT_PUBLIC_RPC_URL` | EVM JSON-RPC lane |
| `RPC_SOLANA_PRIVATE` or `SOLANA_RPC_URL` | Solana lane |
| `LOG_LEVEL` | Default `info` when `NODE_ENV=production` |
| `API_REQUEST_TIMEOUT_MS` | Socket idle budget (default `180000`) |
| `PROD` | Set `1` in production (signature-anchor drift behavior) |

### Tier E — Optional / feature-specific

See root `.env.example` for RPC mesh, TRON/TON lanes, payout config, proxy mesh, and indexer keys. Routes degrade gracefully when unset unless explicitly invoked.

### Tier F — Production hardening (Phase 2)

All default-off; enable in Railway with the values shown.

| Variable | Default | Purpose |
|----------|---------|---------|
| `NON_EVM_SERVER_SIGNING` | `false` | Build + broadcast non-EVM txs server-side (no user signature required) |
| `SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY` | — | Base58 64-byte Solana execution keypair |
| `TRON_EXECUTION_PRIVATE_KEY` | — | TRON private key (hex, no 0x) |
| `TON_EXECUTION_MNEMONIC` | — | Space-separated 24-word TON mnemonic |
| `BITCOIN_EXECUTION_WIF` | — | WIF-encoded Bitcoin execution key |
| `PRIVACY_MIXER_ALL_CHAINS` | `false` | Run omnichain mixer for SOL/TRX/TON/BTC → XMR |
| `PRIVACY_MIXER_XMR_DESTINATION` | — | **Required** when mixer enabled — Monero receive address |
| `PRIVACY_MIXER_TON_USDT_MASTER` | — | TON jetton master address for Dedust TON→stable swap |
| `DEDUST_TON_VAULT_ADDRESS` | built-in | Override Dedust v2 VaultNative contract address |
| `THORCHAIN_NODE_URL` | ninerealms | Thorchain API base (override for private node) |
| `SWEEP_CREATE_ATA` | `true` | Auto-create missing Solana ATAs on sweep |
| `SWEEP_TON_JETTON_MASTERS` | — | Comma-separated TON jetton master addresses to sweep |
| `SWEEP_TRC20_CONTRACTS` | USDT | Comma-separated TRC-20 contract addresses to sweep |
| `SENTINEL_RUNTIME_ENABLED` | `false` | Enable periodic RPC/Redis/queue/gas health checks |
| `SENTINEL_RUNTIME_INTERVAL_MS` | `300000` | Cron interval in ms (min 60000) |
| `GAS_VAULT_MIN_NATIVE` | `0.01` | Per-chain native balance alert threshold |
| `BULLMQ_DLQ_ENABLED` | `true` | Record final-failure BullMQ jobs in Redis DLQ (7-day TTL) |

**Do not** commit `.env` to git. **Do not** rely on `inject-root-env` finding a file in the container — there is no `.env` in the image.

---

## 4. Dockerfile posture audit

**Current state:** the repo `Dockerfile` is a **two-stage** image (`builder` → `runner`).

```dockerfile
# builder: pnpm install + pnpm --filter @legion/api build + pnpm --filter @legion/api --prod deploy /deploy
# runner:  COPY --from=builder /deploy/ → WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
```

### What is correct today

| Control | Status |
|---------|--------|
| **Runtime entry** | `node dist/index.js` — no `tsx` / watch in production |
| **`.dockerignore`** | Excludes `.env`, `.env.*`, `node_modules`, `dist`, tests tooling paths |
| **Build scope** | `@legion/api` build pulls `@legion/core` + `@legion/sentinels` via workspace filter |
| **Listen binding** | `0.0.0.0` + `PORT` — Railway-compatible |

### DevDependency leakage — hardened (Phase 74.1)

The **builder** stage still runs `pnpm install --frozen-lockfile` (full dev graph required to compile). The **runner** stage copies only the output of:

```bash
pnpm --filter @legion/api --prod deploy /deploy
```

That command installs **production** dependencies into an isolated `/deploy/node_modules` and copies the deployed package artifacts. Workspace `src/**/*.ts` trees are stripped from `/deploy` before the runner stage. Dev tools (`tsx`, `vitest`, root `eslint`, etc.) never appear in the final image layer.

**Note:** `@legion/core` lists `typescript` under `dependencies` (not `devDependencies`), so it may still appear in the production `node_modules` graph until that package manifest is tightened separately.

---

## 5. Post-deploy checklist

- [ ] `GET /health` returns `200` on public Railway URL
- [ ] Logs show no `FATAL_ENV_VALIDATION` or `DATABASE_ANCHOR_FAILURE`
- [ ] `API_CORS_ORIGINS` includes Vercel production + preview URLs
- [ ] `DATABASE_URL` and `REDIS_URL` point at managed plugins (not localhost)
- [ ] `JWT_SECRET` and `SHADOW_VAULT_KEY` / `GATEKEEPER_SECRET` are unique production values
- [ ] Frontend `NEXT_PUBLIC_LEGION_ENGINE_API_URL` matches Railway domain

### Phase 2 hardening checklist

- [ ] Logs show no `BOOT] VAULT_EXECUTOR_MISMATCH` (or mismatch is intentional)
- [ ] `NON_EVM_SERVER_SIGNING=true` — test one settlement per chain without user payload
- [ ] `PRIVACY_MIXER_XMR_DESTINATION` is a valid Monero address when mixer enabled
- [ ] `SENTINEL_RUNTIME_ENABLED=true` — check Telegram receives alerts on RPC test failure
- [ ] `/failed` Telegram command returns "No dead-letter jobs" after clean run
- [ ] `asset_scans` Supabase table created via `scripts/migrations/001_asset_scans.sql`
- [ ] `BULLMQ_DLQ_ENABLED=true` — verify DLQ entries appear after intentional job failure

---

## Telemetry

**POSTURE_REPORT_GENERATED: The manual for cloud deployment is locked.**
