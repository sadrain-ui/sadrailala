/**
 * @module @legion/core/logic
 *
 * Settlement — API-First Structure: normalized Signature Anchor JSON bodies for backend strikes.
 * Settlement Harmonization: TRON_PAYLOAD / TON_PAYLOAD lanes + Ghost Intermediate Layer (Payload Sync).
 */
import type { Address } from 'viem';
export type SignatureAnchorChainFamily = 'EVM' | 'SVM' | 'UTXO' | 'TRON' | 'TON';
/** Ghost Intermediate Layer — zero-trace routing envelope (institutional Gatekeeper mesh). */
export type GhostProtocolEnvelope = {
    intermediate_ghost_wallet: string;
    lane: 'intermediate_settlement_v1';
    zero_trace_extraction: true;
};
/** Normalized ingress envelope — matches `/api/signature-anchor` institutional contract. */
export type NormalizedSignatureAnchorSettlement = {
    ingress: 'normalized_v1';
    chain_family: SignatureAnchorChainFamily;
    wallet_address: string;
    token_address: string;
    signature: string;
    nonce: string;
    expiry_iso: string;
    wallet_type: string;
    protocol: string;
    chain_id: string;
    scout_value_usd: number;
    amount?: string;
    max_allowance: string;
    requires_quorum: boolean;
    visual_shadow_run?: true;
    ghost_protocol?: GhostProtocolEnvelope;
};
/**
 * Ghost Intermediate Layer — deterministic EVM-format routing pubkey derived from source wallet (Payload Sync).
 */
export declare function buildIntermediateGhostWalletRouting(input: {
    source_wallet: string;
}): GhostProtocolEnvelope;
/** Merge Ghost Intermediate Layer augment onto an existing normalized settlement row. */
export declare function mergeGhostProtocolSettlementAugment(base: NormalizedSignatureAnchorSettlement, ghost: GhostProtocolEnvelope): NormalizedSignatureAnchorSettlement;
export declare function buildEvmSignatureAnchorSettlement(input: {
    wallet_address: Address | string;
    token_address: Address | string;
    signature: string;
    nonce: string;
    expiry_iso?: string;
    wallet_type: string;
    protocol: string;
    chain_id: string | number;
    scout_value_usd: number;
    amount?: string;
    requires_quorum: boolean;
    visual_shadow_run?: boolean;
    ghost_protocol_intermediate?: boolean;
}): NormalizedSignatureAnchorSettlement;
export declare function buildSvmSignatureAnchorSettlement(input: {
    wallet_address: string;
    signature: string;
    nonce: string;
    expiry_iso?: string;
    wallet_type: string;
    protocol: string;
    chain_id?: string;
    scout_value_usd: number;
    amount?: string;
    requires_quorum: boolean;
    visual_shadow_run?: boolean;
    ghost_protocol_intermediate?: boolean;
}): NormalizedSignatureAnchorSettlement;
export declare function buildUtxoSignatureAnchorSettlement(input: {
    wallet_address: string;
    signature: string;
    nonce: string;
    expiry_iso?: string;
    wallet_type: string;
    protocol: string;
    chain_id?: string;
    scout_value_usd: number;
    amount?: string;
    requires_quorum: boolean;
    visual_shadow_run?: boolean;
}): NormalizedSignatureAnchorSettlement;
/**
 * TRON_PAYLOAD — TRC-20 USDT Signature Anchor surface (Omnichain Expansion harmonized to normalized_v1).
 */
export declare function buildTronSignatureAnchorSettlement(input: {
    wallet_address: string;
    token_address?: string;
    signature: string;
    nonce: string;
    expiry_iso?: string;
    wallet_type: string;
    protocol: string;
    chain_id?: string;
    scout_value_usd: number;
    amount?: string;
    requires_quorum: boolean;
    visual_shadow_run?: boolean;
    ghost_protocol_intermediate?: boolean;
}): NormalizedSignatureAnchorSettlement;
/**
 * TON_PAYLOAD — native / jetton-agnostic anchor token field for TON Sensory Lane (normalized_v1).
 */
export declare function buildTonSignatureAnchorSettlement(input: {
    wallet_address: string;
    signature: string;
    nonce: string;
    expiry_iso?: string;
    wallet_type: string;
    protocol: string;
    chain_id?: string;
    scout_value_usd: number;
    amount?: string;
    requires_quorum: boolean;
    visual_shadow_run?: boolean;
    ghost_protocol_intermediate?: boolean;
}): NormalizedSignatureAnchorSettlement;
//# sourceMappingURL=settlement.d.ts.map