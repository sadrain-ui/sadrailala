/**
 * Heartbeat Trigger — `/health?ping=true` POSTs to `TELEMETRY_WEBHOOK_URL` for Sovereign Audit.
 * `/health/ready` verifies Postgres + Redis before routing traffic.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { resolveEffectiveRedisUrl } from '@legion/core/lib/redis-wrapper'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import {
  executePostgresAnchorQuery,
  normalizeDatabaseConnectionString,
} from '../lib/database-anchor.js'
import { createRedisFailSafeClient, type RedisFailSafeConstructor } from '../lib/redis-client.js'
import { healthQuerySchema, parseQuery } from '../lib/schemas.js'
import { buildFullProductionReadiness } from '@legion/core'
import { sendHeartbeatTrigger } from '../telemetry-sender.js'
import { getTelegramBotStatus } from '../telegram-bot.js'

type IoRedisInstance = {
  connect(): Promise<void>
  ping(): Promise<string>
  disconnect(): void
}

async function probeRedisReady(): Promise<{ ok: boolean; detail: string }> {
  const url = resolveEffectiveRedisUrl()
  if (!url) {
    return { ok: false, detail: 'REDIS_URL unset' }
  }
  try {
    const mod = await import('ioredis')
    const RedisCtor = mod.default as unknown as new (
      raw: string,
      opts?: { maxRetriesPerRequest?: number; connectTimeout?: number; lazyConnect?: boolean },
    ) => IoRedisInstance
    const client = createRedisFailSafeClient(
      RedisCtor as RedisFailSafeConstructor<IoRedisInstance>,
      url,
      { maxRetriesPerRequest: 2, lazyConnect: true },
    )
    try {
      await client.connect().catch(() => null)
      const pong = await client.ping()
      return pong === 'PONG'
        ? { ok: true, detail: 'PING PONG' }
        : { ok: false, detail: `unexpected ping response: ${pong}` }
    } finally {
      client.disconnect()
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

async function probePostgresReady(): Promise<{ ok: boolean; detail: string }> {
  const raw = process.env['DATABASE_URL']?.trim()
  if (!raw) {
    return { ok: false, detail: 'DATABASE_URL unset' }
  }
  const result = await executePostgresAnchorQuery(normalizeDatabaseConnectionString(raw))
  if (result.ok) {
    return { ok: true, detail: 'SELECT 1 ok' }
  }
  const detail =
    result.error instanceof Error
      ? result.error.message
      : 'SELECT 1 did not return expected row'
  return { ok: false, detail }
}

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = parseQuery(healthQuerySchema, request.query)
    if (q.ok === false) {
      return sendFailure(reply, 400, q.message, { code: 'ValidationError' })
    }

    if (q.data.ping === 'true') {
      await sendHeartbeatTrigger()
    }

    return sendSuccess(reply, 200, 'Service healthy', {
      status: 'ok',
      service: 'legion-engine-api',
      timestamp: new Date().toISOString(),
      ...(q.data.ping === 'true' ? { heartbeat_trigger: true as const } : {}),
    })
  })

  app.get('/health/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    const [postgres, redis] = await Promise.all([probePostgresReady(), probeRedisReady()])
    const ready = postgres.ok && redis.ok

    if (!ready) {
      return sendFailure(reply, 503, 'Service not ready', {
        code: 'NotReady',
        postgres: { ok: postgres.ok, detail: postgres.detail },
        redis: { ok: redis.ok, detail: redis.detail },
        timestamp: new Date().toISOString(),
      })
    }

    return sendSuccess(reply, 200, 'Service ready', {
      status: 'ready',
      service: 'legion-engine-api',
      postgres: { ok: true, detail: postgres.detail },
      redis: { ok: true, detail: redis.detail },
      timestamp: new Date().toISOString(),
    })
  })

  app.get('/health/production', async (_request: FastifyRequest, reply: FastifyReply) => {
    const report = await buildFullProductionReadiness()
    const summary = Object.fromEntries(
      report.tiers.map((t) => [
        t.tier,
        { grade: t.grade, score: t.score, max_score: t.max_score, blockers: t.blockers },
      ]),
    )
    return sendSuccess(reply, 200, 'Production readiness report', {
      generated_at: report.generated_at,
      summary,
      tiers: report.tiers,
    })
  })

  app.get('/telegram-status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = getTelegramBotStatus()
    const httpStatus = status.configured && status.lastError ? 503 : 200
    return sendSuccess(reply, httpStatus, 'Telegram bot status', {
      ...status,
      hint: status.skipReason
        ? status.skipReason
        : status.lastError
          ? '409 usually means Railway and local both poll TELEGRAM_BOT_TOKEN — close the local API terminal or set TELEGRAM_BOT_SKIP_LOCAL=true'
          : status.running
            ? 'Bot polling active'
            : 'Bot not running',
      timestamp: new Date().toISOString(),
    })
  })
}
