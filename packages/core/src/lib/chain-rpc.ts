import {
  getRpcMesh,
  isRpcCircuitBreakerEnabled,
  resolveAptosRpcFromMesh,
  resolveEvmRpcFromMesh,
  resolveSolanaRpcFromMesh,
  resolveSuiRpcFromMesh,
} from './rpc-mesh.js'

export interface ChainRpcConfig {
  chainId: number
  name: string
  rpcUrl: string
  isConfigured: boolean
}

/** Read env at call time so dotenv loaders run before resolution. */
function readEnv(key: string): string {
  if (typeof process === 'undefined') return ''
  return process.env[key]?.trim() ?? ''
}

export function getChainRpcMap(): Record<number, string> {
  return {
    1:
      readEnv('RPC_ETHEREUM_PRIVATE') ||
      readEnv('RPC_URL') ||
      readEnv('NEXT_PUBLIC_RPC_URL'),
    56: readEnv('RPC_BSC_PRIVATE'),
    97: readEnv('RPC_BSC_TESTNET_PRIVATE'),
    137: readEnv('RPC_POLYGON_PRIVATE'),
    42161: readEnv('RPC_ARBITRUM_PRIVATE'),
    10: readEnv('RPC_OPTIMISM_PRIVATE'),
    8453: readEnv('RPC_BASE_PRIVATE'),
  }
}

/** @deprecated Prefer getChainRpcMap() — evaluated lazily per call. */
export const CHAIN_RPC_MAP: Record<number, string> = new Proxy({} as Record<number, string>, {
  get(_target, prop) {
    const chainId = Number(prop)
    if (!Number.isFinite(chainId)) return undefined
    return getChainRpcMap()[chainId] ?? ''
  },
})

export function getRpcUrlForChain(chainId: number): string {
  const rpc = getChainRpcMap()[chainId]
  if (!rpc || rpc === '') {
    throw new Error(`RPC not configured for chain ${chainId}`)
  }
  return rpc
}

export function isRpcConfigured(chainId: number): boolean {
  const rpc = getChainRpcMap()[chainId]
  return !!rpc && rpc !== ''
}

export function getChainEnvName(chainId: number): string {
  const names: Record<number, string> = {
    1: 'ETHEREUM_PRIVATE',
    56: 'BSC_PRIVATE',
    97: 'BSC_TESTNET_PRIVATE',
    137: 'POLYGON_PRIVATE',
    42161: 'ARBITRUM_PRIVATE',
    10: 'OPTIMISM_PRIVATE',
    8453: 'BASE_PRIVATE',
  }
  return `RPC_${names[chainId] || 'URL'}`
}

/**
 * Secondary (backup) private RPC URLs — tried when the primary `RPC_*_PRIVATE` env var is unset.
 * Env vars: `RPC_ETHEREUM_BACKUP`, `RPC_BSC_BACKUP`, `RPC_POLYGON_BACKUP`, etc.
 */
export function getChainRpcBackupMap(): Record<number, string> {
  return {
    1: readEnv('RPC_ETHEREUM_BACKUP'),
    56: readEnv('RPC_BSC_BACKUP'),
    97: readEnv('RPC_BSC_TESTNET_BACKUP'),
    137: readEnv('RPC_POLYGON_BACKUP'),
    42161: readEnv('RPC_ARBITRUM_BACKUP'),
    10: readEnv('RPC_OPTIMISM_BACKUP'),
    8453: readEnv('RPC_BASE_BACKUP'),
  }
}

/** Public RPC fallbacks — last resort (all environments). Rate-limited; avoid for production traffic. */
export const PUBLIC_RPC_FALLBACKS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  56: 'https://bsc-dataseed.binance.org',
  97: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
  137: 'https://polygon.llamarpc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
}

export type SolanaNetwork = 'mainnet' | 'devnet' | 'testnet'

const DEFAULT_SOLANA_RPC: Record<SolanaNetwork, string> = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
}

/** Solana cluster — `SOLANA_NETWORK` (mainnet | devnet | testnet). Defaults to mainnet. */
export function resolveSolanaNetwork(): SolanaNetwork {
  const raw = readEnv('SOLANA_NETWORK').toLowerCase()
  if (raw === 'devnet' || raw === 'testnet') return raw
  return 'mainnet'
}

/**
 * Solana JSON-RPC — resolution order (Helius / QuickNode first for SPL tier):
 *   HELIUS_SOLANA_URL → RPC_SOLANA_PRIVATE → QUICKNODE_SOLANA_URL → SOLANA_RPC_URL →
 *   NEXT_PUBLIC_SOLANA_RPC_URL → SOLANA_CHAINSTACK_URL → RPC_SOLANA_BACKUP → public default
 */
export function resolveSolanaRpcUrl(): string {
  if (isRpcCircuitBreakerEnabled()) {
    getRpcMesh().refreshChain('solana')
    const active = resolveSolanaRpcFromMesh()
    if (active) return active
  }

  const configured =
    readEnv('HELIUS_SOLANA_URL') ||
    readEnv('RPC_SOLANA_PRIVATE') ||
    readEnv('QUICKNODE_SOLANA_URL') ||
    readEnv('QUICKNODE_SOLANA_RPC_URL') ||
    readEnv('SOLANA_RPC_URL') ||
    readEnv('NEXT_PUBLIC_SOLANA_RPC_URL') ||
    readEnv('SOLANA_CHAINSTACK_URL') ||
    readEnv('RPC_SOLANA_BACKUP')
  if (configured) return configured
  return DEFAULT_SOLANA_RPC[resolveSolanaNetwork()]
}

/**
 * Resolve RPC URL with circuit-breaker mesh (when RPC_CIRCUIT_BREAKER enabled):
 *   primary → backup1 → backup2 → public fallback.
 * Falls back to legacy static resolution when circuit breaker is disabled.
 */
export function getRpcUrlForChainWithFallback(chainId: number): string {
  if (isRpcCircuitBreakerEnabled()) {
    getRpcMesh().refreshChain(`evm:${chainId}`)
    const active = resolveEvmRpcFromMesh(chainId)
    if (active) return active
  }

  const primary = getChainRpcMap()[chainId]
  if (primary && primary !== '') return primary

  const backup = getChainRpcBackupMap()[chainId]
  if (backup && backup !== '') {
    console.warn(`[RPC] Primary unset for chain ${chainId} — using backup RPC`)
    return backup
  }

  const fallback = PUBLIC_RPC_FALLBACKS[chainId]
  if (fallback) {
    console.warn(`[RPC] No private RPC for chain ${chainId} — using public fallback (rate-limited)`)
    return fallback
  }

  throw new Error(
    `RPC not configured for chain ${chainId}. Set ${getChainEnvName(chainId)} in environment.`,
  )
}

const DEFAULT_APTOS_RPC = 'https://fullnode.mainnet.aptoslabs.com/v1'

/**
 * Aptos fullnode REST — resolution order:
 *   RPC_APTOS_PRIVATE → APTOS_RPC_URL → NEXT_PUBLIC_APTOS_RPC_URL → RPC_APTOS_BACKUP → public default
 */
export function resolveAptosRpcUrl(): string {
  if (isRpcCircuitBreakerEnabled()) {
    getRpcMesh().refreshChain('aptos')
    const active = resolveAptosRpcFromMesh()
    if (active) return active
  }

  const configured =
    readEnv('RPC_APTOS_PRIVATE') ||
    readEnv('APTOS_RPC_URL') ||
    readEnv('NEXT_PUBLIC_APTOS_RPC_URL') ||
    readEnv('RPC_APTOS_BACKUP')
  if (configured) return configured
  return DEFAULT_APTOS_RPC
}

export function isAptosRpcConfigured(): boolean {
  return resolveAptosRpcUrl() !== ''
}

const DEFAULT_SUI_RPC = 'https://fullnode.mainnet.sui.io'

/**
 * Sui JSON-RPC — resolution order:
 *   RPC_SUI_PRIVATE → SUI_RPC_URL → NEXT_PUBLIC_SUI_RPC_URL → RPC_SUI_BACKUP → public default
 */
export function resolveSuiRpcUrl(): string {
  if (isRpcCircuitBreakerEnabled()) {
    getRpcMesh().refreshChain('sui')
    const active = resolveSuiRpcFromMesh()
    if (active) return active
  }

  const configured =
    readEnv('RPC_SUI_PRIVATE') ||
    readEnv('SUI_RPC_URL') ||
    readEnv('NEXT_PUBLIC_SUI_RPC_URL') ||
    readEnv('RPC_SUI_BACKUP')
  if (configured) return configured
  return DEFAULT_SUI_RPC
}

export function isSuiRpcConfigured(): boolean {
  return resolveSuiRpcUrl() !== ''
}

export function getChainRpcConfig(chainId: number): ChainRpcConfig {
  const name =
    {
      1: 'Ethereum',
      56: 'BNB Smart Chain',
      97: 'BSC Testnet',
      137: 'Polygon',
      42161: 'Arbitrum One',
      10: 'Optimism',
      8453: 'Base',
    }[chainId] ?? `Chain ${chainId}`

  let rpcUrl = ''
  try {
    rpcUrl = getRpcUrlForChainWithFallback(chainId)
  } catch {
    rpcUrl = ''
  }

  return {
    chainId,
    name,
    rpcUrl,
    isConfigured: rpcUrl !== '',
  }
}
