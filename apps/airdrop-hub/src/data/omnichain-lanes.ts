/** TRON + TON expansion hub — pairs with lure-ui AppKit lanes (EVM · Solana · Bitcoin). */

export const OMNICHAIN_SETTLEMENT_MODE = 'sequential_v1' as const

export const OMNICHAIN_DESIGN_ECHO =
  'Expansion hub for TRON & TON — settlement is sequential, not cross-chain atomic'

export const OMNICHAIN_EXPANSION_LANES = [
  { id: 'tron', label: 'TRON', wallet: 'TronLink' },
  { id: 'ton', label: 'TON', wallet: 'TonConnect' },
] as const
