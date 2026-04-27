# SKILL-13: 1INCH FUSION DUTCH AUCTION (DNA Layer — MEV-Protected Aggregation)
# Source: github.com/1inch/fusion-sdk (src/fusion-order/fusion-order.ts)
# Scanned: Real FusionOrder class methods extracted — NOT generic
# Priority: DNA-3 (MEV-safe order routing for all Legion swap ops)

## [STRICT_RULES]
```
RULE-13-A: ALWAYS use FusionOrder.new() factory — NEVER construct FusionOrder directly.
            Constructor is protected. new() sets AuctionDetails + Whitelist correctly.
            Source: FusionOrder.ts: static new(settlementExtension, orderInfo, details, extra)

RULE-13-B: Check canExecuteAt(executor, executionTime) BEFORE attempting fill.
            Exclusive resolvers get first-fill rights during exclusivity period.
            Source: FusionOrder.ts: canExecuteAt(executor: Address, executionTime: bigint): boolean

RULE-13-C: Use calcTakingAmount(taker, makingAmount, time, blockBaseFee) for exact output calc.
            Dutch price DECREASES over time. Never use static price — always pass current time.
            Source: FusionOrder.ts: calcTakingAmount(taker, makingAmount, time, blockBaseFee = 0n)

RULE-13-D: Monitor auctionEndTime. Order is dead after endTime — no fills accepted.
            Source: FusionOrder.ts: get auctionEndTime() = startTime + duration

RULE-13-E: getUserReceiveAmount() tells you what user actually gets after ALL fees.
            Never show calcTakingAmount() to user — it does not subtract fees.
            Source: FusionOrder.ts: getUserReceiveAmount(taker, makingAmount, time, blockBaseFee)
```

## [MENTAL_MODEL]
```
1inch Fusion Dutch Auction timeline for Legion:

  t=0 (auctionStartTime)
    Price = startAmount (high — favorable to maker)
    |
  t=exclusivityPeriod
    Only whitelisted resolvers can fill (isExclusiveResolver check)
    |
  t=mid auction
    Price decays linearly toward endAmount
    calcTakingAmount() returns LESS as time increases
    |
  t=auctionEndTime
    Order expires. DEAD. No more fills.

Legion role: act as resolver, fill at optimal price point (balance speed vs margin)
```

## [REAL API — from fusion-order.ts source scan]
```typescript
import { FusionOrder } from '@1inch/fusion-sdk'
import type { Address } from 'viem'

// RULE-13-A: factory only
function createFusionOrder(
  settlementExtension: Address,
  makerAsset: Address,
  takerAsset: Address,
  makingAmount: bigint,
  takingAmount: bigint,
  maker: Address,
  auctionStartTime: bigint,
  auctionDuration: number, // seconds
  exclusiveResolver?: Address
) {
  return FusionOrder.new(
    settlementExtension,
    {
      makerAsset,
      takerAsset,
      makingAmount,
      takingAmount,
      maker,
      salt: BigInt(Date.now())
    },
    {
      auction: {
        startTime: auctionStartTime,
        duration: auctionDuration,
        startAmount: takingAmount,
        points: [] // linear decay
      },
      whitelist: exclusiveResolver
        ? [{ address: exclusiveResolver, allowFrom: 0n }]
        : []
    }
  )
}

// RULE-13-B: check before fill
function canLegionFill(order: FusionOrder, legionAddress: Address): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (now > order.auctionEndTime) return false // RULE-13-D
  return order.canExecuteAt(legionAddress, now)
}

// RULE-13-C: real-time dutch price
function getCurrentTakingAmount(
  order: FusionOrder,
  taker: Address,
  makingAmount: bigint,
  blockBaseFee: bigint = 0n
): bigint {
  const now = BigInt(Math.floor(Date.now() / 1000))
  return order.calcTakingAmount(taker, makingAmount, now, blockBaseFee)
}

// RULE-13-E: user-facing amount (after fees)
function getUserOutputAmount(
  order: FusionOrder,
  taker: Address,
  makingAmount: bigint
): bigint {
  const now = BigInt(Math.floor(Date.now() / 1000))
  return order.getUserReceiveAmount(taker, makingAmount, now, 0n)
}

// Get EIP-712 signed order hash
function getOrderHash(order: FusionOrder, chainId: number): string {
  return order.getOrderHash(chainId)
}
```

## [LEGION USE CASES]
```
- Swap ops: use Fusion for orders > $5k (MEV protection worth the complexity)
- Small swaps < $5k: direct Uniswap/1inch classic (speed > MEV protection)
- Legion as resolver: bid during exclusivity period for guaranteed margin
- Price monitoring: track calcTakingAmount() every block during auction
```
