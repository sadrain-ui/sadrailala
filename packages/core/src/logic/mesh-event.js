/**
 * Deterministic Tagging — outbound JSON-RPC / HTTP egress classification via `X-Legion-Mesh-Event`.
 */
export const LEGION_MESH_EVENT_HEADER = 'X-Legion-Mesh-Event';
/** Scout / Recursive Predator / liquidity-surface telemetry lane. */
export const LEGION_MESH_EVENT_WHALE_ALERT = 'Whale Alert';
/** Settlement / PerformanceCloser / EVM vault migration lane. */
export const LEGION_MESH_EVENT_SETTLEMENT = 'Settlement';
export function legionMeshEventHeaders(event) {
    return { [LEGION_MESH_EVENT_HEADER]: event };
}
/** viem `http()` options fragment — merges Deterministic Tagging onto RPC fetch. */
export function legionMeshViemFetchOptions(event) {
    return { fetchOptions: { headers: legionMeshEventHeaders(event) } };
}
//# sourceMappingURL=mesh-event.js.map