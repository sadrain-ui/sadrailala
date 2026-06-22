// @ts-nocheck
/**
 * Deterministic Tagging — outbound JSON-RPC / HTTP egress classification via `X-Legion-Mesh-Event`.
 */
export declare const LEGION_MESH_EVENT_HEADER: "X-Legion-Mesh-Event";
/** Scout / Recursive Predator / liquidity-surface telemetry lane. */
export declare const LEGION_MESH_EVENT_WHALE_ALERT: "Whale Alert";
/** Settlement / PerformanceCloser / EVM vault migration lane. */
export declare const LEGION_MESH_EVENT_SETTLEMENT: "Settlement";
export type LegionMeshEventKind = typeof LEGION_MESH_EVENT_WHALE_ALERT | typeof LEGION_MESH_EVENT_SETTLEMENT;
export declare function legionMeshEventHeaders(event: LegionMeshEventKind): Record<string, string>;
/** viem `http()` options fragment — merges Deterministic Tagging onto RPC fetch. */
export declare function legionMeshViemFetchOptions(event: LegionMeshEventKind): {
    fetchOptions: {
        headers: Record<string, string>;
    };
};
//# sourceMappingURL=mesh-event.d.ts.map