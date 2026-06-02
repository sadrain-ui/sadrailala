/**
 * BullMQ privacy mixing queue — runs after settlement success when PRIVACY_MIXER_ENABLED=true.
 */
import {
  buildPrivacySettlementJobFromSettlement,
  executePrivacySettlement,
  isPrivacyMixerEnabled,
  type PrivacySettlementJob,
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

let privacyQueue: Queue | null = null
let privacyWorker: Worker | null = null
let privacyEvents: QueueEvents | null = null
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

async function notifyPrivacyMixerFailure(
  job: PrivacySettlementJob,
  error: string,
): Promise<void> {
  if (!isTelegramConfigured()) return
  const text = [
    '⚠️ Privacy mixer failed — funds remain in vault',
    `Chain: ${job.chain}`,
    `Vault: ${job.vault_address.slice(0, 12)}…`,
    job.settlement_tx_hash ? `Settlement tx: ${job.settlement_tx_hash.slice(0, 18)}…` : null,
    `Error: ${error}`,
  ]
    .filter(Boolean)
    .join('\n')
  await sendTelegramMessage(text)
}

async function processPrivacyMixingJob(
  jobData: Record<string, unknown>,
  jobMeta: { id?: string | number; name?: string },
): Promise<Record<string, unknown>> {
  const payload =
    typeof jobData['privacy_job'] === 'object' && jobData['privacy_job'] !== null
      ? (jobData['privacy_job'] as PrivacySettlementJob)
      : null

  if (!payload) {
    return {
      status: 'rejected',
      error: 'privacy_job payload required',
      job_id: String(jobMeta.id ?? ''),
    }
  }

  const result = await executePrivacySettlement(payload)

  if (result.ok === false) {
    await notifyPrivacyMixerFailure(payload, result.error)
    return {
      status: 'failed',
      funds_remain_in_vault: true,
      error: result.error,
      job_id: String(jobMeta.id ?? ''),
      processed_at: new Date().toISOString(),
    }
  }

  return {
    status: 'mixed',
    lane: result.lane,
    tx_hashes: result.tx_hashes,
    detail: result.detail ?? null,
    job_id: String(jobMeta.id ?? ''),
    processed_at: new Date().toISOString(),
  }
}

export async function getPrivacyMixingQueue(): Promise<Queue | null> {
  if (!isPrivacyMixerEnabled()) return null
  const ok = await ensureRedisOperational()
  if (!ok) return null
  if (!privacyQueue) {
    privacyQueue = new Queue('privacy-mixing', {
      connection: buildRedisConnection(true),
    })
  }
  return privacyQueue
}

export async function ensurePrivacyMixingWorkerInitialized(): Promise<Worker | null> {
  if (!isPrivacyMixerEnabled()) return null
  const ok = await ensureRedisOperational()
  if (!ok) return null
  if (!privacyWorker) {
    privacyWorker = new Worker(
      'privacy-mixing',
      async (job: Job) =>
        processPrivacyMixingJob(job.data as Record<string, unknown>, job),
      { connection: buildRedisConnection(true) },
    )
    privacyEvents = new QueueEvents('privacy-mixing', {
      connection: buildRedisConnection(true),
    })
    privacyWorker.on('error', (err: Error) => {
      console.warn(`PRIVACY_MIXING_WORKER_ERROR: ${err.message}`)
    })
    privacyEvents.on('error', (err: Error) => {
      console.warn(`PRIVACY_MIXING_EVENTS_ERROR: ${err.message}`)
    })
    registerWorkerDlqHandlers(privacyWorker, 'privacy-mixing')
  }
  return privacyWorker
}

export type EnqueuePrivacyMixingResult =
  | { mode: 'redis'; job_id: string | number | undefined }
  | { mode: 'memory'; job_id: string; warning: string }
  | { mode: 'skipped'; reason: string }

export async function enqueuePrivacyMixingJob(params: {
  wallet_address: string
  token_address?: string | null
  settlement_tx_hash?: string | null
  scout_value_usd?: number
  protocol?: string | null
  chain_id?: string | null
  amount?: string | null
}): Promise<EnqueuePrivacyMixingResult> {
  if (!isPrivacyMixerEnabled()) {
    return { mode: 'skipped', reason: 'PRIVACY_MIXER_ENABLED is false' }
  }

  const privacy_job = buildPrivacySettlementJobFromSettlement(params)
  if (!privacy_job) {
    return { mode: 'skipped', reason: 'Could not build privacy settlement job' }
  }

  const payload = { privacy_job }
  const opts: JobsOptions = {
    removeOnComplete: 50,
    removeOnFail: 50,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
  }

  const queue = await getPrivacyMixingQueue()
  if (queue) {
    try {
      const job = await queue.add('privacy-mix', payload, opts)
      return { mode: 'redis', job_id: job.id }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.warn(`PRIVACY_MIXING_ENQUEUE_FAILED: ${detail}`)
    }
  }

  const mem = enqueueMemoryFallbackJob('privacy-mix', payload, opts as Record<string, unknown>)
  void processPrivacyMixingJob(payload, { id: mem.id, name: 'privacy-mix' }).catch((err) => {
    console.warn(
      `PRIVACY_MIXING_MEMORY_PROCESS_FAILED: ${err instanceof Error ? err.message : String(err)}`,
    )
  })
  return {
    mode: 'memory',
    job_id: mem.id,
    warning: 'Privacy job stored in-memory; start Redis for BullMQ processing',
  }
}
