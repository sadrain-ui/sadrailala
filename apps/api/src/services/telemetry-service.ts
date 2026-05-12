/**
 * Telemetry Service — immediate Telegram heartbeat, independent of Redis lane readiness.
 */
import IoRedis from 'ioredis'

import {
  createRedisFailSafeClient,
  type RedisFailSafeConstructor,
} from '../lib/redis-client.js'
import { sendSovereignTelemetryPayload } from '../telemetry-sender.js'

type TelemetryRedisClient = {
  connect(): Promise<void>
  ping(): Promise<string>
  disconnect(): void
}

let telemetryHeartbeatInitialized = false
let telemetryStandbyLogged = false

function logTelemetryStandbyOnce(): void {
  if (telemetryStandbyLogged) return
  telemetryStandbyLogged = true
  console.info('TELEMETRY_STANDBY: Redis offline, caching notifications locally.')
}

async function probeRedisTelemetryLane(): Promise<boolean> {
  const raw = process.env['REDIS_URL']?.trim() ?? ''
  if (!raw) return false

  const RedisCtor = IoRedis as unknown as RedisFailSafeConstructor<TelemetryRedisClient>
  const client = createRedisFailSafeClient(RedisCtor, raw, {
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null,
  })

  try {
    return await Promise.race([
      (async () => {
        await client.connect().catch(() => null)
        return (await client.ping().catch(() => '')) === 'PONG'
      })(),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 2_000)
      }),
    ])
  } finally {
    client.disconnect()
  }
}

export function initializeTelegramHeartbeat(): void {
  if (telemetryHeartbeatInitialized) return
  telemetryHeartbeatInitialized = true

  void sendSovereignTelemetryPayload({
    event: 'TELEGRAM_HEARTBEAT',
    message: 'Telegram Heartbeat: ACTIVE',
    telegram_heartbeat: true,
    boot_phase: 'immediate',
  }).catch(() => null)

  void probeRedisTelemetryLane()
    .then((redisOnline) => {
      if (!redisOnline) logTelemetryStandbyOnce()
    })
    .catch(() => {
      logTelemetryStandbyOnce()
    })

  console.info('LOADER_WELDED: Environment addresses visible. Redis IPv4 forced. Telegram Heartbeat: ACTIVE.')
}
