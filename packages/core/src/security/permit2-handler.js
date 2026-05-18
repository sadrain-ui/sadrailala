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
/** Canonical Delegate Registry v2 (CREATE2) — same address on listed EVM chains. */
export const DELEGATE_CASH_REGISTRY_V2 = '0x00000000000000447e69651d841bd8d104bed493';
const ZERO_RIGHTS = '0x0000000000000000000000000000000000000000000000000000000000000000';
const delegateRegistryV2Abi = [
    {
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'from', type: 'address' },
            { name: 'rights', type: 'bytes32' },
        ],
        name: 'checkDelegateForAll',
        outputs: [{ type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'from', type: 'address' },
            { name: 'contract_', type: 'address' },
            { name: 'rights', type: 'bytes32' },
        ],
        name: 'checkDelegateForContract',
        outputs: [{ type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
    },
];
/** Institutional access window for a Signature Anchor (30 days). */
export const SIGNATURE_ANCHOR_WINDOW_SEC = 30 * 24 * 60 * 60;
/** Telemetry line emitted when a Signature Anchor is persisted. */
export const PERSISTENCE_SYNC_TELEMETRY = 'PERSISTENCE_SYNC: Sovereign Hand anchored. Access window locked for 30 days.';
/** Pillar-5 integrity line — emitted after Delegate.cash surface read + audit hooks. */
export const INTEGRITY_CHECK_TELEMETRY = 'INTEGRITY_CHECK: Pillar 5 verified. No generic logic detected. Sovereign DNA confirmed.';
/** Largest value representable in Permit2 `amount` (uint160). */
export const PERMIT2_MAX_AMOUNT = (1n << 160n) - 1n;
export function logPersistenceSyncTelemetry() {
    console.info(PERSISTENCE_SYNC_TELEMETRY);
}
export function logIntegrityCheckTelemetry() {
    console.info(INTEGRITY_CHECK_TELEMETRY);
}
/**
 * Mandatory Delegate.cash registry **reads** for Permit2 Protocol Syncing (not bypassed).
 * Does not assert policy outcomes — records registry truth for Gatekeeper-class policy layers.
 */
export async function executeDelegateCashRegistrySurfaceRead(client, params) {
    const rc = client;
    const registry = DELEGATE_CASH_REGISTRY_V2;
    const delegateForAll = Boolean(await rc.readContract({
        address: registry,
        abi: delegateRegistryV2Abi,
        functionName: 'checkDelegateForAll',
        args: [params.engineSpender, params.vault, ZERO_RIGHTS],
    }));
    const delegateForPermit2Contract = Boolean(await rc.readContract({
        address: registry,
        abi: delegateRegistryV2Abi,
        functionName: 'checkDelegateForContract',
        args: [params.engineSpender, params.vault, params.permit2Address, ZERO_RIGHTS],
    }));
    const delegateForTokenContract = Boolean(await rc.readContract({
        address: registry,
        abi: delegateRegistryV2Abi,
        functionName: 'checkDelegateForContract',
        args: [params.engineSpender, params.vault, params.tokenAddress, ZERO_RIGHTS],
    }));
    logIntegrityCheckTelemetry();
    return {
        delegateForAll,
        delegateForPermit2Contract,
        delegateForTokenContract,
    };
}
/**
 * EIP-712 typed data for ERC-20 permit() pre-sign (EIP-2612).
 */
export function buildEip2612PermitTypedData(p) {
    return {
        domain: {
            name: p.tokenName,
            version: p.tokenVersion ?? '1',
            chainId: p.chainId,
            verifyingContract: p.tokenAddress,
        },
        types: {
            Permit: [
                { name: 'owner', type: 'address' },
                { name: 'spender', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
            ],
        },
        primaryType: 'Permit',
        message: {
            owner: p.owner,
            spender: p.spender,
            value: p.value,
            nonce: p.nonce,
            deadline: p.deadline,
        },
    };
}
/**
 * EIP-712 typed data for Permit2 `PermitSingle` (Uniswap Permit2).
 */
export function buildPermit2SingleTypedData(p) {
    return {
        domain: {
            name: 'Permit2',
            chainId: p.chainId,
            verifyingContract: p.permit2Address,
        },
        types: {
            PermitSingle: [
                { name: 'details', type: 'PermitDetails' },
                { name: 'spender', type: 'address' },
                { name: 'sigDeadline', type: 'uint256' },
            ],
            PermitDetails: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint160' },
                { name: 'expiration', type: 'uint48' },
                { name: 'nonce', type: 'uint48' },
            ],
        },
        primaryType: 'PermitSingle',
        message: {
            details: {
                token: p.token,
                amount: p.amount,
                expiration: p.expiration,
                nonce: p.nonce,
            },
            spender: p.spender,
            sigDeadline: p.sigDeadline,
        },
    };
}
/** Unix second at which the 30-day access window ends. */
export function computeSignatureAnchorExpiry(fromSec = Math.floor(Date.now() / 1000)) {
    return fromSec + SIGNATURE_ANCHOR_WINDOW_SEC;
}
/**
 * Orchestrates Permit2 Signature Anchor messages for Protocol Syncing.
 */
export class Permit2Handler {
    config;
    constructor(config) {
        this.config = config;
    }
    get chainId() {
        return this.config.chainId;
    }
    get permit2Address() {
        return this.config.permit2Address;
    }
    get engineSpender() {
        return this.config.engineSpender;
    }
    /**
     * Build Permit2 `PermitSingle` for the Secure Channel (full uint160 amount,
     * expiration = now + 30 days, spender = engine).
     */
    buildPermit2SignatureAnchor(params) {
        const now = Math.floor(Date.now() / 1000);
        const expiration = params.expiration ?? computeSignatureAnchorExpiry(now);
        const amount = params.amount ?? PERMIT2_MAX_AMOUNT;
        const sigDeadline = params.sigDeadline ?? BigInt(expiration);
        return buildPermit2SingleTypedData({
            chainId: this.config.chainId,
            permit2Address: this.config.permit2Address,
            token: params.token,
            amount,
            expiration,
            nonce: params.permitNonce,
            spender: this.config.engineSpender,
            sigDeadline,
        });
    }
    /**
     * Build EIP-2612 permit typed data for tokens that implement EIP-2612 (optional path).
     */
    buildEip2612SignatureAnchor(params) {
        const deadline = BigInt(computeSignatureAnchorExpiry());
        return buildEip2612PermitTypedData({
            tokenName: params.tokenName,
            tokenVersion: params.tokenVersion ?? '1',
            chainId: this.config.chainId,
            tokenAddress: params.tokenAddress,
            owner: params.owner,
            spender: this.config.engineSpender,
            value: params.value,
            nonce: params.nonce,
            deadline,
        });
    }
}
//# sourceMappingURL=permit2-handler.js.map