# infra/scripts

This folder contains operational scripts for Legion Engine infrastructure.

## Scripts (to be added)

- `db-migrate.ts` — Run Drizzle ORM migrations against Postgres
- `db-seed.ts` — Seed initial data (RPC endpoints, admin policies)
- `db-reset.ts` — Drop and recreate the database (dev only)
- `health-check.ts` — Probe all RPC endpoints and report latency
- `proxy-test.ts` — Test residential proxy mesh connectivity
- `redis-flush.ts` — Flush Redis in-flight state (emergency use only)

## Usage

```bash
pnpm tsx infra/scripts/<script>.ts
```
