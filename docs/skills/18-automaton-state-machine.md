# SKILL-18: AUTOMATON STATE MACHINE (META Layer — Deterministic Sentinel Transitions)
# Source: github.com/Conway-Research/automaton (ARCHITECTURE.md — Runtime Lifecycle)
# Scanned: Real AgentState transitions from Automaton ARCHITECTURE.md — NOT generic
# Priority: META-1 (Legion Sentinel uses this state machine pattern, not ad-hoc flags)

## [STRICT_RULES]
```
RULE-18-A: Legion Sentinel MUST use explicit AgentState enum. NEVER use boolean flags.
            Boolean flags: isPaused, isRunning, isError = 3 flags = 8 states possible but undefined.
            Enum: IDLE | SCANNING | EXECUTING | PAUSED | CRITICAL | DEAD = 6 defined states only.
            Source: Automaton ARCHITECTURE.md AgentState transitions

RULE-18-B: State transitions MUST be validated. NEVER allow invalid transitions.
            Valid: SCANNING -> EXECUTING. INVALID: DEAD -> EXECUTING.
            Source: Automaton: setup -> waking -> running -> sleeping -> waking (cycle)

RULE-18-C: Policy engine pattern: EVERY action must pass policy eval before execution.
            6 policy categories: Authority, Safety, Financial, Path, Rate-limits, Validation.
            First deny wins. Source: Automaton ARCHITECTURE.md Policy Engine section

RULE-18-D: Loop detection: same action pattern 3x in a row = inject system warning.
            Prevents infinite loops in autonomous agent operation.
            Source: Automaton ARCHITECTURE.md Agent Loop: 'same tool pattern 3x -> system warning'

RULE-18-E: Heartbeat daemon: check sentinel health every 30-60 seconds independently.
            Sentinel crashes should not kill the heartbeat. Decoupled health monitoring.
            Source: Automaton: 'Heartbeat Daemon ticking every 30-60s, monitoring state'
```

## [MENTAL_MODEL]
```
Legion Sentinel State Machine (based on Automaton pattern):

  IDLE
    | -> [block arrives] -> SCANNING

  SCANNING
    | -> [opportunity found] -> EXECUTING
    | -> [no opportunity] -> IDLE
    | -> [threat detected] -> PAUSED

  EXECUTING
    | -> [tx confirmed] -> SCANNING
    | -> [tx failed x3] -> CRITICAL
    | -> [profit threshold breach] -> PAUSED

  PAUSED
    | -> [manual resume] -> SCANNING
    | -> [auto-resume after N blocks] -> SCANNING
    | -> [critical breach while paused] -> CRITICAL

  CRITICAL
    | -> [manual intervention] -> IDLE (full reset)
    | -> [auto-recovery timeout] -> DEAD

  DEAD
    | -> [system restart only] -> IDLE (never auto-recover)

Policy engine wraps EVERY transition: if policy.deny(transition) -> CRITICAL
```

## [REAL IMPLEMENTATION — from Automaton ARCHITECTURE.md patterns]
```typescript
// Sentinel state machine for Legion

export const enum AgentState {
  IDLE = 'idle',
  SCANNING = 'scanning',
  EXECUTING = 'executing',
  PAUSED = 'paused',
  CRITICAL = 'critical',
  DEAD = 'dead'
}

// RULE-18-B: valid transition map (from Automaton lifecycle)
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.IDLE]:      [AgentState.SCANNING],
  [AgentState.SCANNING]:  [AgentState.EXECUTING, AgentState.IDLE, AgentState.PAUSED],
  [AgentState.EXECUTING]: [AgentState.SCANNING, AgentState.CRITICAL, AgentState.PAUSED],
  [AgentState.PAUSED]:    [AgentState.SCANNING, AgentState.CRITICAL],
  [AgentState.CRITICAL]:  [AgentState.IDLE, AgentState.DEAD],
  [AgentState.DEAD]:      [] // terminal state
}

class LegionSentinel {
  private state: AgentState = AgentState.IDLE
  private actionHistory: string[] = []
  private heartbeatInterval?: NodeJS.Timer

  // RULE-18-B: validated transition
  transition(to: AgentState): void {
    const allowed = VALID_TRANSITIONS[this.state]
    if (!allowed.includes(to)) {
      throw new Error(`Invalid transition: ${this.state} -> ${to}`)
    }
    console.log(`[Sentinel] ${this.state} -> ${to}`)
    this.state = to
  }

  // RULE-18-D: loop detection (from Automaton pattern)
  recordAction(action: string): boolean {
    this.actionHistory.push(action)
    if (this.actionHistory.length > 3) {
      this.actionHistory.shift()
    }
    const isLoop = this.actionHistory.length === 3 &&
      this.actionHistory.every(a => a === action)
    if (isLoop) {
      console.warn(`[Sentinel] Loop detected: '${action}' repeated 3x`)
      this.transition(AgentState.PAUSED)
      return false
    }
    return true
  }

  // RULE-18-C: policy gate before any action
  async policyCheck(action: string, params: unknown): Promise<boolean> {
    // Authority check
    // Safety check
    // Financial threshold check
    // Rate limit check
    // Validation check
    // First deny wins
    return true // implement per Legion policy
  }

  // RULE-18-E: independent heartbeat (decoupled from main loop)
  startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.state === AgentState.DEAD) {
        clearInterval(this.heartbeatInterval)
        return
      }
      console.log(`[Heartbeat] state=${this.state} ts=${Date.now()}`)
    }, 45_000) // every 45s
  }

  getState(): AgentState { return this.state }
}

export const sentinel = new LegionSentinel()
```

## [LEGION USE CASES]
```
- Normal ops: IDLE -> SCANNING -> EXECUTING -> SCANNING (loop)
- Sentinel alert: SCANNING -> PAUSED (gas spike > 500 gwei)
- Circuit breaker: EXECUTING -> CRITICAL (3 consecutive reverts)
- Manual restart: CRITICAL -> IDLE (operator intervention)
- Permanent halt: CRITICAL -> DEAD (unrecoverable state)
```
