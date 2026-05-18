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
| **Start command** | *(leave empty — image `CMD` is `node dist/index.js` in `apps/api`)* |

Railway sets `PORT` automatically. The image defaults `PORT=4000` and `EXPOSE 4000`; Railway’s injected `PORT` takes precedence at runtime (`apps/api/src/index.ts` listens on `0.0.0.0`).

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
| **Health endpoint** | `GET /health` → `200` with `{ "status": "ok", "service": "legion-engine-api" }` |
| **Optional heartbeat** | `GET /health?ping=true` (fires `TELEMETRY_WEBHOOK_URL` if set) |
| **Public domain** | Generate Railway domain or attach custom domain |
| **HTTPS** | Terminated at Railway edge; API binds HTTP on `PORT` inside the container |

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

---

## Telemetry

**POSTURE_REPORT_GENERATED: The manual for cloud deployment is locked.**
