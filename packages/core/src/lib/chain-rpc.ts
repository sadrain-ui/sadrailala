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

/** Development-only public RPC fallbacks — never used in production. */
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

/** Solana JSON-RPC — `RPC_SOLANA_PRIVATE` overrides network default. */
export function resolveSolanaRpcUrl(): string {
  const configured =
    readEnv('RPC_SOLANA_PRIVATE') ||
    readEnv('SOLANA_RPC_URL') ||
    readEnv('NEXT_PUBLIC_SOLANA_RPC_URL') ||
    readEnv('SOLANA_CHAINSTACK_URL')
  if (configured) return configured
  return DEFAULT_SOLANA_RPC[resolveSolanaNetwork()]
}

export function getRpcUrlForChainWithFallback(chainId: number): string {
  const configured = getChainRpcMap()[chainId]
  if (configured && configured !== '') {
    return configured
  }

  if (process.env['NODE_ENV'] === 'development') {
    const fallback = PUBLIC_RPC_FALLBACKS[chainId]
    if (fallback) {
      console.warn(`[RPC] Using public fallback for chain ${chainId} (development only)`)
      return fallback
    }
  }

  throw new Error(
    `RPC not configured for chain ${chainId}. Set ${getChainEnvName(chainId)} in environment.`,
  )
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

  const configured = isRpcConfigured(chainId)
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
    isConfigured: configured || (process.env['NODE_ENV'] === 'development' && !!PUBLIC_RPC_FALLBACKS[chainId]),
  }
}
