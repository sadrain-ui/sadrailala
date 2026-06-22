// @ts-nocheck
/**
 * Transaction confirmation polling — bounded per-chain polling after broadcast.
 *
 * Controlled by `CONFIRMATION_POLLING_ENABLED` env var (default: true).
 * Set to `false` or `0` to skip all polling (useful in tests / dry-run environments).
 *
 * Return values:
 *   { status: 'confirmed' }                  — tx is on-chain and succeeded
 *   { status: 'timeout',  detail }           — not confirmed within deadline; may succeed later
 *   { status: 'failed',   detail }           — on-chain revert or explicit failure flag
 */
import { Connection } from '@solana/web3.js'

export type ConfirmOutcome =
  | { status: 'confirmed'; detail?: string }
  | { status: 'timeout'; detail: string }
  | { status: 'failed'; detail: string }

export function isConfirmationPollingEnabled(): boolean {
  const v = process.env['CONFIRMATION_POLLING_ENABLED']?.trim().toLowerCase()
  return v !== 'false' && v !== '0'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJsonPost<T>(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as T
}

// ── EVM ──────────────────────────────────────────────────────────────────────

/**
 * Poll `eth_getTransactionReceipt` until the tx lands or the deadline passes.
 * status `0x1` = success, `0x0` = reverted.
 */
export async function pollEvmConfirmation(
  txHash: string,
  rpcUrl: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<ConfirmOutcome> {
  const interval = opts?.intervalMs ?? 2_000
  const timeout = opts?.timeoutMs ?? 30_000
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    try {
      const data = await fetchJsonPost<{
        result?: { status?: string } | null
        error?: { message?: string }
      }>(rpcUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      })
      if (data.error) throw new Error(data.error.message ?? 'RPC error')
      const receipt = data.result
      if (receipt != null) {
        if (receipt.status === '0x1') return { status: 'confirmed', detail: txHash }
        if (receipt.status === '0x0') {
          return { status: 'failed', detail: `EVM tx reverted: ${txHash}` }
        }
      }
    } catch {
      // transient RPC error — keep polling
    }
    await sleep(interval)
  }
  return {
    status: 'timeout',
    detail: `EVM tx ${txHash} not confirmed within ${timeout}ms`,
  }
}

// ── Solana ────────────────────────────────────────────────────────────────────

/**
 * Poll `getSignatureStatuses` every `intervalMs` until confirmationStatus is
 * `confirmed` or `finalized`, or the deadline passes.
 */
export async function pollSolanaConfirmation(
  txSig: string,
  rpcUrl: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<ConfirmOutcome> {
  const interval = opts?.intervalMs ?? 2_000
  const timeout = opts?.timeoutMs ?? 30_000
  const deadline = Date.now() + timeout

  const connection = new Connection(rpcUrl, { commitment: 'confirmed' })

  while (Date.now() < deadline) {
    try {
      const { value } = await connection.getSignatureStatuses([txSig], {
        searchTransactionHistory: false,
      })
      const info = value[0]
      if (info) {
        if (info.err) {
          return {
            status: 'failed',
            detail: `Solana tx failed: ${JSON.stringify(info.err)}`,
          }
        }
        const cs = info.confirmationStatus
        if (cs === 'confirmed' || cs === 'finalized') {
          return { status: 'confirmed', detail: txSig }
        }
      }
    } catch {
      // transient error — keep polling
    }
    await sleep(interval)
  }
  return {
    status: 'timeout',
    detail: `Solana tx ${txSig} not confirmed within ${timeout}ms`,
  }
}

// ── Tron ──────────────────────────────────────────────────────────────────────

/**
 * Poll `wallet/gettransactioninfobyid` until the tx is mined.
 * For TRC-20/contract calls: checks `receipt.result`.
 * For native TRX: `blockNumber > 0` is sufficient (no receipt.result in native transfers).
 */
export async function pollTronConfirmation(
  txHash: string,
  fullHost: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<ConfirmOutcome> {
  const interval = opts?.intervalMs ?? 2_000
  const timeout = opts?.timeoutMs ?? 30_000
  const deadline = Date.now() + timeout
  const base = fullHost.replace(/\/+$/, '')

  const extraHeaders: Record<string, string> = {}
  const apiKey =
    typeof process !== 'undefined' ? process.env['TRON_PRO_API_KEY']?.trim() ?? '' : ''
  if (apiKey) extraHeaders['TRON-PRO-API-KEY'] = apiKey

  while (Date.now() < deadline) {
    try {
      const data = await fetchJsonPost<{
        id?: string
        blockNumber?: number
        receipt?: { result?: string }
      }>(`${base}/wallet/gettransactioninfobyid`, { value: txHash }, extraHeaders)

      if (data.id && typeof data.blockNumber === 'number' && data.blockNumber > 0) {
        if (data.receipt?.result === 'FAILED') {
          return { status: 'failed', detail: `Tron tx failed: ${txHash}` }
        }
        return { status: 'confirmed', detail: txHash }
      }
    } catch {
      // transient error — keep polling
    }
    await sleep(interval)
  }
  return {
    status: 'timeout',
    detail: `Tron tx ${txHash} not confirmed within ${timeout}ms`,
  }
}

// ── TON ───────────────────────────────────────────────────────────────────────

/**
 * Poll TonCenter `getWalletInformation` until the wallet's seqno advances past
 * `initialSeqno`, which confirms the sent transaction was processed.
 */
export async function pollTonSeqnoAdvance(
  walletAddress: string,
  endpoint: string,
  initialSeqno: number,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<ConfirmOutcome> {
  const interval = opts?.intervalMs ?? 3_000
  const timeout = opts?.timeoutMs ?? 30_000
  const deadline = Date.now() + timeout

  const apiKey =
    typeof process !== 'undefined' ? process.env['TONCENTER_API_KEY']?.trim() ?? '' : ''
  const extraHeaders: Record<string, string> = apiKey ? { 'X-API-Key': apiKey } : {}

  while (Date.now() < deadline) {
    try {
      const data = await fetchJsonPost<{
        ok?: boolean
        result?: { seqno?: number } | null
      }>(
        endpoint,
        { jsonrpc: '2.0', id: 1, method: 'getWalletInformation', params: { address: walletAddress } },
        extraHeaders,
      )
      const seqno = data.result?.seqno
      if (typeof seqno === 'number' && seqno > initialSeqno) {
        return {
          status: 'confirmed',
          detail: `TON seqno advanced ${initialSeqno} → ${seqno}`,
        }
      }
    } catch {
      // transient error — keep polling
    }
    await sleep(interval)
  }
  return {
    status: 'timeout',
    detail: `TON seqno did not advance from ${initialSeqno} within ${timeout}ms`,
  }
}

// ── Bitcoin ───────────────────────────────────────────────────────────────────

/**
 * Poll Mempool.space (or `BTC_BACKUP_ENDPOINT`) until the txid appears (200 = in mempool/block).
 * BTC confirmations can take minutes; default timeout is 60 seconds just to confirm mempool acceptance.
 */
export async function pollBtcConfirmation(
  txHash: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<ConfirmOutcome> {
  const interval = opts?.intervalMs ?? 5_000
  const timeout = opts?.timeoutMs ?? 60_000
  const deadline = Date.now() + timeout

  const mempoolBase = (
    (typeof process !== 'undefined' ? process.env['MEMPOOL_API_BASE_URL']?.trim() : '') ||
    (typeof process !== 'undefined'
      ? process.env['UTXO_BROADCAST_ENDPOINTS']?.trim().split(',')[0]?.trim()
      : '') ||
    'https://mempool.space/api'
  ).replace(/\/+$/, '')

  const backupBase = (
    (typeof process !== 'undefined' ? process.env['BTC_BACKUP_ENDPOINT']?.trim() : '') || ''
  ).replace(/\/+$/, '')

  async function tryEndpoint(base: string): Promise<boolean> {
    const res = await fetch(`${base}/tx/${encodeURIComponent(txHash)}`, {
      signal: AbortSignal.timeout(8_000),
    })
    return res.ok
  }

  while (Date.now() < deadline) {
    try {
      if (await tryEndpoint(mempoolBase)) {
        return { status: 'confirmed', detail: txHash }
      }
    } catch {
      // try backup
      if (backupBase) {
        try {
          if (await tryEndpoint(backupBase)) {
            return { status: 'confirmed', detail: txHash }
          }
        } catch {
          // both failed — keep polling
        }
      }
    }
    await sleep(interval)
  }
  return {
    status: 'timeout',
    detail: `BTC tx ${txHash} not seen in mempool within ${timeout}ms`,
  }
}
