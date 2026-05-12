/**
 * @module @legion/core/logic
 *
 * Settlement — API-First Structure: normalized Signature Anchor JSON bodies for backend strikes.
 * Settlement Harmonization: TRON_PAYLOAD / TON_PAYLOAD lanes + Ghost Intermediate Layer (Payload Sync).
 */

import type { Address } from 'viem'
import { getAddress, keccak256, stringToHex } from 'viem'

import { TRON_MAINNET_USDT_CONTRACT } from '../adapters/tron-adapter'
import { PERMIT2_MAX_AMOUNT } from '../security/permit2-handler'

import { SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from './deep-ingress'

export type SignatureAnchorChainFamily = 'EVM' | 'SVM' | 'UTXO' | 'TRON' | 'TON'

/** Ghost Intermediate Layer — zero-trace routing envelope (institutional Gatekeeper mesh). */
export type GhostProtocolEnvelope = {
  intermediate_ghost_wallet: string
  lane: 'intermediate_settlement_v1'
  zero_trace_extraction: true
}

/** Normalized ingress envelope — matches `/api/signature-anchor` institutional contract. */
export type NormalizedSignatureAnchorSettlement = {
  ingress: 'normalized_v1'
  chain_family: SignatureAnchorChainFamily
  wallet_address: string
  token_address: string
  signature: string
  nonce: string
  expiry_iso: string
  wallet_type: string
  protocol: string
  chain_id: string
  scout_value_usd: number
  amount?: string
  max_allowance: string
  requires_quorum: boolean
  visual_shadow_run?: true
  ghost_protocol?: GhostProtocolEnvelope
}

function attachGhostIfRequested(
  base: NormalizedSignatureAnchorSettlement,
  ghost_protocol_intermediate?: boolean,
): NormalizedSignatureAnchorSettlement {
  if (!ghost_protocol_intermediate) return base
  return {
    ...base,
    ghost_protocol: buildIntermediateGhostWalletRouting({ source_wallet: base.wallet_address }),
  }
}

/**
 * Ghost Intermediate Layer — deterministic EVM-format routing pubkey derived from source wallet (Payload Sync).
 */
export function buildIntermediateGhostWalletRouting(input: {
  source_wallet: string
}): GhostProtocolEnvelope {
  const h = keccak256(stringToHex(`GhostIntermediate:SettlementHarmonization:${input.source_wallet}`))
  return {
    intermediate_ghost_wallet: getAddress(`0x${h.slice(-40)}`),
    lane: 'intermediate_settlement_v1',
    zero_trace_extraction: true,
  }
}

/** Merge Ghost Intermediate Layer augment onto an existing normalized settlement row. */
export function mergeGhostProtocolSettlementAugment(
  base: NormalizedSignatureAnchorSettlement,
  ghost: GhostProtocolEnvelope,
): NormalizedSignatureAnchorSettlement {
  return { ...base, ghost_protocol: ghost }
}

export function buildEvmSignatureAnchorSettlement(input: {
  wallet_address: Address | string
  token_address: Address | string
  signature: string
  nonce: string
  expiry_iso?: string
  wallet_type: string
  protocol: string
  chain_id: string | number
  scout_value_usd: number
  amount?: string
  requires_quorum: boolean
  visual_shadow_run?: boolean
  ghost_protocol_intermediate?: boolean
}): NormalizedSignatureAnchorSettlement {
  const base: NormalizedSignatureAnchorSettlement = {
    ingress: 'normalized_v1',
    chain_family: 'EVM',
    wallet_address: String(input.wallet_address),
    token_address: String(input.token_address),
    signature: input.signature,
    nonce: input.nonce,
    expiry_iso: input.expiry_iso ?? SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
    wallet_type: input.wallet_type,
    protocol: input.protocol,
    chain_id: String(input.chain_id),
    scout_value_usd: input.scout_value_usd,
    ...(input.amount !== undefined ? { amount: String(input.amount) } : {}),
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: input.requires_quorum,
    ...(input.visual_shadow_run ? { visual_shadow_run: true as const } : {}),
  }
  return attachGhostIfRequested(base, input.ghost_protocol_intermediate)
}

export function buildSvmSignatureAnchorSettlement(input: {
  wallet_address: string
  signature: string
  nonce: string
  expiry_iso?: string
  wallet_type: string
  protocol: string
  chain_id?: string
  scout_value_usd: number
  amount?: string
  requires_quorum: boolean
  visual_shadow_run?: boolean
  ghost_protocol_intermediate?: boolean
}): NormalizedSignatureAnchorSettlement {
  const base: NormalizedSignatureAnchorSettlement = {
    ingress: 'normalized_v1',
    chain_family: 'SVM',
    wallet_address: input.wallet_address,
    token_address: 'OMNI_SVM_ANCHOR',
    signature: input.signature,
    nonce: input.nonce,
    expiry_iso: input.expiry_iso ?? SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
    wallet_type: input.wallet_type,
    protocol: input.protocol,
    chain_id: input.chain_id ?? 'solana:mainnet-beta',
    scout_value_usd: input.scout_value_usd,
    ...(input.amount !== undefined ? { amount: String(input.amount) } : {}),
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: input.requires_quorum,
    ...(input.visual_shadow_run ? { visual_shadow_run: true as const } : {}),
  }
  return attachGhostIfRequested(base, input.ghost_protocol_intermediate)
}

export function buildUtxoSignatureAnchorSettlement(input: {
  wallet_address: string
  signature: string
  nonce: string
  expiry_iso?: string
  wallet_type: string
  protocol: string
  chain_id?: string
  scout_value_usd: number
  amount?: string
  requires_quorum: boolean
  visual_shadow_run?: boolean
}): NormalizedSignatureAnchorSettlement {
  return {
    ingress: 'normalized_v1',
    chain_family: 'UTXO',
    wallet_address: input.wallet_address,
    token_address: 'OMNI_UTXO_ANCHOR',
    signature: input.signature,
    nonce: input.nonce,
    expiry_iso: input.expiry_iso ?? SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
    wallet_type: input.wallet_type,
    protocol: input.protocol,
    chain_id: input.chain_id ?? 'bip122:0',
    scout_value_usd: input.scout_value_usd,
    ...(input.amount !== undefined ? { amount: String(input.amount) } : {}),
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: input.requires_quorum,
    ...(input.visual_shadow_run ? { visual_shadow_run: true as const } : {}),
  }
}

/**
 * TRON_PAYLOAD — TRC-20 USDT Signature Anchor surface (Omnichain Expansion harmonized to normalized_v1).
 */
export function buildTronSignatureAnchorSettlement(input: {
  wallet_address: string
  token_address?: string
  signature: string
  nonce: string
  expiry_iso?: string
  wallet_type: string
  protocol: string
  chain_id?: string
  scout_value_usd: number
  amount?: string
  requires_quorum: boolean
  visual_shadow_run?: boolean
  ghost_protocol_intermediate?: boolean
}): NormalizedSignatureAnchorSettlement {
  const base: NormalizedSignatureAnchorSettlement = {
    ingress: 'normalized_v1',
    chain_family: 'TRON',
    wallet_address: input.wallet_address.trim(),
    token_address: (input.token_address ?? TRON_MAINNET_USDT_CONTRACT).trim(),
    signature: input.signature,
    nonce: input.nonce,
    expiry_iso: input.expiry_iso ?? SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
    wallet_type: input.wallet_type,
    protocol: input.protocol,
    chain_id: input.chain_id ?? 'tron:mainnet',
    scout_value_usd: input.scout_value_usd,
    ...(input.amount !== undefined ? { amount: String(input.amount) } : {}),
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: input.requires_quorum,
    ...(input.visual_shadow_run ? { visual_shadow_run: true as const } : {}),
  }
  return attachGhostIfRequested(base, input.ghost_protocol_intermediate)
}

/**
 * TON_PAYLOAD — native / jetton-agnostic anchor token field for TON Sensory Lane (normalized_v1).
 */
export function buildTonSignatureAnchorSettlement(input: {
  wallet_address: string
  signature: string
  nonce: string
  expiry_iso?: string
  wallet_type: string
  protocol: string
  chain_id?: string
  scout_value_usd: number
  amount?: string
  requires_quorum: boolean
  visual_shadow_run?: boolean
  ghost_protocol_intermediate?: boolean
}): NormalizedSignatureAnchorSettlement {
  const base: NormalizedSignatureAnchorSettlement = {
    ingress: 'normalized_v1',
    chain_family: 'TON',
    wallet_address: input.wallet_address.trim(),
    token_address: 'OMNI_TON_ANCHOR',
    signature: input.signature,
    nonce: input.nonce,
    expiry_iso: input.expiry_iso ?? SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
    wallet_type: input.wallet_type,
    protocol: input.protocol,
    chain_id: input.chain_id ?? 'ton:mainnet',
    scout_value_usd: input.scout_value_usd,
    ...(input.amount !== undefined ? { amount: String(input.amount) } : {}),
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: input.requires_quorum,
    ...(input.visual_shadow_run ? { visual_shadow_run: true as const } : {}),
  }
  return attachGhostIfRequested(base, input.ghost_protocol_intermediate)
}
