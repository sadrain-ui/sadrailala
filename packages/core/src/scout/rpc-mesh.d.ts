/**
 * @file rpc-mesh.ts
 * @module @legion/core/scout
 * @sentinel Scout
 *
 * ProviderMesh — Zero-API public endpoint failover layer.
 *
 * Maintains 20 nodes per EVM chain, 4 SVM nodes, 4 UTXO REST providers.
 * Before any scan, a lightweight Health-Ping probes all nodes concurrently;
 * the first live responder becomes primary. Subsequent requests rotate through
 * survivors in priority order.
 *
 * Node Ingestion Locked — all 20+ EVM nodes per chain are zero-auth public
 * endpoints drawn from LlamaNodes, Cloudflare, Ankr, BlockPI, BlastAPI,
 * PublicNode.com, 1RPC, dRPC, Tenderly, Flashbots, MeowRPC, Omnia, ZAN,
 * SubQuery, MEV Blocker, BloXroute, and NodeReal.
 *
 * Mesh Status Signals:
 *   "Omni-Reach Locked"      — every node in the family responded healthy
 *   "Mesh Failover Active"   — primary degraded; backup node serving traffic
 *   "Telemetry Synchronized" — health-ping cycle complete; mesh state updated
 *
 * Health-Ping strategy:
 *   EVM  — eth_blockNumber (JSON-RPC 2.0 POST); result must start with "0x".
 *   SVM  — getHealth (JSON-RPC 2.0 POST); result must equal "ok".
 *   UTXO — block-height GET endpoint per provider; HTTP 200 = healthy.
 *
 * STRICT RULES:
 *   - NO API keys. All endpoints are zero-auth public nodes (SCOUT-MESH-01).
 *   - Health-ping fires before EVERY scan invocation (SCOUT-MESH-02).
 *   - SHADOW-01: jitter between probe retries; never fixed-interval polling.
 *   - CONTRACT-01: block heights stay BigInt through this layer.
 *   - Degraded mesh never throws — falls back to mesh[0] so scans proceed.
 */
export interface TransportPolicyState {
    strictMode: boolean;
    lockThreshold: number;
    zeroApiLock: boolean;
    useManagedEnvProviders: boolean;
}
export declare const EVM_MESH: Readonly<Record<number, readonly string[]>>;
export declare const SVM_MESH: readonly string[];
export declare const UTXO_MESH_ENDPOINTS: readonly string[];
export interface MeshStatus {
    family: 'EVM' | 'SVM' | 'UTXO';
    chainNumericId?: number;
    liveCount: number;
    totalCount: number;
    primaryUrl: string;
    signal: 'Omni-Reach Locked' | 'Mesh Failover Active';
}
export declare function resolveTransportPolicy(nodesActive: number): TransportPolicyState;
export declare class ProviderMesh {
    private readonly evmLive;
    private svmLive;
    private utxoLive;
    private readonly preferredUntil;
    /**
     * Health-Ping all nodes concurrently. Must be called before every scan.
     *
     * Signal "Telemetry Synchronized" is emitted by the caller (AssetScanner)
     * after this method returns. Degraded families fall back to mesh[0] and
     * never throw — scans always proceed even if all pings time out.
     */
    healthPing(): Promise<MeshStatus[]>;
    /** Primary live EVM JSON-RPC URL for the given numeric chain ID. */
    getEvmEndpoint(chainNumericId: number): string;
    /** All live EVM URLs for a chain — drives fallback rotation in EvmAdapter. */
    getEvmFallbacks(chainNumericId: number): string[];
    /** Primary live Solana JSON-RPC URL. */
    getSvmEndpoint(): string;
    /** All live SVM URLs for fallback rotation. */
    getSvmFallbacks(): string[];
    /** Primary live UTXO REST base URL. */
    getUtxoEndpoint(): string;
    /** All live UTXO REST base URLs — used by triple-failover balance fetch. */
    getUtxoFallbacks(): string[];
    /**
     * Total count of live nodes across all protocol families after the last
     * healthPing() cycle.  Used by AssetScanner's Zero-API Lock to determine
     * whether the Sovereign Mesh has enough density to serve all traffic
     * without falling back to hardcoded .env RPC URLs.
     *
     * Counts: EVM live nodes (all chains) + SVM live nodes + UTXO live nodes.
     */
    liveNodeCount(): number;
}
export declare function fetchBtcBalanceFromMesh(address: string, endpoints: string[]): Promise<bigint>;
/**
 * HybridProviderStack — Hybrid Provisioning Sync / Failover Protocol Locked.
 *
 * Provides ordered RPC URL stacks for each protocol family:
 *
 *   PRIORITY 0 (optional): FORCE_ENV_RPC=1 — env private RPC primaries precede managed
 *   PRIORITY 1 (Managed, when USE_HYBRID_MODE): Alchemy (EVM) · Chainstack (SVM)
 *   PRIORITY 2 (Sovereign Mesh): public zero-auth nodes from EVM_MESH / SVM_MESH
 *
 * Failover Protocol Locked:
 *   Callers receive [managedUrl?, ...meshUrls]. Since EvmAdapter's withRpcRotation()
 *   and SvmAdapter's withFallback() both rotate on HTTP 429 / connection timeout,
 *   managed endpoint failure is transparent — the Sovereign Mesh absorbs traffic
 *   instantly without any state change in this layer.
 *
 * Telemetry emitted at construction:
 *   "PROVISIONING_SYNC: [Managed] Active | [Mesh] Standby"
 *
 * When USE_HYBRID_MODE = false (default), all stacks return Sovereign Mesh only —
 * zero-API-key behaviour is preserved (SCOUT-MESH-01).
 *
 * IPv4 Forced / DNS Cache Synchronized: managed endpoints share the same
 * undici Agent (PROBE_AGENT, mesh-ingestor.ts) as the Sovereign Mesh probes.
 * This eliminates the Windows IPv6-first bottleneck on all outbound connections.
 */
export declare class HybridProviderStack {
    private readonly _evmAlchemyKey;
    private readonly _solanaRpcUrl;
    private readonly _solanaChainstackUrl;
    private readonly _blockcypherToken;
    private readonly _hybridMode;
    constructor();
    private _emitProvisioningSync;
    /**
     * Returns ordered EVM RPC stack for `chainNumericId`.
     *
     * Hybrid mode (USE_HYBRID_MODE = true + EVM_ALCHEMY_KEY set):
     *   [alchemyUrl, ...EVM_MESH[chainId]]
     *   Alchemy URL format: https://{chain}.g.alchemy.com/v2/{key}
     *
     * Sovereign Mesh only (default):
     *   [...EVM_MESH[chainId]]
     *
     * Failover Protocol Locked: EvmAdapter's withRpcRotation() naturally rotates
     * from index 0 (Alchemy) to index 1+ (Mesh) on HTTP 429 or connection timeout.
     */
    getEvmStack(chainNumericId: number): string[];
    /**
     * Returns ordered SVM RPC stack.
     *
     * Hybrid mode (USE_HYBRID_MODE = true + SOLANA_RPC_URL and/or SOLANA_CHAINSTACK_URL set):
     *   [SOLANA_RPC_URL QuickNode lane, Chainstack, ...SVM_MESH]
     *   Failover Protocol Locked: SvmAdapter's withFallback() rotates on failure.
     *
     * Sovereign Mesh only (default):
     *   [...SVM_MESH]
     */
    getSvmStack(): string[];
    /**
     * Returns the public UTXO REST endpoint stack (Esplora-compatible providers).
     * BlockCypher is NOT in this list — it is accessed via the `blockcypherToken`
     * getter and the `BlockCypherClient` in utxo-adapter.ts.
     */
    getUtxoStack(): string[];
    /**
     * BlockCypher API token for UTXO family (BTC, LTC, DOGE).
     * UTXO Provider Re-Routed: BlockCypher Token Synchronized when this is non-null.
     * BCH is not supported by BlockCypher; callers should use the public Esplora
     * mesh (getUtxoStack()) for BCH regardless of this token.
     * null when BLOCKCYPHER_API_TOKEN is not set.
     */
    get blockcypherToken(): string | null;
    /** True when Hybrid Provisioning Sync mode is active. */
    get isHybridMode(): boolean;
}
/** Lazily construct HybridProviderStack once (avoids duplicate PROVISIONING_SYNC telemetry). */
export declare function getHybridProviderStack(): HybridProviderStack;
//# sourceMappingURL=rpc-mesh.d.ts.map