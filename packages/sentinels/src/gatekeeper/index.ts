// Sentinel 6: Gatekeeper
// Institutional role: Sovereign command & war-room control
// DNA: DefiLlama data surface, custom admin terminal, policy engine
// KEY RULE: No high-lethality extraction proceeds without Gatekeeper approval

export interface GatekeeperSentinel {
  /** Approve or reject an extraction event */
  evaluateEvent(eventId: string): Promise<GatekeeperDecision>
  /** Trigger global pause across all extraction lanes */
  globalPause(reason: string): Promise<void>
  /** Get current war-room session status */
  getWarRoomStatus(): Promise<WarRoomStatus>
}

export interface GatekeeperDecision {
  eventId: string
  approved: boolean
  reason: string
  approvedBy: string
  approvedAt: Date
  policyId?: string
}

export interface WarRoomStatus {
  activeLanes: number
  globalPaused: boolean
  pauseReason: string | null
  rpcHealthSummary: Record<string, 'healthy' | 'degraded' | 'down'>
  sentinelActivity: Record<string, 'idle' | 'running' | 'error'>
  lastUpdated: Date
}
