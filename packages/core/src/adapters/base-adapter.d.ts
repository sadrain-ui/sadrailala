/**
 * @file base-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Forge (interface contract)
 *
 * Abstract base class defining the mandatory interface every chain-family
 * adapter must implement. Concrete adapters (EVM, SVM, UTXO) extend this.
 *
 * Numeric contract (drizzle.md §numeric(78,0)):
 *   All on-chain quantities returned by adapters are Uint256 strings —
 *   bigint-as-string representation of a 78-digit unsigned integer.
 *   Callers convert via `BigInt(value)`. NEVER call `Number()` on these
 *   values — silent precision loss above 2^53.
 *
 * References:
 *  - docs/research/drizzle.md §numeric(78,0)
 *  - docs/CHAIN-ADAPTER-CONTRACT.md §capability matrix
 */
export type Uint256 = string;
export interface DiscoveredAsset {
    /** Token/mint/contract address. null = native chain asset. */
    assetAddress: string | null;
    /** Raw balance as Uint256 string. Use BigInt(balance) — never Number(). */
    balance: Uint256;
    /** Human-readable symbol when determinable without extra lookups. */
    symbol?: string;
    /** Decimal precision of the token when available. */
    decimals?: number;
}
export declare abstract class BaseChainAdapter {
    /**
     * CAIP-2 chain identity this adapter is bound to.
     * Examples: "evm:1" (Ethereum), "svm:mainnet-beta" (Solana), "utxo:mainnet" (Bitcoin).
     * Must match a row in chain_registry.id.
     */
    abstract readonly chainId: string;
    /**
     * Returns the native or token balance for `address` as a Uint256 string.
     *
     * Unit semantics per family:
     *  - EVM native  : wei (10^-18 ETH)
     *  - EVM ERC-20  : raw token base units (decimals determined by the token)
     *  - SVM native  : lamports (10^-9 SOL)
     *  - SVM SPL     : raw token amount (decimals determined by the mint)
     *  - UTXO native : satoshis (10^-8 BTC)
     *
     * @param address - Polymorphic address string (EVM hex / base58 / bech32).
     * @returns Balance as Uint256 string. Use BigInt(result) — never Number().
     */
    abstract getBalance(address: string): Promise<Uint256>;
    /**
     * Encodes a transfer payload for the underlying chain.
     *
     * Return value semantics per family:
     *  - EVM native  : '0x'          (no calldata; value carries the amount)
     *  - EVM ERC-20  : ABI-encoded calldata for `transfer(address to, uint256 amount)`
     *  - SVM native  : hex-encoded SystemProgram.transfer instruction data bytes
     *  - SVM SPL     : hex-encoded Token Program transfer instruction data bytes
     *  - UTXO        : hex-encoded scriptPubKey locking script for the target address
     *
     * The Closer is responsible for wrapping these bytes into a full transaction
     * with the correct account keys, blockhash, and gas/CU configuration.
     *
     * @param target - Destination address (polymorphic text, never truncated).
     * @param amount - Transfer amount as Uint256 string.
     * @returns Encoded payload string.
     */
    abstract getTransferData(target: string, amount: Uint256): string;
    /**
     * Estimates execution cost in the chain's native resource unit.
     *
     * Return value semantics per family:
     *  - EVM  : gas units (multiply by gasPrice/baseFee for ETH cost)
     *  - SVM  : compute units consumed (add 10% headroom, set via setComputeUnitLimit)
     *  - UTXO : estimated virtual bytes vB (multiply by fee rate sat/vbyte for BTC cost)
     *
     * @param params - Chain-specific estimation parameters (cast internally).
     * @returns Estimated cost as Uint256 string. Use BigInt(result).
     */
    abstract estimateExecutionGas(params: unknown): Promise<Uint256>;
    /**
     * Discovers all assets held by `owner` on this chain.
     *
     * Discovery strategy per family:
     *  - EVM  : multicall probes a hardcoded list of well-known ERC-20 tokens +
     *           native ETH balance. Filters zero-balance results.
     *  - SVM  : getProgramAccounts scans all SPL token accounts owned by the wallet
     *           in one RPC call; batch-fetches mint accounts for decimals.
     *  - UTXO : scantxoutset aggregates all UTXOs for the address into a single
     *           native BTC entry (Bitcoin has no token system).
     *
     * @param owner - Owner address (polymorphic text, not truncated).
     * @returns Array of DiscoveredAsset. Never includes zero-balance entries.
     */
    abstract discoverAssets(owner: string): Promise<DiscoveredAsset[]>;
}
//# sourceMappingURL=base-adapter.d.ts.map