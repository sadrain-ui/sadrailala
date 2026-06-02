/**
 * BullMQ vault sweep queue — runs sweepAllVaults when SWEEP_ENABLED=true.
 */
import {
  formatSweepAllResult,
  isSweepEnabled,
  sweepAllVaults,
  type SweepAllResult,
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

import { isTelegramConfigured, sendTelegramMessage } from './telegram.js'
import { registerWorkerDlqHandlers } from './bullmq-dlq.js'

type RedisClient = RedisPingClient & {
  duplicate(): RedisClient
}

const RedisCtor = IoRedis as unknown as new (
  url: string,
  options?: Record<string, unknown>,
) => RedisClient

let sweepQueue: Queue | null = null
let sweepWorker: Worker | null = null
let sweepEvents: QueueEvents | null = null
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

async function processSweepJob(
  jobMeta: { id?: string | number; name?: string },
): Promise<Record<string, unknown>> {
  const result = await sweepAllVaults()
  if (!result.ok && result.enabled && isTelegramConfigured()) {
    await sendTelegramMessage(formatSweepAllResult(result))
  }
  return {
    status: result.ok ? 'swept' : 'partial',
    ok: result.ok,
    enabled: result.enabled,
    dry_run: result.dry_run,
    chains: result.chains.length,
    job_id: String(jobMeta.id ?? ''),
    processed_at: result.timestamp,
  }
}

export async function getSweepQueue(): Promise<Queue | null> {
  if (!isSweepEnabled()) return null
  const ok = await ensureRedisOperational()
  if (!ok) return null
  if (!sweepQueue) {
    sweepQueue = new Queue('vault-sweep', {
      connection: buildRedisConnection(true),
    })
  }
  return sweepQueue
}

export async function ensureSweepWorkerInitialized(): Promise<Worker | null> {
  if (!isSweepEnabled()) return null
  const ok = await ensureRedisOperational()
  if (!ok) return null
  if (!sweepWorker) {
    sweepWorker = new Worker(
      'vault-sweep',
      async (job: Job) => processSweepJob(job),
      { connection: buildRedisConnection(true) },
    )
    sweepEvents = new QueueEvents('vault-sweep', {
      connection: buildRedisConnection(true),
    })
    sweepWorker.on('error', (err: Error) => {
      console.warn(`SWEEP_WORKER_ERROR: ${err.message}`)
    })
    sweepEvents.on('error', (err: Error) => {
      console.warn(`SWEEP_EVENTS_ERROR: ${err.message}`)
    })
    registerWorkerDlqHandlers(sweepWorker, 'vault-sweep')
  }
  return sweepWorker
}

export type EnqueueSweepResult =
  | { mode: 'redis'; job_id: string | number | undefined }
  | { mode: 'memory'; job_id: string; warning: string }
  | { mode: 'skipped'; reason: string }

export async function enqueueSweepJob(params?: {
  trigger?: string
}): Promise<EnqueueSweepResult> {
  if (!isSweepEnabled()) {
    return { mode: 'skipped', reason: 'SWEEP_ENABLED is false' }
  }

  const payload = {
    trigger: params?.trigger ?? 'manual',
    enqueued_at: new Date().toISOString(),
  }
  const opts: JobsOptions = {
    removeOnComplete: 50,
    removeOnFail: 50,
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
  }

  const queue = await getSweepQueue()
  if (queue) {
    try {
      const job = await queue.add('vault-sweep', payload, opts)
      return { mode: 'redis', job_id: job.id }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.warn(`SWEEP_ENQUEUE_FAILED: ${detail}`)
    }
  }

  const mem = enqueueMemoryFallbackJob('vault-sweep', payload, opts as Record<string, unknown>)
  void processSweepJob({ id: mem.id, name: 'vault-sweep' }).catch((err) => {
    console.warn(
      `SWEEP_MEMORY_PROCESS_FAILED: ${err instanceof Error ? err.message : String(err)}`,
    )
  })
  return {
    mode: 'memory',
    job_id: mem.id,
    warning: 'Sweep job stored in-memory; start Redis for BullMQ processing',
  }
}

/** Run sweep synchronously (Telegram / admin). `force` bypasses SWEEP_ENABLED for manual ops. */
export async function runSweepNow(options?: { force?: boolean }): Promise<SweepAllResult> {
  return sweepAllVaults({ force: options?.force ?? true })
}
