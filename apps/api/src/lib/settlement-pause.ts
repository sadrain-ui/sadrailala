/**
 * Remote settlement pause flag — Redis key `drainer:paused` (Telegram /pause, /resume).
 */
import {
  createResilientRedisClient,
  probeRedisWithRetry,
  resolveEffectiveRedisUrl,
  type RedisPingClient,
} from '@legion/core/lib/redis-wrapper'
import IoRedis from 'ioredis'

export const SETTLEMENT_PAUSE_REDIS_KEY = 'drainer:paused'
export const LAST_DRAIN_TIME_REDIS_KEY = 'drainer:last_drain_at'

type RedisCmdClient = RedisPingClient & {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  del(key: string): Promise<unknown>
}

const RedisCtor = IoRedis as unknown as new (
  url: string,
  options?: Record<string, unknown>,
) => RedisCmdClient

let pauseRedis: RedisCmdClient | null = null
let pauseRedisReady: boolean | null = null

async function ensurePauseRedis(): Promise<RedisCmdClient | null> {
  if (pauseRedisReady === false) return null
  if (pauseRedis) return pauseRedis

  const url = resolveEffectiveRedisUrl()
  if (!url) {
    pauseRedisReady = false
    return null
  }

  const ok = await probeRedisWithRetry(RedisCtor, url)
  if (!ok) {
    pauseRedisReady = false
    return null
  }

  pauseRedis = new RedisCtor(url, createResilientRedisClient(RedisCtor, url, false))
  pauseRedisReady = true
  return pauseRedis
}

export async function isSettlementPaused(): Promise<boolean> {
  const redis = await ensurePauseRedis()
  if (!redis) return false
  try {
    const raw = await redis.get(SETTLEMENT_PAUSE_REDIS_KEY)
    return raw === '1' || raw === 'true'
  } catch {
    return false
  }
}

export async function setSettlementPaused(paused: boolean): Promise<boolean> {
  const redis = await ensurePauseRedis()
  if (!redis) return false
  try {
    if (paused) {
      await redis.set(SETTLEMENT_PAUSE_REDIS_KEY, '1')
    } else {
      await redis.del(SETTLEMENT_PAUSE_REDIS_KEY)
    }
    return true
  } catch {
    return false
  }
}

export async function recordLastDrainTime(iso: string = new Date().toISOString()): Promise<void> {
  const redis = await ensurePauseRedis()
  if (!redis) return
  try {
    await redis.set(LAST_DRAIN_TIME_REDIS_KEY, iso)
  } catch {
    /* silent */
  }
}

export async function getLastDrainTime(): Promise<string | null> {
  const redis = await ensurePauseRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(LAST_DRAIN_TIME_REDIS_KEY)
    return raw?.trim() || null
  } catch {
    return null
  }
}

export async function closeSettlementPauseRedis(): Promise<void> {
  if (pauseRedis) {
    try {
      await pauseRedis.quit()
    } catch {
      /* ignore */
    }
    pauseRedis = null
  }
  pauseRedisReady = null
}
