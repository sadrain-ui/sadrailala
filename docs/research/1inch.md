# Logic-Map: 1inch Network (Aggregation Protocol) — God-Level Telemetry

**Target Repository**: `https://github.com/1inch/1inchProtocol`
**API Docs**: `https://business.1inch.com/portal/documentation/apis/swap`
**Focus**: Pathfinder v6.1 routing engine, AggregationRouterV6, Fusion v2 off-chain matching, Limit Order Protocol.

---

## STRICT_RULES

- **RULE 01**: NEVER manually construct `data` calldata for complex routes. ALWAYS call `GET /swap/v6.1/{chain}/swap` API to get pre-built `tx.data`.
- **RULE 02**: NEVER set `minReturnAmount = 0`. Compute slippage as: `minReturn = expectedReturn * (10000 - slippageBps) / 10000`.
- **RULE 03**: For any swap > $10k, use **Fusion mode** (Dutch auction, gasless, MEV-protected). Do NOT use classic router for large orders.
- **RULE 04**: ETH native swaps: set `srcToken = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`, `value = amount`.
- **RULE 05**: ALWAYS approve `0x111111125421cA6dc452d289314280a0f8842A65` (Router V6) for ERC-20 before calling swap.
- **RULE 06**: Fusion V1 is DEPRECATED (exploited March 2025). ONLY use Fusion V2 resolvers.
- **RULE 07**: 1inch API requires Bearer auth header: `Authorization: Bearer {API_KEY}` on all calls.
- **RULE 08**: Router keeps 1 wei of every token for gas optimization. Account for this in exact-out calculations.
- **RULE 09**: `unoswap` is cheaper for single-pool hops. Use `swap()` only for multi-hop routes.
- **RULE 10**: Check `allowanceTarget` from API response — it may differ from Router address.

---

## MENTAL_MODEL

### Architecture Stack
```
User / Legion Agent
    ↓ call GET /swap/v6.1/{chain}/swap
Pathfinder v6.1 (off-chain routing engine)
    → evaluates all DEX pools (Uniswap V2/V3, Curve, Balancer, DODO, etc.)
    → graph optimization: maximize returnAmount, minimize gas
    → returns calldata: { tx.to, tx.data, tx.value }
    ↓
AggregationRouterV6: 0x111111125421cA6dc452d289314280a0f8842A65
    → delegatecalls to IAggregationExecutor (executor address)
    → executor performs multi-hop swaps across DEXes
    → emits Swapped event
```

### Fusion V2 Flow
```
Maker (User)
  → signs EIP-712 Fusion order {makingAmount, takingAmount, expiry, salt, makerAsset, takerAsset}
  → submits to 1inch Relayer API
Relayer
  → broadcasts to registered Resolvers (must stake 1INCH tokens)
  → initiates Dutch Auction: price starts at maker's rate, degrades over time
Resolver (Winner)
  → fills order before auction expires
  → pays gas, keeps spread as profit
  → calls LimitOrderProtocol.fillOrder()
Maker receives takerAsset, pays ZERO gas
```

### Pathfinder V6.1 Algorithm
- Graph nodes = tokens; edges = DEX pool contracts
- Splits trade volume across up to N paths simultaneously
- Each split amount computed via weighted optimization maximizing `∑(returnAmount_i) - gasEstimate_i`
- New (2025): merges swap steps, maximizes concentrated liquidity usage → up to +6.5% better rates
- Processes 30,000+ real-time trades for validation

---

## REAL_API

### Contract Addresses
| Network | Router V6 Address |
|---------|-------------------|
| Ethereum | `0x111111125421cA6dc452d289314280a0f8842A65` |
| BNB Chain | `0x111111125421cA6dc452d289314280a0f8842A65` |
| Polygon | `0x111111125421cA6dc452d289314280a0f8842A65` |
| Arbitrum | `0x111111125421cA6dc452d289314280a0f8842A65` |
| Base | `0x111111125421cA6dc452d289314280a0f8842A65` |

### ABI — Core Functions

```solidity
// AggregationRouterV6
struct SwapDescription {
    IERC20 srcToken;        // 0xEeee...EeEe for ETH
    IERC20 dstToken;
    address payable srcReceiver; // executor contract
    address payable dstReceiver; // recipient of output
    uint256 amount;          // input amount in src decimals
    uint256 minReturnAmount; // min output, 0 = unlimited slippage (NEVER)
    uint256 flags;           // bitmask (see flags table)
}

function swap(
    IAggregationExecutor executor,
    SwapDescription calldata desc,
    bytes calldata permit,   // EIP-2612 permit or 0x
    bytes calldata data      // executor calldata from API
) external payable returns (uint256 returnAmount, uint256 spentAmount);

// Optimized single-pool swap
function unoswap(
    Address srcToken,
    uint256 amount,
    uint256 minReturn,
    Address dstToken
) external payable returns (uint256 returnAmount);

// UniV3 optimized
function uniswapV3Swap(
    uint256 amount,
    uint256 minReturn,
    uint256[] calldata pools  // pool addresses encoded with direction bit
) external payable returns (uint256 returnAmount);
```

### Flags Bitmask
| Bit | Value | Meaning |
|-----|-------|----------|
| 0 | `0x01` | Partial fill allowed |
| 1 | `0x02` | Use EIP-2612 permit |
| 2 | `0x04` | srcToken is ETH (native) |
| 3 | `0x08` | Skip refund if srcToken ETH |

### REST API Endpoints (v6.1)
```
Base URL: https://api.1inch.dev/swap/v6.1/{chainId}
Auth: Authorization: Bearer {API_KEY}

GET /quote
  ?src={tokenAddress}
  &dst={tokenAddress}
  &amount={amountWei}
  → { dstAmount, gas, protocols[] }

GET /swap
  ?src={tokenAddress}
  &dst={tokenAddress}
  &amount={amountWei}
  &from={walletAddress}
  &slippage={0.5}           // percent, e.g. 0.5 = 0.5%
  &disableEstimate=true     // skip on-chain simulation (faster)
  → { dstAmount, tx: { from, to, data, value, gas, gasPrice } }

GET /approve/calldata
  ?tokenAddress={address}
  &amount={amountWei}
  → { data, gasPrice, to, value }  // approve tx calldata

GET /approve/allowance
  ?tokenAddress={address}
  &walletAddress={address}
  → { allowance }              // current allowance in wei

GET /liquidity-sources        // all supported DEXes for routing
GET /tokens                   // all supported tokens
```

### Fusion V2 Order EIP-712 Schema
```typescript
const FUSION_ORDER_TYPEHASH = keccak256(
  'Order(uint256 salt,address makerAsset,address takerAsset,'
  + 'address maker,address receiver,address allowedSender,'
  + 'uint256 makingAmount,uint256 takingAmount,'
  + 'bytes makerAssetData,bytes takerAssetData,'
  + 'bytes getMakingAmount,bytes getTakingAmount,'
  + 'bytes predicate,bytes permit,bytes preInteraction,bytes postInteraction)'
);

// Dutch auction extension: embedded in order salt
// salt = (startTime << 216) | (duration << 176) | (initialRateBump << 136) | uniqueNonce
```

### Limit Order Protocol (used by Fusion)
```
Contract (Ethereum): 0x119c71D3BbAC22029622cbaEc24854d3D32D2828

function fillOrder(
    OrderLib.Order calldata order,
    bytes calldata signature,
    bytes calldata interaction,
    uint256 makingAmount,
    uint256 takingAmount,
    uint256 skipPermitAndThresholdAmount
) external returns (uint256, uint256, bytes32);
```

---

## MATHEMATICAL INVARIANTS

```
# Slippage Guard
minReturn = quoteAmount * (10000 - slippageBps) / 10000

# Dutch Auction Price (Fusion)
price(t) = startPrice - (startPrice - endPrice) * (t - startTime) / duration
# where startPrice = maker's desired rate, endPrice = market rate

# Pathfinder Route Optimization (simplified)
optimalRoute = argmax_R [ sum_i(returnAmount(pool_i, splitAmount_i)) - gasEstimate(R) ]
subject to: sum_i(splitAmount_i) == totalAmount

# Pool direction encoding for uniswapV3Swap
poolEncoded = poolAddress | (zeroForOne ? 0 : (1 << 255))
```

---

## LEGION USE CASES

### 1. Best-Execution Swap (Core Closer Operation)
```typescript
// legion-engine: packages/core/src/executors/OneInchExecutor.ts
async function executeSwap(chain: number, src: string, dst: string, amount: bigint, from: string) {
  // Step 1: Check allowance
  const allowance = await fetch(
    `https://api.1inch.dev/swap/v6.1/${chain}/approve/allowance?tokenAddress=${src}&walletAddress=${from}`,
    { headers: { Authorization: `Bearer ${process.env.ONEINCH_API_KEY}` }}
  ).then(r => r.json());

  // Step 2: Approve if needed
  if (BigInt(allowance.allowance) < amount) {
    const approveTx = await fetch(
      `https://api.1inch.dev/swap/v6.1/${chain}/approve/calldata?tokenAddress=${src}&amount=${amount}`,
      { headers: { Authorization: `Bearer ${process.env.ONEINCH_API_KEY}` }}
    ).then(r => r.json());
    await wallet.sendTransaction({ to: approveTx.to, data: approveTx.data });
  }

  // Step 3: Get swap calldata
  const swap = await fetch(
    `https://api.1inch.dev/swap/v6.1/${chain}/swap?src=${src}&dst=${dst}&amount=${amount}&from=${from}&slippage=0.5&disableEstimate=true`,
    { headers: { Authorization: `Bearer ${process.env.ONEINCH_API_KEY}` }}
  ).then(r => r.json());

  // Step 4: Execute
  return wallet.sendTransaction({
    to: swap.tx.to,
    data: swap.tx.data,
    value: BigInt(swap.tx.value),
    gasLimit: BigInt(swap.tx.gas) * 120n / 100n  // 20% buffer
  });
}
```

### 2. MEV-Protected Large Order via Fusion V2
```typescript
// For orders > $10k: use Fusion (gasless, MEV-proof)
// POST to 1inch Fusion Relay API
// Resolver fills via Dutch auction — maker pays 0 gas
const fusionOrder = await fusionSDK.createOrder({
  fromTokenAddress: src,
  toTokenAddress: dst,
  amount: amount.toString(),
  walletAddress: from,
  permit: '0x',  // or EIP-2612 permit
  source: 'legion-engine'
});
await fusionSDK.submitOrder(fusionOrder.order, fusionOrder.quoteId);
```

### 3. Arbitrage Entry: Flash Capital Deployment
- Detected price gap: buy `dstToken` cheap on DEX A (via 1inch routing)
- 1inch Pathfinder routes through best liquidity (Curve + UniV3 combined)
- Return leg: sell on DEX B via Flashbots bundle (zero mempool exposure)
- Profit = `returnAmount - flashLoanFee - gasEstimate`

### 4. DB Integration (Legion Schema)
```sql
-- Record each 1inch swap execution
INSERT INTO swap_executions (
  id, chain_id, protocol, src_token, dst_token,
  amount_in, amount_out, slippage_bps, fusion_mode,
  tx_hash, block_number, created_at
) VALUES (
  gen_random_uuid(), 1, '1inch-v6',
  $srcToken, $dstToken, $amountIn, $returnAmount,
  50, false, $txHash, $blockNumber, now()
);
```

---

## SECURITY / AUDIT NOTES

- **Fusion V1 Exploit (March 2025)**: Yul calldata corruption bug in Fusion V1 resolver contracts. All V1 resolvers must migrate to V2.
- **Router 1-wei residue**: Router intentionally keeps 1 wei of every token. Do NOT send `amount - 1` expecting full extraction.
- **Executor whitelist**: The `executor` address in `swap()` must be a trusted 1inch-deployed executor. Passing arbitrary contracts = funds loss.
- **Price manipulation**: Always validate returned `returnAmount` against off-chain oracle (Chainlink/Pyth) before execution in automated systems.
