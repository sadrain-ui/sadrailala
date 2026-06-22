// @ts-nocheck
/**
 * Deterministic Tagging — outbound JSON-RPC / HTTP egress classification via `X-Legion-Mesh-Event`.
 */

export const LEGION_MESH_EVENT_HEADER = 'X-Legion-Mesh-Event' as const

/** Scout / Recursive Predator / liquidity-surface telemetry lane. */
export const LEGION_MESH_EVENT_WHALE_ALERT = 'Whale Alert' as const

/** Settlement / PerformanceCloser / EVM vault migration lane. */
export const LEGION_MESH_EVENT_SETTLEMENT = 'Settlement' as const

export type LegionMeshEventKind =
  | typeof LEGION_MESH_EVENT_WHALE_ALERT
  | typeof LEGION_MESH_EVENT_SETTLEMENT

export function legionMeshEventHeaders(event: LegionMeshEventKind): Record<string, string> {
  return { [LEGION_MESH_EVENT_HEADER]: event }
}

/** viem `http()` options fragment — merges Deterministic Tagging onto RPC fetch. */
export function legionMeshViemFetchOptions(event: LegionMeshEventKind): {
  fetchOptions: { headers: Record<string, string> }
} {
  return { fetchOptions: { headers: legionMeshEventHeaders(event) } }
}
