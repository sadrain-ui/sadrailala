// Sentinel 4: Dispatcher
// Institutional role: Ghost execution & private lane routing
// DNA: Flashbots Protect, MEV-Share, private RPCs, LayerZero-style relayers
// KEY RULE: If primary RPC latency > 200ms → binary-switch to backup ghost lane

import type { Chain } from '@legion/core'
import type { LaneFailoverConfig } from '@legion/core'

export interface DispatcherSentinel {
  /** Route an extraction lane to best available ghost lane */
  routeLane(laneId: string, chain: Chain): Promise<RoutingDecision>
  /** Probe RPC health and trigger failover if SLO breached */
  probeAndFailover(config: LaneFailoverConfig): Promise<FailoverResult>
  /** Decompose a portfolio by lethality for optimal execution order */
  decomposeByLethality(positions: unknown[]): LethalityBundle[]
}

export interface RoutingDecision {
  laneId: string
  selectedRpc: string
  isGhostLane: boolean
  latencyMs: number
  failoverUsed: boolean
}

export interface FailoverResult {
  triggered: boolean
  previousRpc: string
  newRpc: string
  reason: string
}

export interface LethalityBundle {
  tier: 'high' | 'mid' | 'dust'
  positions: unknown[]
  estimatedValueUsd: number
  executionPriority: number
}
