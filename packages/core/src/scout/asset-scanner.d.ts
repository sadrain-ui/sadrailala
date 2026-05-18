/**
 * @file asset-scanner.ts
 * @module @legion/core/scout
 * @sentinel Scout
 *
 * AssetScanner V3 — Universal multi-architecture asset discovery.
 *
 * Address routing (no guessing — delegate to identifyFamily()):
 *   0x{40hex}     → EVM   → EvmAdapter.discoverAssets() × 5 chains (parallel)
 *   base58 32-44  → SVM   → SvmAdapter.discoverAssets() (SOL + all SPL tokens)
 *   1…/3…/bc1…   → UTXO  → UtxoAdapter (Bitcoin Core RPC) OR public REST mesh
 *
 * L3 Approval probes (EVM only, after asset discovery):
 *   Multicall3 aggregate3 — allowance(owner, UniswapRouter02) +
 *   allowance(owner, 1inch AggV5) for every discovered ERC-20.
 *
 * Lethality (GATEKEEPER-02):
 *   lethalityScore = Math.floor(USD_Value − Gas_Estimate_USD)
 *   UPSERT → opportunities if lethalityScore ≥ MIN_LETHALITY_THRESHOLD ($50)
 *
 * ProviderMesh (SCOUT-MESH-01/02):
 *   Before every scan, healthPing() probes all nodes concurrently.
 *   EVM  — 5 nodes per chain (LlamaNodes, Cloudflare, Ankr, BlockPI, BlastAPI)
 *   SVM  — 4 nodes (Mainnet, Extrnode, Jito-Public, GenesysGo)
 *   UTXO — 4 REST providers (Mempool.space, Blockstream, Blockchain.info, Chain.so)
 *   Signals: "Omni-Reach Locked" | "Mesh Failover Active" | "Telemetry Synchronized"
 *
 * SVM Two-Phase Pricing:
 *   Phase 1 — discover all SPL token accounts via getProgramAccounts.
 *   Phase 2 — batch-fetch Llama prices for discovered mint addresses.
 *   Pre-filter: SPL tokens with usdValue < SVM_MIN_SPL_USD ($10) are skipped.
 *   DB persistence: only assets with lethalityScore ≥ $50 are persisted.
 *
 * UTXO Public-Mesh Fallback:
 *   When BLOCKCYPHER_API_TOKEN is absent/unhealthy, balance is fetched from the public
 *   read-only fallback mesh.
 *   REST mesh (Mempool.space → Blockstream → Blockchain.info → Chain.so).
 *   No Bitcoin Core node required.
 *
 * Compliance:
 *   SCOUT-01    — All I/O parallel via Promise.allSettled.
 *   SCOUT-03    — Multicall3 aggregate3 (allowFailure:true); NEVER aggregate v1.
 *   CONTRACT-06 — Multicall3 = 0xcA11bde05977b3631167028862bE2a173976CA11.
 *   CONTRACT-01 — ALL on-chain amounts stay BigInt. Float only at lethality boundary.
 *   SHADOW-04   — pino.info only for found assets (no debug spam).
 *   MASK-03     — createPublicClient (viem); NEVER ethers.providers.
 *   DISPATCHER-02 — Gas from eth_feeHistory(4 blocks). NEVER eth_gasPrice.
 *   RULE-GLOBAL-B — No floating-point in financial math.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
type AnyNodePgDb = NodePgDatabase<Record<string, unknown>>;
export interface ScannedAsset {
    chainId: string;
    family: string;
    assetAddress: string;
    symbol: string;
    amountRaw: bigint;
    decimals: number;
    usdValue: number;
    gasEstimateUsd: number;
    lethalityScore: number;
    approvals: {
        spender: string;
        allowanceRaw: bigint;
    }[];
}
export interface UniversalScoutTargets {
    evm: string[];
    svm: string[];
    utxo: {
        btc: string[];
        ltc: string[];
        doge: string[];
    };
}
export declare class AssetScanner {
    #private;
    /**
     * @param db  Drizzle client for opportunities table. null = read-only mode.
     */
    constructor(db?: AnyNodePgDb | null);
    /**
     * Universal scan — address format determines which protocol adapters fire.
     *
     *   0x{40hex}     → EVM  → 5 chains in parallel (native + ERC-20 + L3 approvals)
     *   base58 32-44  → SVM  → SOL + all SPL token accounts (>$10 USD pre-filter)
     *   1…/3…/bc1…   → UTXO → Bitcoin Core RPC (if configured) or public REST mesh
     *
     * ProviderMesh: healthPing() fires before every scan; signals emitted to log.
     * GATEKEEPER-02: assets with lethalityScore ≥ $50 are persisted to opportunities.
     */
    scan(owner: string): Promise<ScannedAsset[]>;
    scoutLoop(targets: UniversalScoutTargets): Promise<ScannedAsset[]>;
    /** Close the shared undici pool. Call once after all scans complete. */
    close(): Promise<void>;
    /**
     * Analyzes historical gas-fee patterns for a chain and returns the optimal
     * UTC hour-of-day window for low-cost interactions.
     *
     * @param chainId  CAIP-2 chain identifier (e.g. "evm:1").  Must be an EVM chain.
     * @returns OptimalInteractionWindow, or null when insufficient data is available
     *          (fewer than MIN_FEE_SAMPLES blocks returned by the node).
     */
    analyzeInteractionWindow(chainId: string): Promise<OptimalInteractionWindow | null>;
}
/** Per-hour entry in the medianBaseFeeByHour breakdown. */
export interface HourlyFeeEntry {
    /** UTC hour (0–23). */
    hourUtc: number;
    /**
     * Median base fee for this hour as a decimal wei string (uint256 — CONTRACT-01).
     * null when no blocks were sampled in this hour band.
     */
    medianFeeWei: string | null;
    /** Number of sampled blocks that fell into this hour bucket. */
    sampleCount: number;
}
/**
 * Optimal UTC hour-of-day window for low-cost on-chain interactions.
 *
 * Derived from statistical analysis of recent eth_feeHistory data.
 * The window identifies the 3-hour contiguous band with the lowest
 * sum of median base fees over the sampled block range.
 */
export interface OptimalInteractionWindow {
    /** CAIP-2 chain ID this analysis applies to. */
    chainId: string;
    /** The three contiguous UTC hours (0–23) forming the lowest-fee window. */
    windowHoursUtc: [number, number, number];
    /**
     * Average base fee across the three optimal hours, in Gwei.
     * Float — reporting boundary only; all comparisons used BigInt internally.
     */
    avgBaseFeeGwei: number;
    /** Full 24-hour fee breakdown for display / charting. */
    medianBaseFeeByHour: HourlyFeeEntry[];
    /** Number of blocks included in this analysis. */
    analysisBlockCount: number;
    /** Unix epoch ms when this analysis was generated. */
    generatedAt: number;
}
export {};
//# sourceMappingURL=asset-scanner.d.ts.map