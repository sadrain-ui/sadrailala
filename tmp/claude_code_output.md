# PHASE 76.13 — DIRECT DOCKERFILE UPDATE

## Changes (`Dockerfile` builder stage)

1. **`COPY scripts ./scripts`** — inserted immediately after `COPY apps ./apps` so `flatten-api-dist.mjs` resolves during `@legion/api` build.
2. **`RUN pnpm --filter @legion/api... build`** — builds API plus workspace dependency graph (`@legion/core`, `@legion/sentinels`).
3. **Runner stage** — unchanged; copies isolated `/deploy` bundle only, `CMD ["node", "dist/index.js"]`.

## Telemetry

**PATCH_APPLIED: Dockerfile structural context updated.**
