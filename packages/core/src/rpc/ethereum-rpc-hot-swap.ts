/**
 * Scout — RPC Hot-swapping: primary endpoint measured; backup engaged when latency exceeds threshold.
 */

import {
  LEGION_MESH_EVENT_WHALE_ALERT,
  legionMeshEventHeaders,
} from '../logic/mesh-event.js'

const JSON_RPC_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'eth_blockNumber',
  params: [],
})

/** RPC Hot-swapping — latency ceiling (ms) before evaluating backup endpoints. */
export const RPC_HOT_SWAP_LATENCY_THRESHOLD_MS = 500

async function measureJsonRpcLatencyMs(rpcUrl: string): Promise<number> {
  const t0 = Date.now()
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...legionMeshEventHeaders(LEGION_MESH_EVENT_WHALE_ALERT),
      },
      body: JSON_RPC_BODY,
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return RPC_HOT_SWAP_LATENCY_THRESHOLD_MS + 1
    await res.json().catch(() => null)
    return Date.now() - t0
  } catch {
    return RPC_HOT_SWAP_LATENCY_THRESHOLD_MS + 1
  }
}

/**
 * Resolves Ethereum JSON-RPC URL for Gatekeeper reads — RPC Hot-swapping when primary exceeds threshold.
 */
export async function resolveGatekeeperEthereumRpcUrl(params: {
  primaryUrl: string | undefined
  backupUrl?: string
}): Promise<string> {
  const backup = params.backupUrl ?? process.env['RPC_ETHEREUM_BACKUP']?.trim() ?? ''
  const primary = params.primaryUrl?.trim() ?? ''
  if (!primary) return backup

  const primaryLat = await measureJsonRpcLatencyMs(primary)
  if (primaryLat <= RPC_HOT_SWAP_LATENCY_THRESHOLD_MS) return primary

  const backupLat = await measureJsonRpcLatencyMs(backup)
  if (backupLat < primaryLat) return backup
  return primary
}
