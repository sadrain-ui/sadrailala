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
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://eth-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: 'https://eth.llamarpc.com',
    isGhostLane: true,
    latencyThresholdMs: 500,
    blockTimeMs: 12_000,
  },
  {
    chain: 'solana',
    primaryRpc: process.env['SOLANA_CHAINSTACK_URL'] ?? '',
    backupRpc: 'https://api.mainnet-beta.solana.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 400,
  },
  {
    chain: 'polygon',
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://polygon-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: 'https://polygon.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 2_000,
  },
  {
    chain: 'arbitrum',
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://arb-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: 'https://arbitrum.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 250,
  },
  {
    chain: 'base',
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://base-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: 'https://base.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 2_000,
  },
  {
    chain: 'optimism',
    primaryRpc: process.env['EVM_ALCHEMY_KEY']
      ? `https://opt-mainnet.g.alchemy.com/v2/${process.env['EVM_ALCHEMY_KEY']}`
      : '',
    backupRpc: 'https://optimism.publicnode.com',
    isGhostLane: false,
    latencyThresholdMs: 500,
    blockTimeMs: 2_000,
  },
]
