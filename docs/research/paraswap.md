# ParaSwap Logic-Map — Legion Engine Integration

## 1. Role in Legion Engine
- **Primary Sentinel**: Scout (price discovery) + Dispatcher (execution)
- **Function**: Multi-DEX aggregator with built-in gas optimization and Permit (gasless approvals)
- **Legion Use-Case**: Secondary price oracle alongside 1inch; used for chains where 1inch coverage is thin; Permit2-native approval flow aligns with Legion's Closer sentinel

---

## 2. Core Architecture

### 2.1 API Surfaces
```
ParaSwap API v5
├── GET /prices          → route discovery (Scout)
├── POST /transactions   → build swap calldata (Dispatcher)
├── GET /tokens          → token list per network
├── GET /adapters        → active DEX adapters
└── GET /balance         → token balances (unused — use Viem instead)

ParaSwap SDK (@paraswap/sdk)
├── constructSimpleSDK()    → stateless, API-only
├── constructFullSDK()      → includes on-chain read methods
├── sdk.swap.getRate()      → GET /prices wrapper
├── sdk.swap.buildTx()      → POST /transactions wrapper
└── sdk.swap.approveToken() → ERC-20 approve helper
```

### 2.2 Rate vs Transaction Separation (Legion Pattern)
```typescript
// Scout phase — read-only
const rate = await sdk.swap.getRate({
  srcToken, destToken, amount, network: chainId, side: SwapSide.SELL
})
// rate.destAmount = expected output
// rate.priceRoute = serialized for buildTx

// Dispatcher phase — after Gatekeeper approval
const txParams = await sdk.swap.buildTx({
  srcToken, destToken, srcAmount: amount,
  minAmount: applySlippage(rate.destAmount, slippagePct),
  priceRoute: rate,  // MUST pass back exact priceRoute object
  userAddress: walletAddress,
  receiver: vaultAddress  // Ghost Lane: direct to vault
})
```

---

## 3. Key Data Models

### 3.1 GetRateParams
```typescript
type GetRateParams = {
  srcToken: Address
  destToken: Address
  amount: string          // src amount in wei (SELL) or dest amount (BUY)
  network: number         // chainId
  side: SwapSide          // 'SELL' | 'BUY'
  options?: {
    includeDEXS?: string[]  // whitelist specific DEXs
    excludeDEXS?: string[]  // blacklist (avoid low-liquidity DEXs)
    maxImpact?: number      // max price impact in percent
    partner?: string        // referral partner
    srcDecimals?: number
    destDecimals?: number
  }
}
```

### 3.2 OptimalRate (price route)
```typescript
type OptimalRate = {
  srcToken: Address
  destToken: Address
  srcAmount: string
  destAmount: string        // expected output
  bestRoute: RouteSegment[] // multi-hop route details
  gasCost: string           // estimated gas units
  gasCostUSD: string        // gas cost in USD
  contractAddress: string   // Augustus router address
  tokenTransferProxy: string // approval target (NOT Augustus!)
  network: number
}
// IMPORTANT: tokenTransferProxy is approval target, not contractAddress
```

### 3.3 BuildTxParams
```typescript
type BuildTxParams = {
  srcToken: Address
  destToken: Address
  srcAmount: string
  minAmount: string         // destAmount * (1 - slippage)
  priceRoute: OptimalRate   // from getRate()
  userAddress: Address
  receiver?: Address        // Ghost Lane vault target
  partner?: string
  partnerAddress?: Address
  partnerFeeBps?: number
  permit?: string           // EIP-2612 permit signature
  deadline?: number
}
```

---

## 4. Critical Integration Patterns

### 4.1 Approval Target is tokenTransferProxy (NOT Augustus router)
```typescript
// WRONG — approving wrong address
await walletClient.writeContract({
  address: tokenAddress, abi: erc20Abi,
  functionName: 'approve',
  args: [rate.contractAddress, amount]  // ❌
})

// CORRECT — approve tokenTransferProxy
await walletClient.writeContract({
  address: tokenAddress, abi: erc20Abi,
  functionName: 'approve',
  args: [rate.tokenTransferProxy, amount]  // ✅
})
```

### 4.2 Slippage Application
```typescript
function applySlippage(amount: string, slippagePct: number): string {
  // ParaSwap uses bps-style: 100 = 1%
  const slippageBps = Math.floor(slippagePct * 100)
  return (BigInt(amount) * BigInt(10000 - slippageBps) / 10000n).toString()
}
// Use minAmount in buildTx, not in getRate
```

### 4.3 Gasless Approval via EIP-2612 Permit
```typescript
// Closer sentinel builds permit signature
const permitSignature = await walletClient.signTypedData({
  domain: { name: tokenName, version: '1', chainId, verifyingContract: tokenAddress },
  types: { Permit: [...] },
  primaryType: 'Permit',
  message: { owner, spender: rate.tokenTransferProxy, value: amount, nonce, deadline }
})

// Pass permit to buildTx — no separate approve tx needed
const txParams = await sdk.swap.buildTx({ ..., permit: permitSignature, deadline })
```

### 4.4 Viem Execution
```typescript
// buildTx returns { from, to, value, data, gas, gasPrice }
const txHash = await walletClient.sendTransaction({
  to: txParams.to as Address,
  data: txParams.data as Hex,
  value: BigInt(txParams.value || '0'),
  gas: BigInt(txParams.gas)
})
```

---

## 5. Legion Sentinel Matrix

| Sentinel | ParaSwap Usage |
|---|---|
| Scout | `sdk.swap.getRate()` — parallel with 1inch, pick best `destAmount` |
| Gatekeeper | compare destAmount vs lethality floor, check `gasCostUSD` vs profit margin |
| Closer | build EIP-2612 permit for tokenTransferProxy OR ERC-20 approve |
| Dispatcher | `sdk.swap.buildTx()` → `walletClient.sendTransaction()` |
| Shadow | simulate via Tenderly or `eth_call` on Augustus calldata before broadcast |
| Mask | wrap sendTransaction in Safe proposal if wallet is multisig |

---

## 6. Chain Support

```
Chain        | Network ID | Notes
Ethereum     | 1          | Full support
BNB Chain    | 56         | Full support
Polygon      | 137        | Full support
Avalanche    | 43114      | Full support
Fantom       | 250        | Full support
Optimism     | 10         | Full support
Arbitrum     | 42161      | Full support
Base         | 8453       | Full support
Gnosis       | 100        | Full support
```

---

## 7. Key Patterns to Copy

1. Always pass `priceRoute` from `getRate()` directly into `buildTx()` — never reconstruct it
2. Approve `tokenTransferProxy`, never `contractAddress` (Augustus) — common mistake
3. Use `excludeDEXS` to blacklist illiquid DEXs that inflate slippage on low-cap tokens
4. `maxImpact` param in getRate prevents routes with >N% price impact — set to 3 by default
5. Implement dual-quoting: getRate from both 1inch and ParaSwap, use better `destAmount`
6. For native ETH swaps: srcToken = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
7. `receiver` param routes output directly to Legion vault — always use for Ghost Lane

---

## 8. Error Handling

```typescript
try {
  const rate = await sdk.swap.getRate(params)
  if (!rate || !rate.destAmount) throw new Error('No route found')
  if (parseFloat(rate.gasCostUSD) > MAX_GAS_USD) throw new Error('Gas too high')
} catch (err: any) {
  if (err.message.includes('No routes found')) {
    // Scout: mark token pair as illiquid, skip
  }
  if (err.message.includes('ERROR_BUILDING_TRANSACTION')) {
    // Dispatcher: priceRoute stale, re-fetch rate
  }
}
```
