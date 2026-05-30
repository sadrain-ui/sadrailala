/**
 * Redis resilience layer — exponential backoff connect probe, in-memory job fallback (dev only).
 * Production should use managed Redis (Upstash). Local: `docker compose up -d redis`.
 */
import {
  buildRedisFailSafeOptions,
  createRedisFailSafeClient,
  type RedisFailSafeConstructor,
} from '../redis-client.js'

export const DEFAULT_DEV_REDIS_URL = 'redis://localhost:6379'
export const REDIS_WRAPPER_MAX_CONNECT_RETRIES = 3

export type RedisWrapperState = 'unknown' | 'connected' | 'degraded'

export type MemoryJobRecord = {
  id: string
  name: string
  data: Record<string, unknown>
  enqueued_at: string
  opts?: Record<string, unknown>
}

export type RedisPingClient = {
  connect(): Promise<void>
  ping(): Promise<string>
  quit(): Promise<string>
  disconnect(): void
  on(event: 'error', listener: (err: Error) => void): void
}

let wrapperState: RedisWrapperState = 'unknown'
let lastProbeError: string | null = null

const memoryJobQueue = new Map<string, MemoryJobRecord>()

/** Exponential backoff: 250ms, 500ms, 1000ms — then stop (max 3 retries). */
export function redisWrapperRetryStrategy(times: number): number | null {
  if (times > REDIS_WRAPPER_MAX_CONNECT_RETRIES) return null
  return Math.min(250 * 2 ** (times - 1), 4_000)
}

export function resolveEffectiveRedisUrl(): string {
  const explicit = process.env['REDIS_URL']?.trim()
  if (explicit) return explicit
  if (process.env['NODE_ENV'] !== 'production') return DEFAULT_DEV_REDIS_URL
  return ''
}

export function isDevMemoryFallbackForced(): boolean {
  return process.env['REDIS_MEMORY_FALLBACK']?.trim().toLowerCase() === 'true'
}

export function getRedisWrapperState(): RedisWrapperState {
  return wrapperState
}

export function getLastRedisProbeError(): string | null {
  return lastProbeError
}

export function buildBullMqRedisOptions(rawUrl: string) {
  const connectTimeout = Number(process.env['REDIS_CONNECT_TIMEOUT_MS']?.trim() || '') || 10_000
  return buildRedisFailSafeOptions(rawUrl, {
    connectTimeout,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: redisWrapperRetryStrategy,
  })
}

export function buildApiRedisOptions(rawUrl: string) {
  const connectTimeout = Number(process.env['REDIS_CONNECT_TIMEOUT_MS']?.trim() || '') || 10_000
  const maxRetries =
    Number(process.env['REDIS_MAX_RETRIES']?.trim() || '') || REDIS_WRAPPER_MAX_CONNECT_RETRIES
  return buildRedisFailSafeOptions(rawUrl, {
    connectTimeout,
    maxRetriesPerRequest: maxRetries,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: redisWrapperRetryStrategy,
  })
}

export function createResilientRedisClient<T extends RedisPingClient>(
  RedisCtor: RedisFailSafeConstructor<T>,
  rawUrl: string,
  forBullMq = false,
): T {
  const options = forBullMq ? buildBullMqRedisOptions(rawUrl) : buildApiRedisOptions(rawUrl)
  const client = createRedisFailSafeClient(RedisCtor, rawUrl, options)
  client.on('error', (err: Error) => {
    if (wrapperState === 'connected') {
      wrapperState = 'degraded'
      lastProbeError = err.message
      console.warn(`REDIS_DEGRADED: ${err.message}`)
    }
  })
  return client
}

export async function probeRedisWithRetry<T extends RedisPingClient>(
  RedisCtor: RedisFailSafeConstructor<T>,
  rawUrl?: string,
): Promise<boolean> {
  const url = rawUrl?.trim() || resolveEffectiveRedisUrl()
  if (!url) {
    wrapperState = 'degraded'
    lastProbeError = 'REDIS_URL unset'
    return false
  }

  if (isDevMemoryFallbackForced()) {
    wrapperState = 'degraded'
    lastProbeError = 'REDIS_MEMORY_FALLBACK=true'
    warnRedisDegraded('Memory fallback forced via REDIS_MEMORY_FALLBACK=true')
    return false
  }

  let attempt = 0
  while (attempt < REDIS_WRAPPER_MAX_CONNECT_RETRIES) {
    attempt++
    const client = createResilientRedisClient(RedisCtor, url, false)
    try {
      await client.connect()
      const pong = await client.ping()
      await client.quit()
      if (pong === 'PONG') {
        wrapperState = 'connected'
        lastProbeError = null
        return true
      }
      lastProbeError = `Unexpected PING response: ${pong}`
    } catch (e) {
      lastProbeError = e instanceof Error ? e.message : String(e)
      try {
        client.disconnect()
      } catch {
        /* ignore */
      }
      if (attempt < REDIS_WRAPPER_MAX_CONNECT_RETRIES) {
        const delay = redisWrapperRetryStrategy(attempt)
        if (delay != null) await sleep(delay)
      }
    }
  }

  wrapperState = 'degraded'
  warnRedisDegraded(lastProbeError ?? 'Redis probe failed')
  return false
}

export function warnRedisDegraded(detail: string): void {
  console.warn(
    `REDIS_DEGRADED: ${detail} — queue operations will use in-memory fallback. ` +
      'For local dev: docker compose up -d redis && set REDIS_URL=redis://localhost:6379',
  )
}

export function enqueueMemoryFallbackJob(
  name: string,
  data: Record<string, unknown>,
  opts?: Record<string, unknown>,
): MemoryJobRecord {
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const record: MemoryJobRecord = {
    id,
    name,
    data,
    enqueued_at: new Date().toISOString(),
    ...(opts ? { opts } : {}),
  }
  memoryJobQueue.set(id, record)
  console.warn(`REDIS_MEMORY_ENQUEUE: job ${id} (${name}) stored in-process — not durable`)
  return record
}

export function listMemoryFallbackJobs(): MemoryJobRecord[] {
  return [...memoryJobQueue.values()]
}

export function drainMemoryFallbackJobs(): MemoryJobRecord[] {
  const jobs = listMemoryFallbackJobs()
  memoryJobQueue.clear()
  return jobs
}

export function memoryFallbackJobCount(): number {
  return memoryJobQueue.size
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
