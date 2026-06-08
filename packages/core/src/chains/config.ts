/**
 * Chain configuration registry — canonical metadata + RPC resolution per supported network.
 */
import {
  APTOS_MAINNET_CAIP2,
  APTOS_NATIVE_DECIMALS,
  resolveAptosRpcUrl,
} from './aptos.js'
import {
  COSMOS_HUB_CAIP2,
  COSMOS_NATIVE_DENOM,
  resolveCosmosRpcUrl,
} from './cosmos.js'
import {
  SUI_MAINNET_CAIP2,
  SUI_NATIVE_DECIMALS,
  resolveSuiRpcUrl,
} from './sui.js'
import { resolveSolanaRpcUrl } from '../lib/chain-rpc.js'

export type ChainHandlerId =
  | 'aptos'
  | 'cosmos'
  | 'sui'
  | 'evm'
  | 'svm'
  | 'utxo'
  | 'tron'
  | 'ton'

export type ChainFinalityModel = 'probabilistic' | 'deterministic' | 'instant'

export type ChainConfigEntry = {
  /** CAIP-2-style registry id, e.g. `aptos:1`, `cosmos:cosmoshub-4`. */
  id: string
  handler: ChainHandlerId
  family: string
  displayName: string
  nativeSymbol: string
  nativeDenom?: string
  nativeDecimals: number
  finalityModel: ChainFinalityModel
  resolveRpcUrl: () => string
}

export const APTOS_MAINNET_CONFIG: ChainConfigEntry = {
  id: APTOS_MAINNET_CAIP2,
  handler: 'aptos',
  family: 'APTOS',
  displayName: 'Aptos Mainnet',
  nativeSymbol: 'APT',
  nativeDecimals: APTOS_NATIVE_DECIMALS,
  finalityModel: 'deterministic',
  resolveRpcUrl: resolveAptosRpcUrl,
}

export const COSMOS_HUB_CONFIG: ChainConfigEntry = {
  id: COSMOS_HUB_CAIP2,
  handler: 'cosmos',
  family: 'COSMOS',
  displayName: 'Cosmos Hub',
  nativeSymbol: 'ATOM',
  nativeDenom: COSMOS_NATIVE_DENOM,
  nativeDecimals: 6,
  finalityModel: 'deterministic',
  resolveRpcUrl: resolveCosmosRpcUrl,
}

export const SOLANA_MAINNET_CONFIG: ChainConfigEntry = {
  id: 'svm:101',
  handler: 'svm',
  family: 'SVM',
  displayName: 'Solana Mainnet',
  nativeSymbol: 'SOL',
  nativeDecimals: 9,
  finalityModel: 'deterministic',
  resolveRpcUrl: resolveSolanaRpcUrl,
}

export const SUI_MAINNET_CONFIG: ChainConfigEntry = {
  id: SUI_MAINNET_CAIP2,
  handler: 'sui',
  family: 'SUI',
  displayName: 'Sui Mainnet',
  nativeSymbol: 'SUI',
  nativeDecimals: SUI_NATIVE_DECIMALS,
  finalityModel: 'deterministic',
  resolveRpcUrl: resolveSuiRpcUrl,
}

/** Ordered registry of chain definitions keyed by CAIP-2 id. */
export const CHAIN_CONFIG: Readonly<Record<string, ChainConfigEntry>> = {
  [APTOS_MAINNET_CONFIG.id]: APTOS_MAINNET_CONFIG,
  [COSMOS_HUB_CONFIG.id]: COSMOS_HUB_CONFIG,
  [SOLANA_MAINNET_CONFIG.id]: SOLANA_MAINNET_CONFIG,
  [SUI_MAINNET_CONFIG.id]: SUI_MAINNET_CONFIG,
}

export const CHAIN_CONFIG_LIST: readonly ChainConfigEntry[] = Object.freeze(
  Object.values(CHAIN_CONFIG),
)

export function getChainConfig(chainId: string): ChainConfigEntry | null {
  const raw = chainId.trim()
  const direct = CHAIN_CONFIG[raw]
  if (direct) return direct

  const lower = raw.toLowerCase()
  for (const entry of CHAIN_CONFIG_LIST) {
    if (entry.id.toLowerCase() === lower) return entry
  }

  if (lower === 'aptos:mainnet') return APTOS_MAINNET_CONFIG
  if (lower === 'cosmoshub-4') return COSMOS_HUB_CONFIG
  if (lower === 'sui:35834a8a') return SUI_MAINNET_CONFIG

  return null
}
