/**
 * @file loader.ts
 * @module @legion/core/config
 * @sentinel Gatekeeper & Shadow (Foundation configuration)
 *
 * Central environment configuration loader — Fail-Fast institutional posture.
 *
 * Trident Alignment (Omni-Gatekeeper): `loadConfig()` requires DATABASE_URL,
 * BLOCKCYPHER_API_TOKEN, EVM credentials (EVM_ALCHEMY_KEY or RPC_ETHEREUM_PRIVATE),
 * and SVM RPC (SOLANA_RPC_URL or SOLANA_CHAINSTACK_URL as valid HTTPS JSON-RPC).
 * Missing credentials throw before engine bootstrap — no silent degraded lane.
 *
 * Sovereign Mesh Override — FORCE_ENV_RPC=1 keeps managed providers prioritized
 * over public mesh fallback.
 *
 * GATEKEEPER-07: Zero-Leak Fencing active at bootstrap; key material is never logged.
 *
 * CONTRACT-01: Any stub balances remain BigInt literals (uint256); never Number()
 * on balance fields.
 *
 * SHADOW-04: Loader telemetry uses NDJSON to process.stdout; redact paths enforced.
 */
export type ParsedProxyBinding = {
    readonly url: string;
    readonly host: string;
    readonly user: string | null;
};
/**
 * Proxy Blueprint parser — accepts both full URLs and operator shorthand:
 * `user:pass@host:port` is normalized to `http://user:pass@host:port`.
 */
export declare function parseProxyBinding(raw: string): ParsedProxyBinding | null;
/** Per-chain RPC configuration. `primary` is null when the env var is absent. */
export interface ChainRpcConfig {
    /** Private/authenticated RPC (preferred). null when env var not set. */
    readonly primary: string | null;
    /** Public fallback RPC. Always present (hardcoded defaults). */
    readonly backup: string;
}
/** Bitcoin-specific RPC config (separate auth pattern from EVM/SVM). */
export interface UtxoRpcConfig {
    readonly url: string | null;
}
/**
 * MESH_CONFIG — Hybrid Provisioning Sync.
 *
 * When USE_HYBRID_MODE = true, managed API endpoints become PRIORITY 1.
 * The Sovereign Mesh (public zero-auth nodes) is PRIORITY 2 — Failover
 * Protocol Locked automatically when the managed tier returns 429 or
 * a connection timeout.
 *
 * GATEKEEPER-07: key values are never logged in plain text.
 * CONTRACT-05:   all fields are nullable — absent vars degrade gracefully.
 * UTXO Provider Re-Routed: BlockCypher is the managed UTXO provider (replaces
 *   the previous Blockchair integration).  BCH is unsupported by BlockCypher
 *   and is always served by the Sovereign Mesh.
 */
export interface MeshConfig {
    /**
     * Alchemy API key for EVM chains (ETH, Polygon, Arb, Base, OP).
     * URL pattern: https://{chain}.g.alchemy.com/v2/{key}
     * null when EVM_ALCHEMY_KEY is not set.
     */
    readonly evmAlchemyKey: string | null;
    /**
     * QuickNode / dedicated Solana HTTPS JSON-RPC (`SOLANA_RPC_URL`).
     * null when unset — Scout falls through to Chainstack then sovereign mesh.
     */
    readonly solanaRpcUrl: string | null;
    /**
     * Direct Chainstack RPC endpoint for Solana (SVM family).
     * null when SOLANA_CHAINSTACK_URL is not set.
     */
    readonly solanaChainstackUrl: string | null;
    /**
     * BlockCypher API token for UTXO family (BTC, LTC, DOGE).
     * UTXO Provider Re-Routed: BlockCypher replaces Blockchair as the managed
     * UTXO provider.  BCH is not supported by BlockCypher and always falls back
     * to the Sovereign Mesh.
     * null when BLOCKCYPHER_API_TOKEN is not set.
     */
    readonly blockcypherApiToken: string | null;
    /**
     * Hybrid Provisioning Sync mode toggle.
     * true  → managed API takes PRIORITY 1; Sovereign Mesh is PRIORITY 2.
     * false → Sovereign Mesh only (original behaviour).
     */
    readonly useHybridMode: boolean;
}
/** Full resolved configuration exported by loadConfig(). */
export interface LegionConfig {
    /**
     * Legacy field — always false after Fail-Fast bootstrap (missing credentials abort via thrown Error).
     */
    readonly mockMode: boolean;
    /**
     * FORCE_ENV_RPC=1 — managed provider priority remains active and public mesh
     * is fallback-only, even when strict mesh mode is enabled.
     */
    readonly forceEnvRpc: boolean;
    readonly database: {
        readonly url: string | null;
    };
    readonly rpc: {
        readonly ethereum: ChainRpcConfig;
        readonly polygon: ChainRpcConfig;
        readonly arbitrum: ChainRpcConfig;
        readonly base: ChainRpcConfig;
        readonly optimism: ChainRpcConfig;
        readonly solana: ChainRpcConfig;
        readonly bitcoin: UtxoRpcConfig;
    };
    /** Hybrid Provisioning Sync configuration — managed keys and mode flag. */
    readonly mesh: MeshConfig;
    readonly settlementLanes: {
        readonly solanaRpcUrl: string | null;
        readonly jitoSettlementLaneUrl: string | null;
        readonly jitoBlockEngineUrl: string | null;
    };
    /** Non-fatal warnings accumulated during config load (CONTRACT-05). */
    readonly warnings: ReadonlyArray<string>;
}
/**
 * Loads and validates environment variables. Idempotent — subsequent calls
 * return the same cached object without re-reading process.env.
 *
 * Fail-Fast: missing Trident / DATABASE credentials throw before mock degradation.
 */
export declare function loadConfig(): LegionConfig;
/** Resets the singleton cache. TEST USE ONLY — do not call in production code. */
export declare function _resetConfigCache(): void;
/**
 * LEGION_MOCK_STATE — retained for compatibility; always false after Fail-Fast loader.
 * Missing credentials abort bootstrap via thrown Error instead of degraded operation.
 */
export declare const LEGION_MOCK_STATE: boolean;
//# sourceMappingURL=loader.d.ts.map