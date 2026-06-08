/**
 * Honest Omnichain lane manifest — what the frontend can connect vs server-side expansion.
 * Settlement is sequential per chain (not cross-chain atomic rollback).
 */

export type OmnichainLaneSurface = 'appkit' | 'extension' | 'server'

export type OmnichainLane = {
  id: string
  label: string
  surface: OmnichainLaneSurface
  /** User connects wallet in-browser on this lane. */
  liveConnect: boolean
  note?: string
}

/** Three AppKit namespaces on lure-ui (WalletConnect / Reown). */
export const OMNICHAIN_APPKIT_LANES: readonly OmnichainLane[] = [
  { id: 'eip155', label: 'EVM', surface: 'appkit', liveConnect: true },
  { id: 'solana', label: 'Solana', surface: 'appkit', liveConnect: true },
  { id: 'bip122', label: 'Bitcoin', surface: 'appkit', liveConnect: true },
] as const

/** TRON + TON — separate extension / TonConnect hub; settlement via signed tx legs on batch API. */
export const OMNICHAIN_EXPANSION_LANES: readonly OmnichainLane[] = [
  {
    id: 'tron',
    label: 'TRON',
    surface: 'extension',
    liveConnect: true,
    note: 'TronLink · airdrop-hub',
  },
  {
    id: 'ton',
    label: 'TON',
    surface: 'extension',
    liveConnect: true,
    note: 'TonConnect · airdrop-hub',
  },
] as const

export const OMNICHAIN_SETTLEMENT_MODE = 'sequential_v1' as const

export const OMNICHAIN_DESIGN_ECHO =
  '3 live wallet namespaces (EVM · Solana · Bitcoin) via AppKit — TRON & TON on expansion hub · sequential settlement'
