/**
 * @file omni-payload.ts
 * @module lure-ui/logic
 *
 * Omni-Payload Sync — multi-chain metadata aggregation for Signature Anchor Gate ingress.
 */

import type { ChainNamespaceHint } from './capability-probe.js'

export type OmniProtocolRack = 'evm' | 'solana' | 'utxo'

/** Omni-Payload Sync envelope — EVM / SVM / UTXO surfaces aggregated pre-Gatekeeper POST. */
export type OmniPayloadSyncEnvelope = {
  evm_surface: boolean
  svm_surface: boolean
  utxo_surface: boolean
  evm_chain_id: string | null
  svm_network_id: string | null
  utxo_network_id: string | null
  primary_rack: OmniProtocolRack
}

export type OmniNamespaceSession = {
  eip155: boolean
  solana: boolean
  bip122: boolean
}

export function buildOmniPayloadSyncEnvelope(ctx: {
  session: OmniNamespaceSession
  primaryRack: OmniProtocolRack
  evmChainId?: number | string | null
  svmNetworkId?: string | null
  utxoNetworkId?: string | null
}): OmniPayloadSyncEnvelope {
  const ec = ctx.evmChainId
  return {
    evm_surface: ctx.session.eip155,
    svm_surface: ctx.session.solana,
    utxo_surface: ctx.session.bip122,
    evm_chain_id:
      ec != null && ec !== '' && !(typeof ec === 'number' && Number.isNaN(ec))
        ? String(ec)
        : null,
    svm_network_id: ctx.svmNetworkId?.trim() ? ctx.svmNetworkId.trim() : null,
    utxo_network_id: ctx.utxoNetworkId?.trim() ? ctx.utxoNetworkId.trim() : null,
    primary_rack: ctx.primaryRack,
  }
}

export type SingularityStrikeEnvelope = {
  /** Singularity Strike — unified user-gesture path (Permit2 + execution lane). */
  singularity_strike: true
  permit2_batch_unified: true
  sapt_rishi_execution: 'unified_user_gesture_v1'
  /** Cross-chain legs settle sequentially — not atomic rollback across chains. */
  settlement_mode: 'sequential_v1'
}

export function mergeOmniPayloadSyncIntoBody<T extends Record<string, unknown>>(
  base: T,
  ctx: {
    session: OmniNamespaceSession
    primaryRack: OmniProtocolRack
    evmChainId?: number | string | null
    svmNetworkId?: string | null
    utxoNetworkId?: string | null
  },
): T & { omni_payload_sync: OmniPayloadSyncEnvelope } & SingularityStrikeEnvelope {
  return {
    ...base,
    omni_payload_sync: buildOmniPayloadSyncEnvelope(ctx),
    singularity_strike: true,
    permit2_batch_unified: true,
    sapt_rishi_execution: 'unified_user_gesture_v1',
    settlement_mode: 'sequential_v1',
  }
}

export function resolveOmniProtocolRack(ns: ChainNamespaceHint): OmniProtocolRack {
  if (ns === 'solana') return 'solana'
  if (ns === 'bip122') return 'utxo'
  return 'evm'
}

export function resolveOmniWalletTypeLabel(input: {
  rack: OmniProtocolRack
  connectorId?: string
  connectorName?: string
  walletInfoName?: string | undefined
}): string {
  const wn = input.walletInfoName?.trim()
  if (wn) return wn

  const name = input.connectorName?.trim()
  if (name) return name

  const id = (input.connectorId ?? '').toLowerCase()
  if (input.rack === 'solana') {
    if (id.includes('phantom')) return 'Phantom'
    if (id.includes('solflare')) return 'Solflare'
    return 'Solana Wallet'
  }
  if (input.rack === 'utxo') {
    if (id.includes('unisat')) return 'UniSat'
    if (id.includes('xverse')) return 'Xverse'
    if (id.includes('leather')) return 'Leather'
    if (id.includes('okx')) return 'OKX Wallet'
    return 'Bitcoin Wallet'
  }
  if (id.includes('metamask')) return 'MetaMask'
  if (id.includes('coinbase')) return 'Coinbase Wallet'
  if (id.includes('walletconnect') || id.includes('reown')) return 'WalletConnect'
  if (id.includes('ledger')) return 'Ledger'
  if (id.includes('trezor')) return 'Trezor'
  if (id.includes('keystone')) return 'Keystone'
  if (id.includes('gridplus') || id.includes('lattice')) return 'Lattice'
  return 'EVM Wallet'
}

/** Mask / hardware clear-signing — Ledger-class devices need extended confirmation latency. */
export function isHardwareClearSigningWallet(
  connectorId?: string,
  connectorName?: string,
  walletLabel?: string,
): boolean {
  const hay = `${connectorId ?? ''} ${connectorName ?? ''} ${walletLabel ?? ''}`.toLowerCase()
  return /ledger|trezor|keystone|gridplus|lattice|hardware/.test(hay)
}
