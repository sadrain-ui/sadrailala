// RPC & Ghost Lane Configuration
// Each chain has a primary private RPC and a backup public RPC.
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
    primaryRpc: process.env.RPC_ETHEREUM_PRIVATE ?? '',
    backupRpc: process.env.RPC_ETHEREUM_BACKUP ?? 'https://eth.llamarpc.com',
    isGhostLane: true,
    latencyThresholdMs: 200,
    blockTimeMs: 12_000,
  },
  {
    chain: 'solana',
    primaryRpc: process.env.RPC_SOLANA_PRIVATE ?? '',
    backupRpc: process.env.RPC_SOLANA_BACKUP ?? '',
    isGhostLane: false,
    latencyThresholdMs: 100, // Solana is fast — tighter SLO
    blockTimeMs: 400,
  },
  {
    chain: 'polygon',
    primaryRpc: process.env.RPC_POLYGON_PRIVATE ?? '',
    backupRpc: 'https://polygon.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 200,
    blockTimeMs: 2_000,
  },
  {
    chain: 'arbitrum',
    primaryRpc: process.env.RPC_ARBITRUM_PRIVATE ?? '',
    backupRpc: 'https://arbitrum.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 150,
    blockTimeMs: 250,
  },
  {
    chain: 'base',
    primaryRpc: process.env.RPC_BASE_PRIVATE ?? '',
    backupRpc: 'https://base.llamarpc.com',
    isGhostLane: false,
    latencyThresholdMs: 150,
    blockTimeMs: 2_000,
  },
]
