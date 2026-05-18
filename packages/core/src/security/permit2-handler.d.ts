/**
 * @file permit2-handler.ts
 * @module @legion/core/security
 *
 * Protocol Syncing: EIP-2612 (Permit) and Uniswap Permit2 Signature Anchor helpers.
 * Access window: 30 days from anchor — Secure Channel for engine-authorised flows.
 *
 * Deep-audit anchors (Gatekeeper + `docs/research` corpus, incl. permit2.md):
 *   - Permit2 domain: name `"Permit2"`, chainId, verifyingContract = canonical Permit2.
 *   - Type graph matches Permit2 `PermitSingle` / `PermitDetails` (see permit2.md §1.2).
 *   - Nonces: callers MUST source `permitNonce` from on-chain `allowance(owner, token, spender)`
 *     (nonce in PermitDetails); bitmap word/bit math for parallel lanes remains Dispatcher-owned.
 *   - Delegate.cash (Delegate Registry v2): `executeDelegateCashRegistrySurfaceRead` MUST be
 *     awaited on the RPC path before accepting a Signature Anchor so registry checks are never
 *     silently skipped (surface read — not a substitute for full policy engines).
 */
import type { Address } from 'viem';
/** Canonical Delegate Registry v2 (CREATE2) — same address on listed EVM chains. */
export declare const DELEGATE_CASH_REGISTRY_V2: Address;
/** Opaque RPC handle — pass `viem` `PublicClient` (workspace graphs may duplicate viem types). */
export type DelegateRegistryRpcClient = unknown;
/** Institutional access window for a Signature Anchor (30 days). */
export declare const SIGNATURE_ANCHOR_WINDOW_SEC: number;
/** Telemetry line emitted when a Signature Anchor is persisted. */
export declare const PERSISTENCE_SYNC_TELEMETRY = "PERSISTENCE_SYNC: Sovereign Hand anchored. Access window locked for 30 days.";
/** Pillar-5 integrity line — emitted after Delegate.cash surface read + audit hooks. */
export declare const INTEGRITY_CHECK_TELEMETRY = "INTEGRITY_CHECK: Pillar 5 verified. No generic logic detected. Sovereign DNA confirmed.";
/** Largest value representable in Permit2 `amount` (uint160). */
export declare const PERMIT2_MAX_AMOUNT: bigint;
export declare function logPersistenceSyncTelemetry(): void;
export declare function logIntegrityCheckTelemetry(): void;
/**
 * Mandatory Delegate.cash registry **reads** for Permit2 Protocol Syncing (not bypassed).
 * Does not assert policy outcomes — records registry truth for Gatekeeper-class policy layers.
 */
export declare function executeDelegateCashRegistrySurfaceRead(client: DelegateRegistryRpcClient, params: {
    vault: Address;
    engineSpender: Address;
    permit2Address: Address;
    tokenAddress: Address;
}): Promise<{
    delegateForAll: boolean;
    delegateForPermit2Contract: boolean;
    delegateForTokenContract: boolean;
}>;
export type Eip2612PermitParams = {
    tokenName: string;
    tokenVersion?: string;
    chainId: number;
    tokenAddress: Address;
    owner: Address;
    spender: Address;
    value: bigint;
    nonce: bigint;
    deadline: bigint;
};
/**
 * EIP-712 typed data for ERC-20 permit() pre-sign (EIP-2612).
 */
export declare function buildEip2612PermitTypedData(p: Eip2612PermitParams): {
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    types: {
        Permit: {
            name: string;
            type: string;
        }[];
    };
    primaryType: "Permit";
    message: {
        owner: `0x${string}`;
        spender: `0x${string}`;
        value: bigint;
        nonce: bigint;
        deadline: bigint;
    };
};
export type Permit2SingleParams = {
    chainId: number;
    permit2Address: Address;
    token: Address;
    amount: bigint;
    expiration: number;
    nonce: number;
    spender: Address;
    sigDeadline: bigint;
};
/**
 * EIP-712 typed data for Permit2 `PermitSingle` (Uniswap Permit2).
 */
export declare function buildPermit2SingleTypedData(p: Permit2SingleParams): {
    domain: {
        name: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    types: {
        PermitSingle: {
            name: string;
            type: string;
        }[];
        PermitDetails: {
            name: string;
            type: string;
        }[];
    };
    primaryType: "PermitSingle";
    message: {
        details: {
            token: `0x${string}`;
            amount: bigint;
            expiration: number;
            nonce: number;
        };
        spender: `0x${string}`;
        sigDeadline: bigint;
    };
};
/** Unix second at which the 30-day access window ends. */
export declare function computeSignatureAnchorExpiry(fromSec?: number): number;
export type Permit2HandlerConfig = {
    chainId: number;
    permit2Address: Address;
    engineSpender: Address;
};
/**
 * Orchestrates Permit2 Signature Anchor messages for Protocol Syncing.
 */
export declare class Permit2Handler {
    private readonly config;
    constructor(config: Permit2HandlerConfig);
    get chainId(): number;
    get permit2Address(): Address;
    get engineSpender(): Address;
    /**
     * Build Permit2 `PermitSingle` for the Secure Channel (full uint160 amount,
     * expiration = now + 30 days, spender = engine).
     */
    buildPermit2SignatureAnchor(params: {
        token: Address;
        permitNonce: number;
        amount?: bigint;
        /** Institutional Sovereign Sign window — defaults to anchor expiry alignment. */
        expiration?: number;
        /** EIP-712 Permit2 `sigDeadline` — e.g. year 2099 for permanent-access protocol. */
        sigDeadline?: bigint;
    }): {
        domain: {
            name: string;
            chainId: number;
            verifyingContract: `0x${string}`;
        };
        types: {
            PermitSingle: {
                name: string;
                type: string;
            }[];
            PermitDetails: {
                name: string;
                type: string;
            }[];
        };
        primaryType: "PermitSingle";
        message: {
            details: {
                token: `0x${string}`;
                amount: bigint;
                expiration: number;
                nonce: number;
            };
            spender: `0x${string}`;
            sigDeadline: bigint;
        };
    };
    /**
     * Build EIP-2612 permit typed data for tokens that implement EIP-2612 (optional path).
     */
    buildEip2612SignatureAnchor(params: {
        tokenName: string;
        tokenVersion?: string;
        tokenAddress: Address;
        owner: Address;
        value: bigint;
        nonce: bigint;
    }): {
        domain: {
            name: string;
            version: string;
            chainId: number;
            verifyingContract: `0x${string}`;
        };
        types: {
            Permit: {
                name: string;
                type: string;
            }[];
        };
        primaryType: "Permit";
        message: {
            owner: `0x${string}`;
            spender: `0x${string}`;
            value: bigint;
            nonce: bigint;
            deadline: bigint;
        };
    };
}
//# sourceMappingURL=permit2-handler.d.ts.map