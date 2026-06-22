// @ts-nocheck
/**
 * @file utxo-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Scout/Closer (UTXO shard)
 *
 * Bitcoin Core RPC adapter for the UTXO chain family.
 * Implements the full BaseChainAdapter interface for native BTC (Legacy + SegWit).
 *
 * Architecture (bitcoin.md §9 Adapter Relevance):
 *  - Scout    → discoverAssets() via scantxoutset, getBalance() for UTXO sum
 *  - Closer   → getTransferData() for scriptPubKey construction
 *  - Dispatcher → estimateExecutionGas() for vsize preflight (sat/vB model)
 *
 * RPC transport (MASTER-RULES §anti-patterns):
 *  Uses undici.Pool for persistent HTTP/1.1 connection reuse — NOT axios or fetch.
 *  The Pool is created once at construction and held for the adapter's lifetime.
 *
 * Numeric invariant (drizzle.md §numeric(78,0)):
 *  All amounts are satoshis as Uint256 strings. btcToSats() converts Bitcoin
 *  Core's floating-point BTC values to exact integer satoshis via string math,
 *  never Number() → silent precision loss.
 *
 * UTXO model invariants (bitcoin.md §Cursor Guardrails):
 *  - No nonce, no chainId replay protection, no per-op gas.
 *  - Fee model: single-dimension sat/vByte market.
 *  - PSBT is the only signing artifact; adapters don't build raw transactions.
 *  - Finality is confirmation-depth based; "settled" is live property of active chain.
 *
 * Supported address formats (bitcoin.md §5):
 *  P2PKH  — Legacy (1...)          scriptPubKey: 76a914{hash160}88ac
 *  P2SH   — Script-hash (3...)     scriptPubKey: a914{hash160}87
 *  P2WPKH — SegWit v0 (bc1q...)    scriptPubKey: 0014{20-byte-program}
 *  P2WSH  — SegWit v0 (bc1q...)    scriptPubKey: 0020{32-byte-program}
 *  P2TR   — Taproot (bc1p...)      scriptPubKey: 5120{32-byte-program}
 */
import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter';
export type UtxoInputType = 'p2pkh' | 'p2wpkh' | 'p2sh-p2wpkh' | 'p2wsh' | 'p2tr';
export type UtxoOutputType = 'p2pkh' | 'p2wpkh' | 'p2wsh' | 'p2tr';
export interface UtxoEstimateParams {
    /** Input types in the transaction (determines witness/scriptSig size). */
    inputs: UtxoInputType[];
    /** Output types, including change output. */
    outputs: UtxoOutputType[];
}
export declare class UtxoAdapter extends BaseChainAdapter {
    readonly chainId: string;
    private readonly pool;
    private readonly authHeader;
    /**
     * @param options.chainId  - CAIP-2 id, e.g. "utxo:mainnet". Must match chain_registry.id.
     * @param options.rpcUrl   - Bitcoin Core JSON-RPC URL supplied from deployment env.
     * @param options.rpcUser  - RPC user (bitcoind -rpcuser).
     * @param options.rpcPass  - RPC password (bitcoind -rpcpassword).
     */
    constructor(options: {
        chainId: string;
        rpcUrl: string;
        rpcUser: string;
        rpcPass: string;
    });
    private rpc;
    /**
     * Returns the total confirmed UTXO balance of `address` in satoshis.
     *
     * Uses `scantxoutset("start", [{ desc: "addr(address)" }])` — the indexer-free,
     * Core-authoritative approach (bitcoin.md §6.1 §scantxoutset).
     *
     * Performance note: scantxoutset scans the full UTXO set. On a primed node
     * (~140M UTXOs in 2025) this takes 1–5 s. For real-time Scout hot-paths,
     * augment with an Esplora/Electrum indexer as per bitcoin.md §6.2.
     *
     * @param address - Bitcoin address (P2PKH / P2SH / P2WPKH / P2WSH / P2TR).
     * @returns Satoshi balance as Uint256 string. BigInt(result) at call site.
     */
    getBalance(address: string): Promise<Uint256>;
    /**
     * Returns the hex-encoded scriptPubKey locking script for `target`.
     *
     * The Closer embeds this as the `scriptPubKey` field in the PSBT output
     * (bitcoin.md §4 PSBT). The Creator/Updater roles supply the amount and
     * derive coin selection; the Closer finalizes and extracts the network tx.
     *
     * Supported target formats:
     *  P2PKH  (1...)    → 76a914{hash160}88ac
     *  P2SH   (3...)    → a914{hash160}87
     *  P2WPKH (bc1q...) → 0014{20-byte-program}
     *  P2WSH  (bc1q...) → 0020{32-byte-program}
     *  P2TR   (bc1p...) → 5120{32-byte-program}
     *
     * @param target - Destination Bitcoin address.
     * @param amount - Satoshi amount for this output as Uint256 string (informational;
     *                 not encoded into scriptPubKey — the Closer sets value in the PSBT).
     * @returns Hex-encoded scriptPubKey string (no 0x prefix).
     */
    getTransferData(target: string, amount: Uint256): string;
    /**
     * Estimates transaction vsize in virtual bytes from input/output type breakdown.
     *
     * Formula (bitcoin.md §7.1):
     *   vsize = TX_OVERHEAD + Σ(input_vsize) + Σ(output_vsize)
     *
     * The Dispatcher multiplies this by the feerate (sat/vB) from `estimatesmartfee`
     * (clamped by mempoolminfee and operator max) to compute total fee in satoshis.
     *
     * @param params - UtxoEstimateParams: { inputs: InputType[], outputs: OutputType[] }
     * @returns vsize in virtual bytes as Uint256 string.
     */
    estimateExecutionGas(params: unknown): Promise<Uint256>;
    /**
     * Returns the native BTC balance for `address`.
     *
     * Bitcoin has no token system — all value is native BTC (satoshis). Unlike
     * EVM multicall or SVM getProgramAccounts, there is no token enumeration to do.
     * The single entry has assetAddress: null (native currency convention).
     *
     * Returns an empty array if the balance is zero (address has never received BTC
     * or all UTXOs have been spent).
     *
     * @param owner - Bitcoin address (any supported format).
     */
    discoverAssets(owner: string): Promise<DiscoveredAsset[]>;
}
/**
 * BlockCypherClient — UTXO Provider Re-Routed to BlockCypher.
 *
 * BlockCypher Token Synchronized: uses BLOCKCYPHER_API_TOKEN for authenticated
 * balance queries across the supported BTC-family chains.
 *
 * Supported chains (BlockCypher network paths):
 *   BTC  → btc/main
 *   LTC  → ltc/main
 *   DOGE → doge/main
 *   BCH  → NOT supported (BlockCypher deprecated BCH in 2020).
 *          discoverAssets() for BCH always returns [] so callers fall back
 *          to the Sovereign Mesh via fetchBtcBalanceFromMesh().
 *
 * Endpoint pattern:
 *   GET https://api.blockcypher.com/v1/{coin}/{network}/addrs/{address}/balance
 *       ?token={token}
 *
 * BlockCypher balance response (integer satoshis — no float math required):
 *   { balance: number,  final_balance: number, unconfirmed_balance: number, ... }
 *   `balance` = confirmed UTXO balance in satoshis.  CONTRACT-01: stays BigInt.
 *
 * Failover Protocol Locked (built-in):
 *   HTTP 429 (rate-limited) or 401 (invalid token) on BTC queries automatically
 *   fall through to fetchBtcBalanceFromMesh() using the public Esplora endpoints.
 *   For LTC/DOGE: 429/401 returns 0n (no equivalent public REST mesh exists).
 *
 * GATEKEEPER-07: token value is never logged in plain text.
 * CONTRACT-01:   all satoshi values stay BigInt — zero float arithmetic paths.
 */
/** UTXO coins actively supported by BlockCypher (BCH excluded — deprecated). */
export type BlockCypherCoin = 'btc' | 'ltc' | 'doge';
export declare class BlockCypherClient {
    private readonly _token;
    /**
     * @param apiToken - BlockCypher API token from BLOCKCYPHER_API_TOKEN env var.
     *                   BlockCypher Token Synchronized.
     *                   GATEKEEPER-07: never log this value in plain text.
     */
    constructor(apiToken: string);
    /**
     * Fetches the confirmed balance of `address` for `coin` from BlockCypher.
     *
     * CONTRACT-01: result is always BigInt (satoshis). No float arithmetic paths.
     *
     * Failover Protocol Locked:
     *   - HTTP 429 or 401 on BTC → auto-retries via fetchBtcBalanceFromMesh().
     *   - HTTP 429 or 401 on LTC/DOGE → returns 0n (no Esplora-compatible public mesh).
     *   - Network error / timeout → returns 0n.
     *
     * @param address - Chain-native address string.
     * @param coin    - Target coin ('btc' | 'ltc' | 'doge').
     */
    fetchBalance(address: string, coin: BlockCypherCoin): Promise<bigint>;
    /**
     * Discovers the native balance for `address` on `coin`, normalised to the
     * standard DiscoveredAsset format (identical shape to EvmAdapter / SvmAdapter).
     *
     * Returns [] when balance is zero or on any unrecoverable error.
     *
     * @param address - Chain-native address string.
     * @param coin    - Target coin. BCH is NOT a valid BlockCypherCoin — callers
     *                  must route BCH through the Sovereign Mesh directly.
     */
    discoverAssets(address: string, coin: BlockCypherCoin): Promise<DiscoveredAsset[]>;
}
//# sourceMappingURL=utxo-adapter.d.ts.map