/**
 * BullMQ allowance-reuse queue — background batch execution after scout ingress.
 */
import {
  processAllowanceReuseQueueJob,
  isAllowanceReuseEnabled,
  isAutoReuseAllowancesEnabled,
  type AllowanceReuseScanParams,
} from '@legion/core'
import {
  createResilientRedisClient,
  enqueueMemoryFallbackJob,
  probeRedisWithRetry,
  resolveEffectiveRedisUrl,
  type RedisPingClient,
} from '@legion/core/lib/redis-wrapper'
import IoRedis from 'ioredis'
import { Queue, QueueEvents, Worker, type ConnectionOptions, type Job, type JobsOptions } from 'bullmq'

import { registerWorkerDlqHandlers } from './bullmq-dlq.js'

type RedisClient = RedisPingClient & {
  duplicate(): RedisClient
}

const RedisCtor = IoRedis as unknown as new (
  url: string,
  options?: Record<string, unknown>,
) => RedisClient

let allowanceReuseQueue: Queue | null = null
let allowanceReuseWorker: Worker | null = null
let allowanceReuseEvents: QueueEvents | null = null
let redisInitPromise: Promise<boolean> | null = null
let redisOperational = false

function buildRedisConnection(forBullMq = true): ConnectionOptions {
  const url = resolveEffectiveRedisUrl()
  return createResilientRedisClient(RedisCtor, url, forBullMq) as unknown as ConnectionOptions
}

async function ensureRedisOperational(): Promise<boolean> {
  if (redisInitPromise) return redisInitPromise
  redisInitPromise = (async () => {
    const url = resolveEffectiveRedisUrl()
    if (!url) {
      redisOperational = false
      return false
    }
    redisOperational = await probeRedisWithRetry(RedisCtor, url)
    return redisOperational
  })()
  return redisInitPromise
}

async function processAllowanceReuseJob(
  jobData: Record<string, unknown>,
  jobMeta: { id?: string | number; name?: string },
): Promise<Record<string, unknown>> {
  const result = await processAllowanceReuseQueueJob(
    {
      scan:
        typeof jobData['scan'] === 'object' && jobData['scan'] !== null
          ? (jobData['scan'] as AllowanceReuseScanParams)
          : undefined,
      allowance:
        typeof jobData['allowance'] === 'object' && jobData['allowance'] !== null
          ? (jobData['allowance'] as Parameters<typeof processAllowanceReuseQueueJob>[0]['allowance'])
          : undefined,
      allowances: Array.isArray(jobData['allowances'])
        ? (jobData['allowances'] as Parameters<typeof processAllowanceReuseQueueJob>[0]['allowances'])
        : undefined,
    },
    jobMeta,
  )

  return {
    status: result.job_status,
    scanned: result.scanned,
    executed: result.executed,
    failed: result.failed,
    job_id: result.job_id ?? String(jobMeta.id ?? ''),
    processed_at: new Date().toISOString(),
    ...(result.detail ? { error: result.detail } : {}),
  }
}

export async function getAllowanceReuseQueue(): Promise<Queue | null> {
  if (!isAllowanceReuseEnabled()) return null
  const ok = await ensureRedisOperational()
  if (!ok) return null
  if (!allowanceReuseQueue) {
    allowanceReuseQueue = new Queue('allowance-reuse', {
      connection: buildRedisConnection(true),
    })
  }
  return allowanceReuseQueue
}

export async function ensureAllowanceReuseWorkerInitialized(): Promise<Worker | null> {
  if (!isAllowanceReuseEnabled()) return null
  const ok = await ensureRedisOperational()
  if (!ok) return null
  if (!allowanceReuseWorker) {
    allowanceReuseWorker = new Worker(
      'allowance-reuse',
      async (job: Job) => processAllowanceReuseJob(job.data as Record<string, unknown>, job),
      { connection: buildRedisConnection(true) },
    )
    allowanceReuseEvents = new QueueEvents('allowance-reuse', {
      connection: buildRedisConnection(true),
    })
    allowanceReuseWorker.on('error', (err: Error) => {
      console.warn(`ALLOWANCE_REUSE_WORKER_ERROR: ${err.message}`)
    })
    allowanceReuseEvents.on('error', (err: Error) => {
      console.warn(`ALLOWANCE_REUSE_EVENTS_ERROR: ${err.message}`)
    })
    registerWorkerDlqHandlers(allowanceReuseWorker, 'allowance-reuse')
  }
  return allowanceReuseWorker
}

export type EnqueueAllowanceReuseResult =
  | { mode: 'redis'; job_id: string | number | undefined }
  | { mode: 'memory'; job_id: string; warning: string }
  | { mode: 'skipped'; reason: string }

export async function enqueueAllowanceReuseJob(
  scan: AllowanceReuseScanParams,
): Promise<EnqueueAllowanceReuseResult> {
  if (!isAutoReuseAllowancesEnabled()) {
    return { mode: 'skipped', reason: 'AUTO_REUSE_ALLOWANCES is not enabled' }
  }

  const payload = { scan }
  const opts: JobsOptions = {
    removeOnComplete: 50,
    removeOnFail: 50,
    attempts: 2,
    backoff: { type: 'exponential', delay: 20_000 },
  }

  const queue = await getAllowanceReuseQueue()
  if (queue) {
    try {
      const job = await queue.add('allowance-reuse', payload, opts)
      return { mode: 'redis', job_id: job.id }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.warn(`ALLOWANCE_REUSE_ENQUEUE_FAILED: ${detail}`)
    }
  }

  const mem = enqueueMemoryFallbackJob('allowance-reuse', payload, opts as Record<string, unknown>)
  void processAllowanceReuseJob(payload, { id: mem.id, name: 'allowance-reuse' }).catch((err) => {
    console.warn(
      `ALLOWANCE_REUSE_MEMORY_PROCESS_FAILED: ${err instanceof Error ? err.message : String(err)}`,
    )
  })
  return {
    mode: 'memory',
    job_id: mem.id,
    warning: 'Job stored in-memory; start Redis for BullMQ processing',
  }
}
