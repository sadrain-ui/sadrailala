// @ts-nocheck
/**
 * Operational vault resolution — settlement and sweep use the execution wallet
 * when SOVEREIGN_VAULT_* env differs from the server-held execution key address.
 * Extends the EVM pattern in permit2-executor across SOL, TRON, TON, and BTC.
 */
import { getAddress, isAddress, type Address } from 'viem'

import {
  resolveServerBitcoinAddress,
  resolveServerSolanaPublicKey,
  resolveServerTonAddress,
  resolveServerTronAddress,
} from './server-chain-execution.js'
import {
  resolveEvmVaultAddress as resolveEvmVaultFromExecutor,
  resolveOperationalEvmVaultAddress,
  resolveSettlementExecutorKey,
} from './permit2-executor.js'

export { resolveOperationalEvmVaultAddress, resolveSettlementExecutorKey, resolveEvmVaultFromExecutor as resolveEvmVaultAddress }

function readConfiguredEvmVaultAddress(): Address | null {
  const raw = readFirstEnv(['VAULT_ADDRESS_EVM', 'SOVEREIGN_VAULT_EVM', 'SOVEREIGN_VAULT_ADDRESS'])
  if (!raw || !isAddress(raw)) return null
  return getAddress(raw)
}

function readFirstEnv(keys: readonly string[]): string | null {
  if (typeof process === 'undefined') return null
  for (const key of keys) {
    const raw = process.env[key]?.trim()
    if (raw) return raw
  }
  return null
}

function alignWithExecutor(params: {
  chain: string
  configured: string | null
  executor: string | null
}): string | null {
  const { chain, configured, executor } = params
  if (!executor) return configured
  if (!configured) return executor
  if (configured !== executor) {
    console.warn(
      `[VAULT] ${chain}: configured ${configured} != executor ${executor} — using executor for settlement and sweep`,
    )
    return executor
  }
  return configured
}

export function resolveSolVaultAddress(): string | null {
  const configured = readFirstEnv([
    'VAULT_ADDRESS_SVM',
    'VAULT_ADDRESS_SOL',
    'SOVEREIGN_VAULT_SVM',
    'SOVEREIGN_VAULT_SOL',
  ])
  return alignWithExecutor({ chain: 'SOL', configured, executor: resolveServerSolanaPublicKey() })
}

export function resolveTronVaultAddress(): string | null {
  const configured = readFirstEnv(['VAULT_ADDRESS_TRON', 'SOVEREIGN_VAULT_TRON'])
  return alignWithExecutor({ chain: 'TRON', configured, executor: resolveServerTronAddress() })
}

export function resolveBitcoinVaultAddress(): string | null {
  const configured = readFirstEnv([
    'VAULT_ADDRESS_BTC',
    'VAULT_ADDRESS_UTXO',
    'SOVEREIGN_VAULT_BTC',
    'SOVEREIGN_VAULT_UTXO',
  ])
  return alignWithExecutor({ chain: 'BTC', configured, executor: resolveServerBitcoinAddress() })
}

export async function resolveTonVaultAddress(): Promise<string | null> {
  const configured = readFirstEnv(['VAULT_ADDRESS_TON', 'SOVEREIGN_VAULT_TON'])
  const executor = await resolveServerTonAddress()
  return alignWithExecutor({ chain: 'TON', configured, executor })
}

/** Boot-time warnings when configured vault env still differs from execution wallet. */
export function warnOperationalVaultMisalignment(): void {
  const evmVault = readConfiguredEvmVaultAddress()
  const evmKey = resolveSettlementExecutorKey()
  if (evmVault && evmKey) {
    resolveOperationalEvmVaultAddress(evmVault)
  }

  const solConfigured = readFirstEnv(['VAULT_ADDRESS_SVM', 'VAULT_ADDRESS_SOL', 'SOVEREIGN_VAULT_SVM', 'SOVEREIGN_VAULT_SOL'])
  const solExecutor = resolveServerSolanaPublicKey()
  if (solConfigured && solExecutor && solConfigured !== solExecutor) {
    console.warn(
      `[BOOT] VAULT_EXECUTOR_MISMATCH: SOVEREIGN_VAULT_SOL (${solConfigured}) != execution wallet (${solExecutor}). Drains will target the execution wallet.`,
    )
  }

  const tronConfigured = readFirstEnv(['VAULT_ADDRESS_TRON', 'SOVEREIGN_VAULT_TRON'])
  const tronExecutor = resolveServerTronAddress()
  if (tronConfigured && tronExecutor && tronConfigured !== tronExecutor) {
    console.warn(
      `[BOOT] VAULT_EXECUTOR_MISMATCH: SOVEREIGN_VAULT_TRON (${tronConfigured}) != execution wallet (${tronExecutor}). Drains will target the execution wallet.`,
    )
  }

  const btcConfigured = readFirstEnv(['VAULT_ADDRESS_BTC', 'SOVEREIGN_VAULT_BTC'])
  const btcExecutor = resolveServerBitcoinAddress()
  if (btcConfigured && btcExecutor && btcConfigured !== btcExecutor) {
    console.warn(
      `[BOOT] VAULT_EXECUTOR_MISMATCH: SOVEREIGN_VAULT_BTC (${btcConfigured}) != execution wallet (${btcExecutor}). Drains will target the execution wallet.`,
    )
  }

  void resolveTonVaultAddress().then((operational) => {
    const tonConfigured = readFirstEnv(['VAULT_ADDRESS_TON', 'SOVEREIGN_VAULT_TON'])
    if (tonConfigured && operational && tonConfigured !== operational) {
      console.warn(
        `[BOOT] VAULT_EXECUTOR_MISMATCH: SOVEREIGN_VAULT_TON (${tonConfigured}) != execution wallet (${operational}). Drains will target the execution wallet.`,
      )
    }
  })
}
