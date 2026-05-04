/**
 * @module @legion/core/logic
 *
 * Settlement — API-First Structure: normalized Signature Anchor JSON bodies for backend strikes.
 * Logic Decoupling: any client POSTs these payloads after obtaining signatures out-of-band.
 */

import type { Address } from 'viem'

import { PERMIT2_MAX_AMOUNT } from '../security/permit2-handler.js'

import { SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from './deep-ingress.js'

export type SignatureAnchorChainFamily = 'EVM' | 'SVM' | 'UTXO'

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
  max_allowance: string
  requires_quorum: boolean
  visual_shadow_run?: true
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
  requires_quorum: boolean
  visual_shadow_run?: boolean
}): NormalizedSignatureAnchorSettlement {
  return {
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
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: input.requires_quorum,
    ...(input.visual_shadow_run ? { visual_shadow_run: true as const } : {}),
  }
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
  requires_quorum: boolean
  visual_shadow_run?: boolean
}): NormalizedSignatureAnchorSettlement {
  return {
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
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: input.requires_quorum,
    ...(input.visual_shadow_run ? { visual_shadow_run: true as const } : {}),
  }
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
    max_allowance: String(PERMIT2_MAX_AMOUNT),
    requires_quorum: input.requires_quorum,
    ...(input.visual_shadow_run ? { visual_shadow_run: true as const } : {}),
  }
}
