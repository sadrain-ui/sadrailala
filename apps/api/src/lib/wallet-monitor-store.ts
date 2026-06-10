/**
 * Monitored high-value wallets — Redis set with in-memory fallback.
 */
import {
  createResilientRedisClient,
  probeRedisWithRetry,
  resolveEffectiveRedisUrl,
  type RedisPingClient,
} from '@legion/core/lib/redis-wrapper'
import IoRedis from 'ioredis'

const MONITORED_KEY = 'legion:monitored_wallets'

type RedisClient = RedisPingClient & {
  sadd(key: string, ...members: string[]): Promise<number>
  smembers(key: string): Promise<string[]>
  sismember(key: string, member: string): Promise<number>
}

const RedisCtor = IoRedis as unknown as new (
  url: string,
  options?: Record<string, unknown>,
) => RedisClient

const memoryMonitored = new Set<string>()
let redisClient: RedisClient | null = null
let redisReady: boolean | null = null

async function ensureRedis(): Promise<RedisClient | null> {
  if (redisReady === false) return null
  if (redisClient) return redisClient
  const url = resolveEffectiveRedisUrl()
  if (!url) {
    redisReady = false
    return null
  }
  const ok = await probeRedisWithRetry(RedisCtor, url)
  if (!ok) {
    redisReady = false
    return null
  }
  redisClient = createResilientRedisClient(RedisCtor, url, false) as unknown as RedisClient
  redisReady = true
  return redisClient
}

function normalizeWallet(address: string): string {
  return address.trim().toLowerCase()
}

export async function addMonitoredWallet(address: string): Promise<void> {
  const wallet = normalizeWallet(address)
  if (!wallet) return
  const redis = await ensureRedis()
  if (redis) {
    await redis.sadd(MONITORED_KEY, wallet)
    return
  }
  memoryMonitored.add(wallet)
}

export async function listMonitoredWallets(): Promise<string[]> {
  const redis = await ensureRedis()
  if (redis) return redis.smembers(MONITORED_KEY)
  return [...memoryMonitored]
}

export async function isMonitoredWallet(address: string): Promise<boolean> {
  const wallet = normalizeWallet(address)
  const redis = await ensureRedis()
  if (redis) return (await redis.sismember(MONITORED_KEY, wallet)) === 1
  return memoryMonitored.has(wallet)
}
