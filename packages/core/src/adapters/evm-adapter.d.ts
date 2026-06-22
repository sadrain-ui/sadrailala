// @ts-nocheck
/**
 * @file evm-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Closer (EVM strike execution)
 *
 * Viem-based EVM chain adapter. Handles native ETH and ERC-20 token interactions,
 * gas estimation, and Permit2 / EIP-712 typed-data construction.
 *
 * Execution hardening (viem.md §STRICT_RULES):
 *  - NEVER call writeContract directly. Use simulateContract → request pattern.
 *  - Use encodeFunctionData for all ABI encoding; never raw hex concatenation.
 *  - Transport retry/failover wired at construction (43-viem-core-standard.md).
 *
 * RPC Rotation (SHADOW-01):
 *  On "Internal Error" or HTTP 429 from the primary transport, the adapter
 *  automatically rotates through EVM_PUBLIC_FALLBACKS in order. Jitter is applied
 *  between rotation attempts (no fixed-interval retries). The primary endpoint is
 *  restored as the preferred route after a successful rotation so each instance
 *  self-heals without a restart.
 *
 * Numeric invariant (drizzle.md §numeric(78,0)):
 *  All numeric returns are Uint256 strings. BigInt(result) at call site; NEVER Number().
 *
 * Permit2 reference: docs/research/permit2.md
 *  - Domain separator uses chain numeric ID + universal Permit2 address.
 *  - PermitSingle typed data ready for viem's signTypedData.
 *  - Expiration hardened to 5 minutes per permit2.md §4 Rule 3.
 */
import { type Address, type Chain, type Hex } from 'viem';
import { type LegionMeshEventKind } from '../logic/mesh-event';
import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter';
export declare const EVM_PUBLIC_FALLBACKS: readonly string[];
export declare const PERMIT2_ADDRESS: "0x000000000022D473030F116dDEE9F6B43aC78BA3";
/**
 * EIP-712 typed data structure for a Permit2 PermitSingle signature.
 * Pass the returned object directly to `walletClient.signTypedData()`.
 * Persist the resulting signature in `approval_ledger.signature_data`.
 */
export interface Permit2TypedData {
    domain: {
        name: 'Permit2';
        chainId: number;
        verifyingContract: Address;
    };
    types: {
        PermitDetails: readonly [
            {
                name: 'token';
                type: 'address';
            },
            {
                name: 'amount';
                type: 'uint160';
            },
            {
                name: 'expiration';
                type: 'uint48';
            },
            {
                name: 'nonce';
                type: 'uint48';
            }
        ];
        PermitSingle: readonly [
            {
                name: 'details';
                type: 'PermitDetails';
            },
            {
                name: 'spender';
                type: 'address';
            },
            {
                name: 'sigDeadline';
                type: 'uint256';
            }
        ];
    };
    message: {
        details: {
            token: Address;
            amount: bigint;
            expiration: number;
            nonce: number;
        };
        spender: Address;
        sigDeadline: bigint;
    };
}
export interface EvmEstimateParams {
    from: Address;
    to: Address;
    data?: Hex;
    value?: bigint;
}
export declare class EvmAdapter extends BaseChainAdapter {
    readonly chainId: string;
    private readonly viemChain;
    private readonly tokenAddress;
    private readonly chainNumericId;
    private readonly rpcFallbacks;
    /**
     * Primary viem client. Created from `options.rpcUrl` with retryCount:3.
     * On rotatable errors, withRpcRotation() builds single-retry clients for each
     * fallback URL rather than sharing this instance.
     */
    private readonly client;
    private readonly meshEventKind;
    /**
     * @param options.chainId        - CAIP-2 id, e.g. "evm:1". Must match chain_registry.id.
     * @param options.viemChain      - Viem Chain object (mainnet, polygon, arbitrum, …).
     * @param options.rpcUrl         - Primary RPC endpoint; retries wired automatically.
     * @param options.tokenAddress   - ERC-20 contract address. Omit for native ETH operations.
     * @param options.rpcFallbacks   - Additional RPC URLs tried in order on 429 / InternalError.
     *                                 Defaults to EVM_PUBLIC_FALLBACKS (Ankr, Flashbots, …).
     * @param options.meshEventKind  - Deterministic Tagging lane (Scout vs Settlement). Defaults to Settlement.
     */
    constructor(options: {
        chainId: string;
        viemChain: Chain;
        rpcUrl: string;
        tokenAddress?: Address;
        rpcFallbacks?: string[];
        meshEventKind?: LegionMeshEventKind;
    });
    /**
     * Builds a lightweight single-retry viem client bound to a specific RPC URL.
     * Used exclusively by withRpcRotation() for fallback attempts.
     */
    private buildFallbackClient;
    /**
     * Executes `fn` against the primary client. On a rotatable error (429 /
     * "Internal Error"), tries each entry in rpcFallbacks in order with jitter
     * between attempts (SHADOW-01). Re-throws the last error when all endpoints fail.
     *
     * Non-rotatable errors (e.g. invalid address, GatekeeperError) bypass rotation
     * and propagate immediately — retrying those would be wasteful.
     *
     * CONTRACT-05: callers wrap the result in LegionError on complete failure.
     */
    private withRpcRotation;
    /**
     * Returns the native ETH or ERC-20 balance of `address` as a Uint256 string.
     * Uses `getBalance` for native; `balanceOf` for ERC-20 — no Number() casts.
     *
     * RPC Rotation: automatically retries on 429 / "Internal Error" across
     * EVM_PUBLIC_FALLBACKS before surfacing the error to the caller.
     */
    getBalance(address: string): Promise<Uint256>;
    /**
     * Returns ABI-encoded calldata for an ERC-20 transfer, or '0x' for native ETH.
     * The Closer sets the `value` field separately for native ETH transfers.
     */
    getTransferData(target: string, amount: Uint256): string;
    /**
     * Estimates gas for an EVM transaction.
     * @param params - EvmEstimateParams: { from, to, data?, value? }
     * @returns Gas units as Uint256 string.
     *
     * RPC Rotation: retries on 429 / "Internal Error" before propagating.
     */
    estimateExecutionGas(params: unknown): Promise<Uint256>;
    /**
     * Discovers all non-zero assets held by `owner` on this EVM chain.
     *
     * Strategy: single viem multicall batches `balanceOf` across every token in
     * KNOWN_EVM_TOKENS[chainId] in one RPC round-trip. Native ETH balance is fetched
     * separately (multicall3 does not expose ETH balances). Results with balance == 0
     * are filtered out.
     *
     * allowFailure: true — non-standard ERC-20s that revert on balanceOf don't
     * abort the entire discovery. The Gatekeeper inspects the result before striking.
     *
     * @param owner - EVM address (0x-hex). Throws GatekeeperError if malformed.
     * @returns Non-zero DiscoveredAsset array, native ETH first (if non-zero).
     */
    discoverAssets(owner: string): Promise<DiscoveredAsset[]>;
    /**
     * Builds the EIP-712 typed data for a Permit2 PermitSingle signature.
     *
     * Usage:
     *   ```ts
     *   const typedData = adapter.buildPermit2Data({ ... })
     *   const sig = await walletClient.signTypedData(typedData)
     *   // → persist sig in approval_ledger.signature_data
     *   ```
     *
     * Expiration: defaults to `now + 300s` (5 min) per permit2.md §4 Rule 3
     * (minimise toxic-signature exposure on JIT extractions).
     *
     * @param options.tokenAddress     - ERC-20 token to permit.
     * @param options.spender          - Our vault / operator address receiving the allowance.
     * @param options.amount           - Permitted amount (bigint; use MAX_UINT160 for infinite).
     * @param options.nonce            - Unused nonce from the Permit2 nonce bitmap.
     * @param options.sigDeadline      - Unix timestamp (bigint) after which the sig is invalid.
     * @param options.expirationSecs   - On-chain allowance window in seconds (default 300).
     */
    buildPermit2Data(options: {
        tokenAddress: Address;
        spender: Address;
        amount: bigint;
        nonce: number;
        sigDeadline: bigint;
        expirationSecs?: number;
    }): Permit2TypedData;
}
//# sourceMappingURL=evm-adapter.d.ts.map