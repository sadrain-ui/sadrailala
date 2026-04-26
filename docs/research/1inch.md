# 1inch Logic-Map — Legion Engine Integration

## 1. Role in Legion Engine
- **Primary Sentinel**: Scout (price discovery) + Dispatcher (swap routing)
- **Function**: Best-price DEX aggregation across 400+ liquidity sources on EVM chains
- **Legion Use-Case**: Scout calls 1inch Aggregation API to find optimal swap routes; Dispatcher executes via Viem `sendTransaction`

---

## 2. Core Architecture

### 2.1 Two API Surfaces
```
1inch Aggregation API v5.2+
├── /quote    → price estimation, no wallet required
├── /swap     → calldata + tx params for on-chain execution
├── /approve  → check/build token approval tx
└── /tokens   → supported token list per chain

1inch Fusion SDK (limit orders)
├── FusionSDK.getQuote()       → gasless quote
├── FusionSDK.placeOrder()     → signed EIP-712 order
└── FusionSDK.getOrderStatus() → poll resolution
```

### 2.2 Quote vs Swap Separation (Legion Pattern)
```typescript
// Scout phase — read-only, no side effects
async function getQuote(params: QuoteParams): Promise<Quote> {
  const res = await fetch(`${INCH_API}/quote?${toQueryString(params)}`)
  return res.json() // { toAmount, estimatedGas, protocols }
}

// Dispatcher phase — only after Closer + Gatekeeper approval
async function buildSwapTx(params: SwapParams): Promise<SwapTx> {
  const res = await fetch(`${INCH_API}/swap?${toQueryString(params)}`)
  return res.json() // { tx: { to, data, value, gas, gasPrice } }
}
```

---

## 3. Key Data Models

### 3.1 QuoteParams
```typescript
type QuoteParams = {
  fromTokenAddress: Address  // checksummed EVM address
  toTokenAddress: Address
  amount: string             // in fromToken wei units
  chainId: number
  protocols?: string         // comma-separated protocol list
  fee?: number               // 0-3% referral fee in bps/100
  gasLimit?: number
  connectorTokens?: string   // intermediate routing tokens
  complexityLevel?: 0|1|2|3  // route complexity
  mainRouteParts?: number    // split route count
}
```

### 3.2 SwapParams (extends QuoteParams)
```typescript
type SwapParams = QuoteParams & {
  fromAddress: Address       // user wallet — tx sender
  slippage: number           // 0.1 to 50 (percent)
  referrerAddress?: Address
  disableEstimate?: boolean  // skip on-chain simulation
  allowPartialFill?: boolean
  destReceiver?: Address     // for vault routing (Ghost Lane)
}
```

### 3.3 SwapTx Response
```typescript
type SwapTx = {
  fromToken: TokenInfo
  toToken: TokenInfo
  toAmount: string           // actual output amount
  tx: {
    from: Address
    to: Address              // 1inch router contract
    data: Hex                // encoded swap calldata
    value: string            // ETH value in wei
    gas: number
    gasPrice: string
  }
}
```

---

## 4. Critical Integration Patterns

### 4.1 Token Approval Flow
```typescript
// 1. Check existing allowance
const allowance = await publicClient.readContract({
  address: tokenAddress,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [userAddress, INCH_ROUTER_ADDRESS]
})

// 2. If insufficient, build approval tx via API
const approvalRes = await fetch(`${INCH_API}/approve/transaction?tokenAddress=${token}&amount=${amount}`)
const approvalTx = await approvalRes.json()

// 3. Send approval via Dispatcher (Viem)
const approveTxHash = await walletClient.sendTransaction({
  to: approvalTx.to,
  data: approvalTx.data,
  value: 0n
})
await publicClient.waitForTransactionReceipt({ hash: approveTxHash })
```

### 4.2 Slippage + Output Validation (Shadow)
```typescript
function validateSwapOutput(quote: Quote, swapTx: SwapTx, slippage: number): boolean {
  const minOutput = BigInt(quote.toAmount) * BigInt(1000 - slippage * 10) / 1000n
  const actualOutput = BigInt(swapTx.toAmount)
  return actualOutput >= minOutput
}
```

### 4.3 Fusion (Gasless) Order Pattern
```typescript
const sdk = new FusionSDK({ url: FUSION_URL, network: chainId, authKey: API_KEY })
const quote = await sdk.getQuote({ fromTokenAddress, toTokenAddress, amount, walletAddress })
const { order, quoteId } = quote.createFusionOrder()
const signature = await walletClient.signTypedData(order.getTypedData())
await sdk.submitOrder(order, quoteId, signature)
```

---

## 5. Legion Sentinel Matrix

| Sentinel | 1inch Usage |
|---|---|
| Scout | `GET /quote` — price discovery, no wallet, parallel calls across chains |
| Gatekeeper | compare `toAmount` vs Lethality threshold, reject if below min viable output |
| Closer | build Permit2 signature OR ERC-20 approve based on token standard |
| Dispatcher | `GET /swap` → `walletClient.sendTransaction(swapTx.tx)` via Viem |
| Shadow | `simulateTransaction` on swapTx before broadcast, catch reverts |
| Mask | if fromAddress = Safe, wrap sendTransaction in Safe multisig proposal |

---

## 6. Chain Support Matrix

```
Chain          | chainId | Aggregation | Fusion
Ethereum       | 1       | ✅          | ✅
BNB Chain      | 56      | ✅          | ✅
Polygon        | 137     | ✅          | ✅
Optimism       | 10      | ✅          | ❌
Arbitrum       | 42161   | ✅          | ❌
Avalanche      | 43114   | ✅          | ❌
Base           | 8453    | ✅          | ❌
Gnosis         | 100     | ✅          | ❌
```

---

## 7. Key Patterns to Copy

1. Always call `/quote` first (Scout), never jump to `/swap` without Gatekeeper approval
2. `disableEstimate: false` by default — let 1inch simulate before building calldata
3. Use `destReceiver` param to route swap output directly to vault (Ghost Lane pattern)
4. Cache token list per chain at startup, refresh every 5 minutes (Sovereign Sync)
5. For Fusion orders: sign EIP-712 typed data, never raw personal_sign
6. Rate limit: 1 req/sec on free tier; use API key for 10 req/sec
7. Always validate `toAmount` post-swap against pre-swap `quote.toAmount` (Shadow check)

---

## 8. Router Contract Addresses

```typescript
const INCH_ROUTER_V5: Record<number, Address> = {
  1:     '0x1111111254EEB25477B68fb85Ed929f73A960582', // Ethereum
  56:    '0x1111111254EEB25477B68fb85Ed929f73A960582', // BNB
  137:   '0x1111111254EEB25477B68fb85Ed929f73A960582', // Polygon
  10:    '0x1111111254EEB25477B68fb85Ed929f73A960582', // Optimism
  42161: '0x1111111254EEB25477B68fb85Ed929f73A960582', // Arbitrum
  43114: '0x1111111254EEB25477B68fb85Ed929f73A960582', // Avalanche
}
// Note: same address across chains due to CREATE2 deployment
```

---

## 9. Error Handling

```typescript
const INCH_ERRORS: Record<number, string> = {
  400: 'Bad request — invalid params (check amount/slippage)',
  429: 'Rate limit exceeded — backoff + retry with jitter',
  500: 'Insufficient liquidity or quote unavailable',
}

async function safeQuote(params: QuoteParams): Promise<Quote | null> {
  try {
    const res = await fetch(buildQuoteUrl(params))
    if (!res.ok) throw new Error(`1inch error ${res.status}`)
    return res.json()
  } catch (err) {
    // Scout aborts lane, Gatekeeper logs lethality event
    return null
  }
}
```
