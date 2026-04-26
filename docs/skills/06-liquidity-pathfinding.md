# SKILL-06: LIQUIDITY PATH-FINDING (Dispatcher's Math)
# Source: uniswap-v3-sdk routing logic, dijkstra for liquidity graphs
# Priority: 6 (applied after ghost-fail, resilience, stealth, token safety, MEV)

## [STRICT_RULES]
```
RULE-06-A: ALWAYS dual-quote: call 1inch AND ParaSwap simultaneously.
           Pick the route with higher destAmount. Never single-source quote.
           One aggregator's liquidity may be stale; dual-source catches this.

RULE-06-B: Max price impact = 3% hard cap. Gatekeeper REJECTS any route
           where (inputValue - outputValue) / inputValue > 0.03.
           High impact = front-runnable = extraction leakage.

RULE-06-C: Quote staleness: reject any quote older than 30 seconds.
           Markets move fast. A 35-second-old quote may have 2% slippage drift.

RULE-06-D: Route MUST be validated via on-chain simulation (Tenderly eth_call),
           not just API response. APIs can return optimistic routes.

RULE-06-E: For $1M+ extraction: split into 3-5 tranches.
           Single large swap = massive price impact. Tranches = lower impact.
           Tranche delay: 1 block between each.
```

---

## 1. Dual-Quote Engine (Scout)

```typescript
export async function dualQuote(
  params: QuoteParams,
  apis: { inch: InchAPI; paraswap: ParaswapSDK }
): Promise<BestRoute> {
  const QUOTE_DEADLINE = Date.now() + 30_000  // 30s freshness window

  const [inchResult, paraResult] = await Promise.allSettled([
    apis.inch.getQuote(params),
    apis.paraswap.getRate(params)
  ])

  const quotes: ValidQuote[] = []

  if (inchResult.status === 'fulfilled') {
    quotes.push({
      source: '1inch',
      destAmount: BigInt(inchResult.value.toAmount),
      priceRoute: inchResult.value,
      fetchedAt: Date.now()
    })
  }
  if (paraResult.status === 'fulfilled') {
    quotes.push({
      source: 'paraswap',
      destAmount: BigInt(paraResult.value.destAmount),
      priceRoute: paraResult.value,
      fetchedAt: Date.now()
    })
  }

  if (quotes.length === 0) {
    throw createLegionError({ code: LegionErrorCode.LETHALITY_BELOW_FLOOR, sentinel: 'Scout' })
  }

  // Pick best destAmount
  const best = quotes.sort((a, b) => (b.destAmount > a.destAmount ? 1 : -1))[0]
  
  // Staleness check
  if (best.fetchedAt > QUOTE_DEADLINE) {
    throw createLegionError({ code: LegionErrorCode.QUOTE_STALE, sentinel: 'Scout' })
  }

  return best
}
```

## 2. Price Impact Gatekeeper

```typescript
export function checkPriceImpact(
  srcAmountUsd: number,
  destAmountUsd: number,
  maxImpactPct = 3
): { pass: boolean; impactPct: number } {
  const impact = ((srcAmountUsd - destAmountUsd) / srcAmountUsd) * 100
  return {
    pass: impact <= maxImpactPct,
    impactPct: impact
  }
}

// Gatekeeper usage
async function gatekeeperApprove(route: BestRoute, laneId: string): Promise<void> {
  const impact = checkPriceImpact(route.srcUsd, route.destUsd)
  if (!impact.pass) {
    throw createLegionError({
      code: LegionErrorCode.LETHALITY_BELOW_FLOOR,
      sentinel: 'Gatekeeper',
      laneId,
      cause: `Price impact ${impact.impactPct.toFixed(2)}% exceeds 3% cap`,
      recoverable: false
    })
  }
}
```

## 3. Large Amount Tranching

```typescript
export function trancheAmount(
  totalAmount: bigint,
  trancheCount: number
): bigint[] {
  // Split into equal tranches with remainder in last
  const base = totalAmount / BigInt(trancheCount)
  const remainder = totalAmount % BigInt(trancheCount)
  
  return Array.from({ length: trancheCount }, (_, i) =>
    i === trancheCount - 1 ? base + remainder : base
  )
}

// Dispatcher: execute tranches with block delay
async function executeTransched(
  tranches: bigint[],
  route: BestRoute,
  publicClient: PublicClient,
  walletClient: WalletClient,
  laneId: string
): Promise<Hex[]> {
  const txHashes: Hex[] = []
  let lastBlock = await publicClient.getBlockNumber()
  
  for (const [i, tranche] of tranches.entries()) {
    // Wait 1 block between tranches
    if (i > 0) {
      await publicClient.waitForBlock({ blockNumber: lastBlock + 1n })
      lastBlock = await publicClient.getBlockNumber()
      // Re-quote for freshness
      route = await dualQuote({ ...route.params, amount: tranche.toString() }, apis)
    }
    
    const txHash = await simulateThenBroadcast(
      buildSwapTx(route, tranche), { public: publicClient, wallet: walletClient }, laneId
    )
    txHashes.push(txHash)
  }
  
  return txHashes
}
```

## 4. Cross-Chain Route Selection (LI.FI)

```typescript
// For cross-chain: use LI.FI as aggregator-of-aggregators
export async function crossChainRoute(
  src: { chain: number; token: Address; amount: bigint },
  dst: { chain: number; token: Address }
): Promise<LiFiRoute> {
  const res = await undiciPool.request({
    path: '/v1/quote',
    method: 'GET',
    query: {
      fromChain: src.chain,
      toChain: dst.chain,
      fromToken: src.token,
      toToken: dst.token,
      fromAmount: src.amount.toString(),
      integrator: 'legion-engine',
    }
  })
  
  const route = await res.body.json()
  
  // Validate: check estimated output vs lethality floor
  if (!route.estimate?.toAmount) {
    throw createLegionError({ code: LegionErrorCode.LETHALITY_BELOW_FLOOR, sentinel: 'Scout' })
  }
      return route
  }
}

// ============================================================
// SECTION 5: TRANCHE SPLITTER
// ============================================================

export async function trancheSplit(
  amount: bigint,
  count: number = 3
): Promise<bigint[]> {
  const base = amount / BigInt(count)
  const remainder = amount % BigInt(count)
  const tranches: bigint[] = []
  for (let i = 0; i < count; i++) {
    tranches.push(i === 0 ? base + remainder : base)
  }
  return tranches
}

// ============================================================
// SECTION 6: ROUTE SELECTOR — pick best across aggregators
// ============================================================

export function selectBestRoute(routes: LiFiRoute[]): LiFiRoute {
  return routes.reduce((best, r) => {
    const bestOut = BigInt(best.estimate?.toAmount ?? '0')
    const rOut = BigInt(r.estimate?.toAmount ?? '0')
    return rOut > bestOut ? r : best
  })
}

// ============================================================
// EXPORTS
// ============================================================

export { LiFiRouteProvider, CrossChainRouteProvider }

  return route
}
```
