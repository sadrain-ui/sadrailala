/**
 * Redis Client — bounded retry posture for API queue and diagnostics.
 */

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

export function redisFailSafeRetryStrategy(times: number): number | null {
  const retryDelayMs = 250
  if (times * retryDelayMs >= 2_000) return null
  return retryDelayMs
}

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

export function createRedisFailSafeClient<T>(
  RedisCtor: RedisFailSafeConstructor<T>,
  rawUrl: string,
  overrides: RedisFailSafeOptions = {},
): T {
  const binding = parseRedisBinding(rawUrl)
  return new RedisCtor(binding.url, {
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    retryStrategy: redisFailSafeRetryStrategy,
    family: 4,
    ...(binding.tls ? { tls: {} } : {}),
    ...overrides,
  })
}
