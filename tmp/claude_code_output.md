# Railway Deployment Fix — Summary

## Root causes addressed

1. **Build:** `tiny-secp256k1` / `bigint-buffer` need `python3`, `make`, `g++` in the Docker **builder** stage.
2. **Runtime crash after `CORS_ALLOW_LIST_ACTIVE`:**
   - Hardcoded Upstash TLS `servername` in `redis-client.ts` broke Railway/Upstash Redis TLS handshakes.
   - SIWE boot `redis.ping()` could hang or throw and abort startup before `listen`.
   - Production DB anchor `process.exit(1)` killed the container before `/health` when Postgres was slow/unreachable.
   - `app.listen().catch()` swallowed errors and could log success incorrectly.

## Files changed

| File | Change |
|------|--------|
| `Dockerfile` | Install `python3`, `make`, `g++` before `pnpm install` |
| `apps/api/src/lib/redis-client.ts` | Derive TLS `servername` from `rediss://` URL hostname (remove hardcoded Upstash host) |
| `apps/api/src/lib/env-loader.ts` | Accept `GATEKEEPER_SECRET` **or** `SHADOW_VAULT_KEY` in production |
| `apps/api/src/app.ts` | Honor `API_CORS_ALLOW_ALL=1` in production |
| `apps/api/src/lib/database-anchor.ts` | Boot DB check logs only — no `process.exit(1)` |
| `apps/api/src/controllers/auth.controller.ts` | SIWE Redis ping: 8s timeout, non-fatal on failure |
| `apps/api/src/index.ts` | Phase `[BOOT]` logs, `0.0.0.0` listen, `start().catch()` with stack traces |
| `apps/api/src/server.ts` | `[BOOT]` log between each route registration |

## Expected Railway logs (success)

```
[BOOT] Index loaded
[BOOT] Verifying database anchor…
POSTGRES_ANCHOR_LOCKED: … (or DATABASE_ANCHOR_FAILURE if degraded)
[BOOT] Building API server…
CORS_ALLOW_LIST_ACTIVE / CORS_ALLOW_ALL_ACTIVE
[BOOT] Registering SIWE auth routes
[BOOT] SIWE Redis ping: PONG
[BOOT] All routes registered
[BOOT] Binding 0.0.0.0:<PORT>
[BOOT] Server listening on port <PORT>
LANE_STATUS: API_LISTENING host=0.0.0.0 port=<PORT>
```

## Required Railway env (minimum)

- `NODE_ENV=production`
- `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`
- `SHADOW_VAULT_KEY` or `GATEKEEPER_SECRET`
- `SETTLEMENT_EXECUTION_PRIVATE_KEY` (48–64 hex)
- `API_CORS_ORIGINS` (comma-separated) **or** `API_CORS_ALLOW_ALL=1`
- `PORT` — injected by Railway automatically

## Verify after deploy

```bash
curl -s https://<railway-domain>/health
```

Expect HTTP 200 with `"status":"ok"`.
