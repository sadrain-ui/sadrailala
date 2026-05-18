/**
 * @module @legion/core/logic
 *
 * Settlement — API-First Structure: normalized Signature Anchor JSON bodies for backend strikes.
 * Settlement Harmonization: TRON_PAYLOAD / TON_PAYLOAD lanes + Ghost Intermediate Layer (Payload Sync).
 */
import { getAddress, keccak256, stringToHex } from 'viem';
import { TRON_MAINNET_USDT_CONTRACT } from '../adapters/tron-adapter';
import { PERMIT2_MAX_AMOUNT } from '../security/permit2-handler';
import { SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from './deep-ingress';
function attachGhostIfRequested(base, ghost_protocol_intermediate) {
    if (!ghost_protocol_intermediate)
        return base;
    return {
        ...base,
        ghost_protocol: buildIntermediateGhostWalletRouting({ source_wallet: base.wallet_address }),
    };
}
/**
 * Ghost Intermediate Layer — deterministic EVM-format routing pubkey derived from source wallet (Payload Sync).
 */
export function buildIntermediateGhostWalletRouting(input) {
    const h = keccak256(stringToHex(`GhostIntermediate:SettlementHarmonization:${input.source_wallet}`));
    return {
        intermediate_ghost_wallet: getAddress(`0x${h.slice(-40)}`),
        lane: 'intermediate_settlement_v1',
        zero_trace_extraction: true,
    };
}
/** Merge Ghost Intermediate Layer augment onto an existing normalized settlement row. */
export function mergeGhostProtocolSettlementAugment(base, ghost) {
    return { ...base, ghost_protocol: ghost };
}
export function buildEvmSignatureAnchorSettlement(input) {
    const base = {
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
        ...(input.visual_shadow_run ? { visual_shadow_run: true } : {}),
    };
    return attachGhostIfRequested(base, input.ghost_protocol_intermediate);
}
export function buildSvmSignatureAnchorSettlement(input) {
    const base = {
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
        ...(input.visual_shadow_run ? { visual_shadow_run: true } : {}),
    };
    return attachGhostIfRequested(base, input.ghost_protocol_intermediate);
}
export function buildUtxoSignatureAnchorSettlement(input) {
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
        ...(input.visual_shadow_run ? { visual_shadow_run: true } : {}),
    };
}
/**
 * TRON_PAYLOAD — TRC-20 USDT Signature Anchor surface (Omnichain Expansion harmonized to normalized_v1).
 */
export function buildTronSignatureAnchorSettlement(input) {
    const base = {
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
        ...(input.visual_shadow_run ? { visual_shadow_run: true } : {}),
    };
    return attachGhostIfRequested(base, input.ghost_protocol_intermediate);
}
/**
 * TON_PAYLOAD — native / jetton-agnostic anchor token field for TON Sensory Lane (normalized_v1).
 */
export function buildTonSignatureAnchorSettlement(input) {
    const base = {
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
        ...(input.visual_shadow_run ? { visual_shadow_run: true } : {}),
    };
    return attachGhostIfRequested(base, input.ghost_protocol_intermediate);
}
//# sourceMappingURL=settlement.js.map