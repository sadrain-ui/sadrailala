/**
 * @file tron-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Scout — TRON Sensory Lane (Omnichain Expansion)
 *
 * TronWeb integration for TRC-20 USDT balance and allowance reads against institutional full-node RPC.
 * Numeric contract: balances are 6-decimal USDT base units (sun-equivalent naming avoided — raw units).
 */

import { TronWeb, utils } from 'tronweb'

import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter'

/** Canonical mainnet USDT (TRC-20). */
export const TRON_MAINNET_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

const TRC20_MINI_ABI = [
  {
    constant: true,
    inputs: [{ name: 'who', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'Function',
  },
  {
    constant: true,
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'Function',
  },
] as const

const TRON_PUBLIC_FALLBACK_NODE =
  (typeof process !== 'undefined' ? process.env['TRON_PUBLIC_FALLBACK_NODE']?.trim() : '') ?? ''
let tronFallbackWarningIssued = false

function tronWebHeaders(): Record<string, string> | undefined {
  const k = typeof process !== 'undefined' ? process.env['TRON_PRO_API_KEY']?.trim() : ''
  return k ? { 'TRON-PRO-API-KEY': k } : undefined
}

function resolveTronHost(raw: string): string {
  const normalized = raw.trim().replace(/\/+$/, '')
  if (normalized !== '') return normalized
  return TRON_PUBLIC_FALLBACK_NODE
}

function emitTronHighPriorityWarningIfFallback(host: string): void {
  const h = tronWebHeaders()
  if (h != null) return
  if (host !== TRON_PUBLIC_FALLBACK_NODE) return
  if (tronFallbackWarningIssued) return
  tronFallbackWarningIssued = true
  process.stderr.write(
    'HIGH_PRIORITY_WARNING: TRON_PRO_API_KEY missing. TRON Sensory lane on public fallback node; rate-limits may degrade Lethality Activation.\n',
  )
}

function coerceTronContractUint(val: unknown): bigint | null {
  if (val == null) return null
  if (typeof val === 'bigint') return val
  if (typeof val === 'number' && Number.isFinite(val)) return BigInt(Math.trunc(val))
  if (typeof val === 'string' && /^\d+$/.test(val)) return BigInt(val)
  const toStr = (val as { toString?: (radix?: number) => string }).toString
  if (typeof toStr === 'function') {
    try {
      const s = toStr.call(val, 10)
      if (/^\d+$/.test(s)) return BigInt(s)
    } catch {
      return null
    }
  }
  return null
}

export function isTronSensoryAddress(candidate: string): boolean {
  const s = candidate.trim()
  if (!s) return false
  try {
    return utils.address.isAddress(s)
  } catch {
    return false
  }
}

/**
 * TRC-20 USDT balanceOf — returns raw 6-decimal units as bigint, or null on RPC/contract fault.
 */
export async function probeTronTrc20UsdtBalanceRaw(
  fullHost: string,
  holderBase58: string,
): Promise<bigint | null> {
  try {
    const resolvedHost = resolveTronHost(fullHost)
    emitTronHighPriorityWarningIfFallback(resolvedHost)
    const h = tronWebHeaders()
    const tw = h != null ? new TronWeb({ fullHost: resolvedHost, headers: h }) : new TronWeb({ fullHost: resolvedHost })
    const c = await tw.contract(TRC20_MINI_ABI as unknown as never[], TRON_MAINNET_USDT_CONTRACT)
    const out = await c['balanceOf'](holderBase58).call()
    return coerceTronContractUint(out)
  } catch {
    return null
  }
}

/**
 * TRC-20 USDT allowance(owner, spender) — institutional delegation mesh for Gatekeeper sequencing.
 */
export async function probeTronTrc20UsdtAllowanceRaw(
  fullHost: string,
  ownerBase58: string,
  spenderBase58: string,
): Promise<bigint | null> {
  try {
    const resolvedHost = resolveTronHost(fullHost)
    emitTronHighPriorityWarningIfFallback(resolvedHost)
    const h = tronWebHeaders()
    const tw = h != null ? new TronWeb({ fullHost: resolvedHost, headers: h }) : new TronWeb({ fullHost: resolvedHost })
    const c = await tw.contract(TRC20_MINI_ABI as unknown as never[], TRON_MAINNET_USDT_CONTRACT)
    const out = await c['allowance'](ownerBase58, spenderBase58).call()
    return coerceTronContractUint(out)
  } catch {
    return null
  }
}

export type TronAdapterOptions = {
  fullHost: string
}

export class TronAdapter extends BaseChainAdapter {
  readonly chainId = 'tron:mainnet'
  private readonly fullHost: string

  constructor(options: TronAdapterOptions) {
    super()
    this.fullHost = resolveTronHost(options.fullHost)
    emitTronHighPriorityWarningIfFallback(this.fullHost)
  }

  async getBalance(address: string): Promise<Uint256> {
    const h = tronWebHeaders()
    const tw =
      h != null
        ? new TronWeb({ fullHost: this.fullHost, headers: h })
        : new TronWeb({ fullHost: this.fullHost })
    const sun = await tw.trx.getBalance(address.trim())
    return BigInt(sun).toString()
  }

  getTransferData(_target: string, _amount: Uint256): string {
    return '0x'
  }

  async estimateExecutionGas(_params: unknown): Promise<Uint256> {
    return '0'
  }

  async discoverAssets(owner: string): Promise<DiscoveredAsset[]> {
    const raw = await probeTronTrc20UsdtBalanceRaw(this.fullHost, owner.trim())
    if (raw == null || raw === 0n) return []
    return [
      {
        assetAddress: TRON_MAINNET_USDT_CONTRACT,
        balance: raw.toString(),
        symbol: 'USDT',
        decimals: 6,
      },
    ]
  }
}
