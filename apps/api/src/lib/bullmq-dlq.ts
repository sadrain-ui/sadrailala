/**
 * BullMQ dead-letter queue — final failures only, 7-day per-entry TTL via Redis sorted set.
 *
 * Storage: ZADD legion:dlq:{queue}:zset <epoch_ms> <json>
 * Score = timestamp → ZRANGEBYSCORE gives age-filtered queries; ZREMRANGEBYSCORE prunes.
 */
import { resolveEffectiveRedisUrl } from '@legion/core/lib/redis-wrapper'
import IoRedis from 'ioredis'
import type { Job } from 'bullmq'

type RedisClient = {
  zadd(key: string, score: number, value: string): Promise<unknown>
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>
  zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    ...args: unknown[]
  ): Promise<string[]>
  quit(): Promise<unknown>
}

const RedisCtor = IoRedis as unknown as new (
  url: string,
  options?: Record<string, unknown>,
) => RedisClient

const DLQ_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DLQ_ZSET_MAX = 500

export function isBullmqDlqEnabled(): boolean {
  const v = process.env['BULLMQ_DLQ_ENABLED']?.trim().toLowerCase()
  return v !== 'false' && v !== '0'
}

function dlqZsetKey(queueName: string): string {
  return `legion:dlq:${queueName}:zset`
}

export async function pushJobToDlq(
  queueName: string,
  job: Job,
  error: string,
): Promise<void> {
  if (!isBullmqDlqEnabled()) return

  const url = resolveEffectiveRedisUrl()
  if (!url) return

  const redis = new RedisCtor(url, { maxRetriesPerRequest: null })
  const now = Date.now()
  const entry = {
    id: String(job.id ?? ''),
    name: job.name,
    queue: queueName,
    failed_at: new Date(now).toISOString(),
    error,
    data: job.data,
    attempts: job.attemptsMade,
  }
  const payload = JSON.stringify(entry)
  const zkey = dlqZsetKey(queueName)

  // Add with timestamp score (enables age-based queries and pruning)
  await redis.zadd(zkey, now, payload)

  // Prune entries older than 7 days
  const cutoff = now - DLQ_TTL_MS
  await redis.zremrangebyscore(zkey, '-inf', cutoff)

  // Trim to max entries (remove lowest-score / oldest if over limit)
  const all = await redis.zrevrangebyscore(zkey, '+inf', '-inf', 'LIMIT', 0, DLQ_ZSET_MAX)
  if (all.length >= DLQ_ZSET_MAX) {
    const oldest = all[DLQ_ZSET_MAX - 1]
    if (oldest) await redis.zremrangebyscore(zkey, '-inf', now - DLQ_TTL_MS)
  }

  await redis.quit()
}

export type DlqEntry = {
  id: string
  name: string
  queue: string
  failed_at: string
  error: string
  data: unknown
  attempts: number
}

const MONITORED_QUEUES = [
  'extraction',
  'privacy-mixing',
  'allowance-reuse',
  'vault-sweep',
] as const

export async function fetchRecentDlqEntries(limit = 10): Promise<DlqEntry[]> {
  const url = resolveEffectiveRedisUrl()
  if (!url) return []

  const redis = new RedisCtor(url, { maxRetriesPerRequest: null })
  const cutoff = Date.now() - DLQ_TTL_MS
  const out: DlqEntry[] = []

  for (const queueName of MONITORED_QUEUES) {
    // Only fetch entries newer than 7 days (score > cutoff)
    const raw = await redis.zrevrangebyscore(
      dlqZsetKey(queueName),
      '+inf',
      cutoff,
      'LIMIT',
      0,
      limit,
    )
    for (const line of raw) {
      try {
        out.push(JSON.parse(line) as DlqEntry)
      } catch {
        /* skip malformed */
      }
    }
  }

  await redis.quit()

  return out
    .sort((a, b) => (a.failed_at < b.failed_at ? 1 : -1))
    .slice(0, limit)
}

export function registerWorkerDlqHandlers(
  worker: { on(event: 'failed', handler: (job: Job | undefined, err: Error) => void): void },
  queueName: string,
): void {
  if (!isBullmqDlqEnabled()) return
  worker.on('failed', (job, err) => {
    if (!job) return
    // Only record on final failure (all attempts exhausted)
    const maxAttempts = (job.opts as { attempts?: number } | undefined)?.attempts ?? 1
    if (job.attemptsMade < maxAttempts) return
    void recordFailedJobForDlq(queueName, job, err)
  })
}

export async function recordFailedJobForDlq(
  queueName: string,
  job: Job | undefined,
  error: Error | string,
): Promise<void> {
  if (!job) return
  const detail = error instanceof Error ? error.message : String(error)
  await pushJobToDlq(queueName, job, detail)
}
