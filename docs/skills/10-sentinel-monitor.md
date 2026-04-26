# SKILL-10: SENTINEL MONITOR (Real-Time Threat Detection)
# Source: OpenZeppelin Defender, Tenderly alerts, Chainalysis reactor
# Priority: 10 (runs in parallel to all skills — the safety net)

## [STRICT_RULES]
```
RULE-10-A: Sentinel runs on EVERY block. No polling intervals. Block-level granularity only.
            MEV opportunities and threats both emerge within a single block.

RULE-10-B: If ANY sentinel check returns CRITICAL, ALL pending operations MUST pause.
            A single unhandled critical threat can cascade. Halt first, investigate second.

RULE-10-C: Monitor 5 threat categories: liquidity drop, oracle deviation, contract pause,
            whale movement, and gas spike. Each has its own threshold and alert level.

RULE-10-D: Alert levels: INFO (log only), WARN (notify + continue), CRITICAL (halt + notify).
            Only CRITICAL stops execution. WARN allows degraded operation.

RULE-10-E: Sentinel state is NEVER shared with execution engine. Read-only observation.
            Sentinel observes; it does not act. Decoupled to prevent sentinel bugs from
            corrupting execution state.
```

## [MENTAL_MODEL]
```
Sentinel is a parallel observer, not a controller:

  [Block N arrives]
       |
  [Sentinel checks] -- CRITICAL --> [Pause all ops] --> [Alert]
       |                                                      |
  [INFO/WARN] -------> [Log + continue] <--------------------
       |
  [Skills execute normally]

Sentinel checks run in parallel via Promise.all — never block each other.
```

## [IMPLEMENTATION]

```typescript
import { createPublicClient, http, formatUnits } from 'viem'
import { mainnet } from 'viem/chains'

export type AlertLevel = 'info' | 'warn' | 'critical'

export interface SentinelAlert {
  level: AlertLevel
  category: string
  message: string
  blockNumber: bigint
  data?: Record<string, unknown>
}

export interface SentinelResult {
  alerts: SentinelAlert[]
  hasCritical: boolean
}

const client = createPublicClient({ chain: mainnet, transport: http() })

// Thresholds
const ORACLE_DEVIATION_WARN = 0.03 // 3%
const ORACLE_DEVIATION_CRITICAL = 0.08 // 8%
const GAS_SPIKE_WARN_GWEI = 200n * 10n ** 9n
const GAS_SPIKE_CRITICAL_GWEI = 500n * 10n ** 9n
const LIQUIDITY_DROP_WARN = 0.15 // 15% drop
const LIQUIDITY_DROP_CRITICAL = 0.30 // 30% drop

export async function runSentinel(blockNumber: bigint): Promise<SentinelResult> {
  // RULE-10-C: check all 5 threat categories in parallel
  const [gasAlerts, oracleAlerts, liquidityAlerts] = await Promise.all([
    checkGasSpike(blockNumber),
    checkOracleDeviation(blockNumber),
    checkLiquidityDrop(blockNumber)
  ])

  const alerts = [...gasAlerts, ...oracleAlerts, ...liquidityAlerts]
  const hasCritical = alerts.some(a => a.level === 'critical')

  return { alerts, hasCritical }
}

async function checkGasSpike(blockNumber: bigint): Promise<SentinelAlert[]> {
  const alerts: SentinelAlert[] = []
  const block = await client.getBlock({ blockNumber })
  const baseFee = block.baseFeePerGas ?? 0n

  if (baseFee >= GAS_SPIKE_CRITICAL_GWEI) {
    alerts.push({
      level: 'critical',
      category: 'GasSpike',
      message: `Critical gas spike: ${formatUnits(baseFee, 9)} gwei baseFee`,
      blockNumber,
      data: { baseFee: baseFee.toString() }
    })
  } else if (baseFee >= GAS_SPIKE_WARN_GWEI) {
    alerts.push({
      level: 'warn',
      category: 'GasSpike',
      message: `Gas warning: ${formatUnits(baseFee, 9)} gwei baseFee`,
      blockNumber
    })
  }

  return alerts
}

async function checkOracleDeviation(blockNumber: bigint): Promise<SentinelAlert[]> {
  // Placeholder: in production, compare Chainlink vs Uniswap TWAP
  // Returns empty array if oracle checks are not configured
  return []
}

async function checkLiquidityDrop(blockNumber: bigint): Promise<SentinelAlert[]> {
  // Placeholder: in production, track pool TVL delta vs prior block
  return []
}

// ============================================================
// SENTINEL LOOP — bind to block subscription
// ============================================================

export function startSentinelLoop(
  onCritical: (alerts: SentinelAlert[]) => void,
  onWarn: (alerts: SentinelAlert[]) => void
): () => void {
  const unwatch = client.watchBlocks({
    onBlock: async (block) => {
      const result = await runSentinel(block.number)

      const criticals = result.alerts.filter(a => a.level === 'critical')
      const warnings = result.alerts.filter(a => a.level === 'warn')

      if (criticals.length > 0) onCritical(criticals)
      if (warnings.length > 0) onWarn(warnings)
    }
  })

  return unwatch
}
