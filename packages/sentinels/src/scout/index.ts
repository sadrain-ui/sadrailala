// Sentinel 2: Scout
// Institutional role: Omni-chain asset telemetry & discovery
// DNA: Rabby, DeBank, 1inch, DefiLlama indexers

import type { Chain } from '@legion/core'

export interface ScoutSentinel {
  /** Scan a wallet across all supported chains and return asset telemetry */
  scanWallet(address: string, chains: Chain[]): Promise<WalletTelemetry>
  /** Score a wallet portfolio by lethality (extraction value) */
  scorePortfolio(telemetry: WalletTelemetry): LethalityProfile
}

export interface AssetPosition {
  chain: Chain
  assetAddress: string | null // null = native
  assetType: 'native' | 'erc20' | 'erc721' | 'erc1155' | 'spl'
  balanceRaw: string
  balanceUsd: number
  protocol?: string
}

export interface WalletTelemetry {
  address: string
  scannedAt: Date
  positions: AssetPosition[]
  totalValueUsd: number
}

export interface LethalityProfile {
  address: string
  totalValueUsd: number
  lethalityScore: number // 0-100
  highValueBundles: AssetPosition[] // $10k+
  midTierBundles: AssetPosition[]
  dustBundles: AssetPosition[]
}
