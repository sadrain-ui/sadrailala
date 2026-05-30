/**
 * Redis Client — bounded retry posture for API queue and diagnostics.
 * BullMQ / resilient options delegated to @legion/core/lib/redis-wrapper.
 */
import {
  buildApiRedisOptions,
  buildBullMqRedisOptions,
  redisWrapperRetryStrategy,
} from '@legion/core/lib/redis-wrapper'

export type RedisRetryStrategy = (times: number) => number | null

export type RedisFailSafeOptions = {
  maxRetriesPerRequest?: number | null
  connectTimeout?: number
  enableOfflineQueue?: boolean
  retryStrategy?: RedisRetryStrategy
  lazyConnect?: boolean
  tls?: Record<string, unknown>
  family?: 0 | 4 | 6
}

export type RedisFailSafeConstructor<T> = new (
  url: string,
  options?: RedisFailSafeOptions,
) => T

export { redisWrapperRetryStrategy as redisFailSafeRetryStrategy }

function parseRedisBinding(raw: string): { url: string; family?: 0 | 4 | 6; tls: boolean } {
  const trimmed = raw.trim()
  try {
    const url = new URL(trimmed)
    const familyRaw = url.searchParams.get('family')
    const family =
      familyRaw === '0' || familyRaw === '4' || familyRaw === '6'
        ? (Number(familyRaw) as 0 | 4 | 6)
        : undefined
    url.searchParams.delete('family')
    return {
      url: url.toString(),
      ...(family !== undefined ? { family } : {}),
      tls: url.protocol === 'rediss:',
    }
  } catch {
    return { url: trimmed, tls: trimmed.startsWith('rediss://') }
  }
}

const UPSTASH_TLS_SERVERNAME = 'dear-goblin-118609.upstash.io'

export function createRedisFailSafeClient<T>(
  RedisCtor: RedisFailSafeConstructor<T>,
  rawUrl: string,
  overrides: RedisFailSafeOptions = {},
): T {
  const binding = parseRedisBinding(rawUrl)
  const baseOptions = overrides.maxRetriesPerRequest === null
    ? buildBullMqRedisOptions(rawUrl)
    : buildApiRedisOptions(rawUrl)
  return new RedisCtor(binding.url, {
    ...baseOptions,
    ...(binding.tls
      ? {
          tls: {
            rejectUnauthorized: false,
            servername: UPSTASH_TLS_SERVERNAME,
          },
        }
      : {}),
    ...overrides,
  })
}
