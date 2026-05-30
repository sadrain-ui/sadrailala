# Local Redis Setup (Development)

Use this guide when your production Upstash quota is exhausted or you want offline queue testing.

## Quick start

```bash
# 1. Start local Redis (port 6379, AOF-persisted volume)
docker compose up -d redis

# 2. Verify Redis is healthy
docker compose ps redis
docker exec legion_redis redis-cli ping
# → PONG

# 3. Ensure development env overlay is active
#    `.env.development` sets REDIS_URL=redis://localhost:6379
#    It loads automatically in non-production after root `.env`.

# 4. Start the API
cd apps/api
pnpm run build
node --env-file=../../.env --env-file=../../.env.development dist/index.js
```

## Environment files

| File | Purpose |
|------|---------|
| `.env` | Secrets and shared config (never commit) |
| `.env.development` | Local infra overrides — **overrides** `.env` for `REDIS_URL` in dev |

To force in-memory queue fallback (no Redis at all):

```env
REDIS_MEMORY_FALLBACK=true
```

## Docker Compose services

`docker-compose.yml` in the repo root includes:

| Service | Port | Volume | Healthcheck |
|---------|------|--------|-------------|
| `redis` | 6379 | `redis_data` | `redis-cli ping` |
| `postgres` | 5432 | `postgres_data` | `pg_isready` |

Redis-only:

```bash
docker compose up -d redis
```

Full local stack:

```bash
docker compose up -d
```

Stop and wipe data:

```bash
docker compose down -v
```

## Graceful degradation

When Redis is unavailable the API **does not crash**:

1. `@legion/core/lib/redis-wrapper` probes Redis with exponential backoff (max 3 retries).
2. BullMQ worker is **not** started if the probe fails.
3. Enqueue operations fall back to an **in-memory queue** with `REDIS_MEMORY_ENQUEUE` warnings.
4. Signature persistence and HTTP routes continue to work.

Switch back to Upstash after quota reset by removing or commenting out `REDIS_URL` in `.env.development`, or set:

```env
REDIS_URL=rediss://default:YOUR_TOKEN@YOUR_HOST.upstash.io:6379
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED 127.0.0.1:6379` | Run `docker compose up -d redis` |
| Upstash `max requests limit exceeded` | Use `.env.development` local URL |
| BullMQ spam in logs | Stop old API process; restart with local Redis |
| Jobs not processing | Call `POST /api/jobs/extraction` or trigger signature-anchor; worker needs Redis connected |

## Production note

This setup is for **development and testing only**. Production should continue using Upstash (or another managed Redis) with TLS (`rediss://`).
