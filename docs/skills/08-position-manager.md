# SKILL-08: POSITION MANAGER (DeFi Position Lifecycle)
# Source: aave-v3-core, uniswap-v3-core, compound-protocol
# Priority: 8 (governs open/close/rebalance of all DeFi positions)

## [STRICT_RULES]
```
RULE-08-A: NEVER hold a position without a defined exit strategy.
            Entry without exit = trapped capital. Define: profit target, stop-loss, time limit.

RULE-08-B: Health factor monitoring on lending positions: alert at 1.5, emergency exit at 1.1.
            Liquidation at HF < 1.0 destroys 5-15% of collateral to the liquidator.

RULE-08-C: Uniswap v3 LP positions: track in-range status every block.
            Out-of-range LP earns zero fees but still holds IL risk.

RULE-08-D: Max single position size: 20% of total portfolio.
            Concentration risk: one bad liquidation should not be fatal.

RULE-08-E: Rebalance trigger: price moves >5% from entry OR time > 24h.
            Stale positions accumulate drift. Proactive rebalance beats reactive emergency.
```

## [MENTAL_MODEL]
```
Position lifecycle:
  OPEN -> ACTIVE -> [REBALANCE loop] -> EXIT
                         |
                    [EMERGENCY_EXIT] on HF breach or stop-loss

Key metrics to track per position:
  - PnL (unrealized)
  - Health factor (lending)
  - In-range status (LP)
  - Time open
  - Gas cost to close
```

## [IMPLEMENTATION]

```typescript
import { Address, formatUnits } from 'viem'
import { createLegionError, LegionErrorCode } from '../errors'

export type PositionType = 'lending' | 'lp' | 'perp' | 'spot'
export type PositionStatus = 'open' | 'active' | 'rebalancing' | 'closed' | 'liquidated'

export interface Position {
  id: string
  type: PositionType
  status: PositionStatus
  protocol: string
  chainId: number
  collateral: { token: Address; amount: bigint }
  debt?: { token: Address; amount: bigint }
  entryPrice: bigint
  currentPrice: bigint
  openedAt: number // block number
  healthFactor?: number // for lending positions
  inRange?: boolean // for LP positions
  profitTarget: bigint // in USD, 18 decimals
  stopLoss: bigint // in USD, 18 decimals
}

export interface PositionStore {
  positions: Map<string, Position>
}

const store: PositionStore = { positions: new Map() }

export function openPosition(pos: Omit<Position, 'status'>): Position {
  // RULE-08-D: enforce 20% max
  const totalValue = getTotalPortfolioValue()
  const posValue = pos.collateral.amount
  if (totalValue > 0n && (posValue * 100n) / totalValue > 20n) {
    throw createLegionError({
      code: LegionErrorCode.POSITION_SIZE_EXCEEDED,
      sentinel: 'PositionManager'
    })
  }

  const position: Position = { ...pos, status: 'open' }
  store.positions.set(pos.id, position)
  return position
}

export function updatePosition(id: string, updates: Partial<Position>): Position {
  const pos = store.positions.get(id)
  if (!pos) throw createLegionError({ code: LegionErrorCode.POSITION_NOT_FOUND, sentinel: 'PositionManager' })

  const updated = { ...pos, ...updates, status: 'active' as PositionStatus }
  store.positions.set(id, updated)
  return updated
}

export function shouldEmergencyExit(pos: Position): boolean {
  // RULE-08-B: health factor
  if (pos.type === 'lending' && pos.healthFactor !== undefined) {
    if (pos.healthFactor < 1.1) return true
  }

  // Stop-loss check
  const pnl = pos.currentPrice - pos.entryPrice
  if (pnl < 0n && (-pnl) >= pos.stopLoss) return true

  return false
}

export function shouldRebalance(pos: Position, currentBlock: number): boolean {
  // RULE-08-C: LP out of range
  if (pos.type === 'lp' && pos.inRange === false) return true

  // RULE-08-E: price moved >5%
  const priceDelta = pos.currentPrice > pos.entryPrice
    ? pos.currentPrice - pos.entryPrice
    : pos.entryPrice - pos.currentPrice
  const fivePercent = (pos.entryPrice * 5n) / 100n
  if (priceDelta > fivePercent) return true

  // Time limit: ~24h at 12s/block = 7200 blocks
  if (currentBlock - pos.openedAt > 7200) return true

  return false
}

export function closePosition(id: string): void {
  const pos = store.positions.get(id)
  if (!pos) throw createLegionError({ code: LegionErrorCode.POSITION_NOT_FOUND, sentinel: 'PositionManager' })
  store.positions.set(id, { ...pos, status: 'closed' })
}

export function getActivePositions(): Position[] {
  return Array.from(store.positions.values()).filter(
    p => p.status === 'open' || p.status === 'active' || p.status === 'rebalancing'
  )
}

function getTotalPortfolioValue(): bigint {
  return Array.from(store.positions.values())
    .filter(p => p.status !== 'closed' && p.status !== 'liquidated')
    .reduce((sum, p) => sum + p.collateral.amount, 0n)
}

// ============================================================
// HEALTH MONITOR (call every block for lending positions)
// ============================================================

export function runHealthCheck(currentBlock: number): Position[] {
  const alerts: Position[] = []
  for (const pos of getActivePositions()) {
    if (shouldEmergencyExit(pos)) {
      alerts.push(pos)
    } else if (pos.type === 'lending' && pos.healthFactor !== undefined && pos.healthFactor < 1.5) {
      // RULE-08-B: alert at 1.5
      alerts.push(pos)
    }
  }
  return alerts
}
