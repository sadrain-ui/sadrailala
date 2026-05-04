/**
 * @file omni-payload.ts
 * @module lure-ui/logic
 *
 * Omni-Payload: Ingress Dispatcher protocol rack + wallet display labels (Protocol Metadata).
 */

import type { ChainNamespaceHint } from './capability-probe.js'

export type OmniProtocolRack = 'evm' | 'solana' | 'utxo'

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
