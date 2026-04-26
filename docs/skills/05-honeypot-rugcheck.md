# SKILL-05: HONEYPOT & RUG-CHECK (Shadow's Intuition)
# Source: honeypot-is logic, go-plus-security API patterns
# Priority: 4 (applied after ghost-fail, resilience, stealth — before MEV, liquidity)

## [STRICT_RULES]
```
RULE-05-A: EVERY token MUST pass honeypot check BEFORE Gatekeeper approval.
           No exceptions. Even if Tenderly simulation succeeds, honeypot check
           is mandatory. Simulation doesn't catch sell-disabled traps.

RULE-05-B: Honeypot check = buy simulation + sell simulation on-chain fork.
           If sell simulation reverts → HONEYPOT_DETECTED, abort lane.

RULE-05-C: Go+ Security API result caching: cache per token+chain for 60 seconds.
           Never re-check the same token twice in one extraction sequence.

RULE-05-D: Tax threshold: if buyTax > 10% OR sellTax > 10% → reject token.
           High-tax tokens = economic honeypot even if technically sellable.

RULE-05-E: Blacklist check MUST run BEFORE balance check.
           A blacklisted wallet cannot transfer tokens — dead extraction.
```

---

## 1. Honeypot Detection via Fork Simulation

```typescript
export async function checkHoneypot(
  token: Address,
  chainId: number,
  publicClient: PublicClient
): Promise<HoneypotResult> {
  const WETH = getWethAddress(chainId)
  const ROUTER = getUniswapRouter(chainId)
  const TEST_AMOUNT = parseEther('0.01')  // small test buy

  // Step 1: Simulate BUY
  const buyResult = await publicClient.call({
    to: ROUTER,
    data: encodeBuyCall(WETH, token, TEST_AMOUNT),
    value: TEST_AMOUNT
  })
  
  if (buyResult.error) {
    return { isHoneypot: true, reason: 'BUY_REVERTS', buyTax: 0, sellTax: 0 }
  }
  
  const receivedAmount = decodeBuyResult(buyResult.data!)
  const buyTax = Number((TEST_AMOUNT - receivedAmount) * 10000n / TEST_AMOUNT) / 100

  // Step 2: Simulate SELL of received tokens
  const sellResult = await publicClient.call({
    to: ROUTER,
    data: encodeSellCall(token, WETH, receivedAmount),
    // Simulate from test account that 'has' tokens (state override)
  })
  
  if (sellResult.error) {
    return { isHoneypot: true, reason: 'SELL_REVERTS', buyTax, sellTax: 0 }
  }
  
  const ethReceived = decodeSellResult(sellResult.data!)
  const sellTax = Number((receivedAmount - ethReceived) * 10000n / receivedAmount) / 100

  return {
    isHoneypot: false,
    reason: null,
    buyTax,
    sellTax,
    isSafe: buyTax <= 10 && sellTax <= 10  // Lethality gate: reject if >10% tax
  }
}

type HoneypotResult = {
  isHoneypot: boolean
  reason: 'BUY_REVERTS' | 'SELL_REVERTS' | null
  buyTax: number      // percent
  sellTax: number     // percent
  isSafe?: boolean    // passes lethality threshold
}
```

## 2. Go+ Security API Check

```typescript
export async function goplus SecurityCheck(
  token: Address,
  chainId: number,
  redis: Redis
): Promise<GoPlusResult> {
  const cacheKey = `goplus:${chainId}:${token.toLowerCase()}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const res = await fetch(
    `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${token}`
  )
  const data = await res.json()
  const info = data.result?.[token.toLowerCase()]
  
  if (!info) throw createLegionError({ code: LegionErrorCode.HONEYPOT_DETECTED, sentinel: 'Shadow' })

  const result: GoPlusResult = {
    isHoneypot:        info.is_honeypot === '1',
    isBlacklisted:     info.is_blacklisted === '1',
    isMintable:        info.is_mintable === '1',
    isProxyContract:   info.is_proxy === '1',
    sellTax:           parseFloat(info.sell_tax ?? '0') * 100,
    buyTax:            parseFloat(info.buy_tax ?? '0') * 100,
    cannotSell:        info.cannot_sell_all === '1',
    hasTransferPause:  info.transfer_pausable === '1',
    ownerCanChangeBalance: info.owner_change_balance === '1',
  }

  await redis.setex(cacheKey, 60, JSON.stringify(result))  // cache 60s
  return result
}

type GoPlusResult = {
  isHoneypot: boolean
  isBlacklisted: boolean
  isMintable: boolean
  isProxyContract: boolean
  sellTax: number
  buyTax: number
  cannotSell: boolean
  hasTransferPause: boolean
  ownerCanChangeBalance: boolean
}
```

## 3. Combined Shadow Gate (Gatekeeper calls this)

```typescript
export async function shadowTokenGate(
  token: Address,
  chainId: number,
  clients: { public: PublicClient },
  redis: Redis,
  laneId: string
): Promise<void> {
  // Gate 1: Go+ Security
  const security = await goPlusSecurityCheck(token, chainId, redis)
  if (security.isHoneypot || security.cannotSell || security.isBlacklisted) {
    throw createLegionError({
      code: LegionErrorCode.HONEYPOT_DETECTED,
      sentinel: 'Shadow',
      laneId,
      cause: { security },
      recoverable: false
    })
  }
  if (security.buyTax > 10 || security.sellTax > 10) {
    throw createLegionError({
      code: LegionErrorCode.LETHALITY_BELOW_FLOOR,
      sentinel: 'Gatekeeper',
      laneId,
      cause: `Tax too high: buy=${security.buyTax}% sell=${security.sellTax}%`,
      recoverable: false
    })
  }

  // Gate 2: Fork simulation buy+sell
  const honeypot = await checkHoneypot(token, chainId, clients.public)
  if (honeypot.isHoneypot) {
    throw createLegionError({
      code: LegionErrorCode.HONEYPOT_DETECTED,
      sentinel: 'Shadow',
      laneId,
      cause: honeypot.reason,
      recoverable: false
    })
  }
}
```
