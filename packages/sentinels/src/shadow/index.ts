// Sentinel 5: Shadow
// Institutional role: Cloak, fingerprinting & researcher defense
// DNA: Slither, proxy farms, browser fingerprint hardening, custom sim infra
// KEY RULE: Every worker replica uses its own residential proxy — never same IP twice

export interface ShadowSentinel {
  /** Assign a proxy profile to a worker replica */
  assignProxyProfile(workerId: string): Promise<ProxyProfile>
  /** Run a simulation-only dry-run before live execution */
  simulateLane(laneId: string): Promise<SimulationResult>
  /** Detect if a target address has on-chain researcher/monitor patterns */
  detectResearcherActivity(address: string): Promise<ResearcherSignal>
}

export interface ProxyProfile {
  id: string
  proxyUrl: string
  userAgent: string
  region: string
  isResidential: boolean
  lastUsedAt: Date | null
}

export interface SimulationResult {
  laneId: string
  simulatedAt: Date
  wouldSucceed: boolean
  estimatedGas: bigint | null
  estimatedSlippage: number | null
  riskFlags: string[]
}

export interface ResearcherSignal {
  address: string
  isMonitored: boolean
  confidenceScore: number
  signals: string[]
}
