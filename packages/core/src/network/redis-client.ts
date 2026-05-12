/**
 * Redis Client — bounded retry posture for Dispatcher queues and diagnostics.
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

export type RedisFailSafeBinding = {
  url: string
  family?: 0 | 4 | 6
  tls: boolean
}

export function redisFailSafeRetryStrategy(times: number): number | null {
  const retryDelayMs = 250
  if (times * retryDelayMs >= 2_000) return null
  return retryDelayMs
}

export function parseRedisFailSafeBinding(raw: string): RedisFailSafeBinding {
  const trimmed = raw.trim()
  try {
    const url = new URL(trimmed)
    const familyRaw = url.searchParams.get('family')
    const family =
      familyRaw === '0' || familyRaw === '4' || familyRaw === '6'
        ? (Number(familyRaw) as 0 | 4 | 6)
        : undefined
    url.searchParams.delete('family')
    const normalized = url.toString()
    return {
      url: normalized,
      ...(family !== undefined ? { family } : {}),
      tls: url.protocol === 'rediss:',
    }
  } catch {
    return {
      url: trimmed,
      tls: trimmed.startsWith('rediss://'),
    }
  }
}

export function buildRedisFailSafeOptions(
  rawUrl: string,
  overrides: RedisFailSafeOptions = {},
): RedisFailSafeOptions {
  const binding = parseRedisFailSafeBinding(rawUrl)
  return {
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    retryStrategy: redisFailSafeRetryStrategy,
    family: 4,
    ...(binding.tls ? { tls: {} } : {}),
    ...overrides,
  }
}

export function createRedisFailSafeClient<T>(
  RedisCtor: RedisFailSafeConstructor<T>,
  rawUrl: string,
  overrides: RedisFailSafeOptions = {},
): T {
  const binding = parseRedisFailSafeBinding(rawUrl)
  return new RedisCtor(binding.url, buildRedisFailSafeOptions(rawUrl, overrides))
}
