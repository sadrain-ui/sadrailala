// RPC & Ghost Lane Configuration
// Managed providers are primary; public endpoints are fallback only.
// Dispatcher uses this config for failover decisions.

export interface RpcConfig {
  chain: string
  primaryRpc: string
  backupRpc: string
  isGhostLane: boolean
  latencyThresholdMs: number
  blockTimeMs: number
}

export const RPC_CONFIGS: RpcConfig[] = [
  {
    chain: 'ethereum',
    primaryRpc:
      process.env['RPC_ETHEREUM_PRIVATE'] ??
      (process.env['EVM_ALCHEMY_KEY'] ? `https://eth-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}` : ''),
    backupRpc: process.env['RPC_ETHEREUM_BACKUP'] ?? 'https://eth.llamarpc.com',
    isGhostLane: true,
    latencyThresholdMs: 500,
    blockTimeMs: 12_000,
  },
  {
    chain: 'solana',
    primaryRpc: process.env['SOLANA_RPC_URL'] ?? process.env['SOLANA_CHAINSTACK_URL'] ?? '',
    backupRpc: process.env['RPC_SOLANA_BACKUP'] ?? 'https://api.mainnet-beta.solana.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 400,
  },
  {
    chain: 'aptos',
    primaryRpc:
      process.env['RPC_APTOS_PRIVATE'] ??
      process.env['APTOS_RPC_URL'] ??
      '',
    backupRpc:
      process.env['RPC_APTOS_BACKUP'] ?? 'https://fullnode.mainnet.aptoslabs.com/v1',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 1_000,
  },
  {
    chain: 'sui',
    primaryRpc:
      process.env['RPC_SUI_PRIVATE'] ??
      process.env['SUI_RPC_URL'] ??
      '',
    backupRpc:
      process.env['RPC_SUI_BACKUP'] ?? 'https://fullnode.mainnet.sui.io',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 500,
  },
  {
    chain: 'polygon',
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://polygon-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: process.env['RPC_POLYGON_BACKUP'] ?? 'https://polygon.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 2_000,
  },
  {
    chain: 'arbitrum',
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://arb-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: process.env['RPC_ARBITRUM_BACKUP'] ?? 'https://arbitrum.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 250,
  },
  {
    chain: 'base',
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: process.env['RPC_BASE_BACKUP'] ?? 'https://base.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 2_000,
  },
  {
    chain: 'optimism',
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://opt-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: process.env['RPC_OPTIMISM_BACKUP'] ?? 'https://optimism.publicnode.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 2_000,
  },
]
