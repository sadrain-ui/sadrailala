/**
 * @file trident-ping.ts
 * @module @legion/core/config
 * @sentinel Gatekeeper — Trident Signal (concurrent managed-RPC verification)
 *
 * Fire-and-forget startup pings: Alchemy (Eth Mainnet), Chainstack (Solana Mainnet),
 * BlockCypher (Bitcoin Mainnet). Isolated from loader.ts to avoid import cycles
 * with rpc-mesh (which calls loadConfig).
 */
export interface TridentPingInput {
    readonly evmAlchemyKey: string | null;
    /** Resolved managed SVM HTTPS endpoint (`SOLANA_RPC_URL` preferred, else `SOLANA_CHAINSTACK_URL`). */
    readonly svmManagedRpcUrl: string | null;
    readonly blockcypherApiToken: string | null;
}
/** Schedule async Trident pings; never throws. */
export declare function scheduleTridentSignalPing(snapshot: TridentPingInput): void;
//# sourceMappingURL=trident-ping.d.ts.map