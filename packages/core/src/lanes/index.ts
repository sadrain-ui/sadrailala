// Extraction Lane primitives
// Responsible for lane lifecycle management — create, route, expire, failover.

export type LaneStatus = 'active' | 'failed' | 'expired' | 'completed'

export interface LaneFailoverConfig {
  primaryRpc: string
  backupRpc: string
  latencyThresholdMs: number // default: 200
}

/**
 * Determines if a lane should failover to the backup ghost lane.
 * Dispatcher sentinel calls this on every health probe.
 */
export function shouldFailover(latencyMs: number, config: LaneFailoverConfig): boolean {
  return latencyMs > config.latencyThresholdMs
}

/**
 * Checks if a signature is still valid given current block and deadline.
 * Implements conditional commitment logic (Closer sentinel).
 */
export function isSignatureValid(currentBlock: bigint, deadlineBlock: bigint | null): boolean {
  if (deadlineBlock === null) return false // no deadline = always invalid in production
  return currentBlock <= deadlineBlock
}
