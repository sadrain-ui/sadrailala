# Research: lifinance/sdk

**Legion Engine DNA Source**: Bridge/Hop Layer — Dispatcher cross-chain routing
**Branch**: latest main
**Viem Standard**: SDK natively supports Viem as execution provider

---

## 1. High-Level Architecture

LI.FI SDK is a cross-chain routing and execution layer. It unifies:
- Bridges (Stargate, Hop, Across, Connext, etc.)
- DEX aggregators (1inch, 0x, Paraswap, etc.)
- Solvers (MEV-aware routes)

Architecture split:
- **Route/Quote Layer**: Smart routing API — finds best path across all venues
- **Execution Layer**: Converts selected route into on-chain tx(s) and tracks completion

For Legion Engine: use LI.FI patterns for **Dispatcher's cross-chain hop logic** (not direct SDK dependency).

---

## 2. Core Data Models

### Chain
```
{
  id: number,           // chainId
  name: string,
  nativeToken: Token,
  rpcUrls: string[],
  status: 'active' | 'restricted'
}
```

### Token
```
{
  chainId: number,
  address: string,      // '0x0000...0000' for native
  symbol: string,
  decimals: number,
  name: string,
  priceUSD: string
}
```

### Tool (venue/adapter)
```
{
  key: string,          // 'stargate', '1inch', 'across'
  name: string,
  type: 'bridge' | 'dex' | 'solver',
  supportedChains: number[]
}
```

### Step (one atomic action)
```
{
  type: 'swap' | 'cross' | 'protocol',
  tool: string,         // which bridge/dex handles this
  action: {
    fromChainId, toChainId,
    fromToken, toToken,
    fromAmount, slippage
  },
  estimate: {
    gasCosts, feeCosts,
    toAmount, executionDuration
  },
  transactionRequest: {
    to, data, value, gasLimit, chainId
  }
}
```

### Route (full execution plan)
```
{
  id: string,
  fromChainId, toChainId,
  fromToken, toToken,
  fromAmount, toAmount,
  steps: Step[],        // ordered execution sequence
  tags: string[],       // 'CHEAPEST', 'FASTEST', 'RECOMMENDED'
  insurance: { state, feeAmountUsd }
}
```

---

## 3. Main Flow

```
User intent: move Asset A (Chain X) -> Asset B (Chain Y)
        |
        v
1. QUOTE REQUEST
   POST /quote with { fromChain, toChain, fromToken, toToken, fromAmount, fromAddress }
        |
        v
2. ROUTE DISCOVERY (LI.FI smart router)
   - Queries all supported bridges, DEXs, solvers
   - Computes candidate step sequences
   - Scores by: gas cost, execution time, success probability
   - Returns ranked routes array
        |
        v
3. ROUTE SELECTION
   - Legion Engine picks route by lethality-based criteria:
     FASTEST for high-value, CHEAPEST for dust
        |
        v
4. STEP COMPILATION
   - Each step gets a transactionRequest
   - Pre-flight approvals (ERC20, Permit2) embedded
   - Supports EIP-5792 batch, ERC-2612, EIP-712, Permit2
        |
        v
5. EXECUTION
   - Submit steps sequentially via Viem WalletClient
   - SDK emits events: STARTED, ACTION_REQUIRED, CROSS_CHAIN_INITIATED, DONE, FAILED
        |
        v
6. TRACKING
   - Poll route status until all steps settled
   - Handle partial fills, retries, stuck bridges
```

---

## 4. Policy / Filtering System

LI.FI allows per-request filtering:
- `allowBridges: ['stargate', 'across']` — whitelist bridges
- `denyBridges: ['hop']` — blacklist
- `allowChains: [1, 137]` — restrict chains
- `allowTokens: [...]` — specific tokens only

For Legion Engine: map these to **Gatekeeper policies**:
- Policy type `bridge_restrict` -> sets allowBridges per extraction lane
- Policy type `chain_pause` -> adds to denyChains

---

## 5. Legion Engine Integration Patterns

### 5.1 Two-Stage Chooser
```
Stage 1: Discovery
  - Call LI.FI /quote (or equivalent)
  - Get all candidate routes
  - Filter by Gatekeeper policies

Stage 2: Selection
  - Score remaining routes by Legion criteria:
    - lethality_tier === 'high' -> FASTEST route
    - lethality_tier === 'mid' -> CHEAPEST route
    - lethality_tier === 'dust' -> skip or batch later
  - Select top route, serialize steps
```

### 5.2 Step Graph Model
Model each route as a typed step sequence:
```
ExtractionLane.steps = [
  { type: 'approve', token, spender, amount },
  { type: 'swap', fromToken, toToken, dex },
  { type: 'bridge', fromChain, toChain, bridge },
  { type: 'swap', fromToken, toToken, dex },   // destination swap
  { type: 'hop', toVault }                      // anonymity hop
]
```

### 5.3 Separation Rule
- Discovery (quote) = read-only, no side effects
- Execution = only after Closer consent + Gatekeeper approval
- Tracking = async, independent of execution thread

### 5.4 Viem Compatibility
- SDK uses Viem natively — our Viem PublicClient/WalletClient plugs in directly
- transactionRequest from each Step maps directly to Viem `sendTransaction` params

---

## 6. Key Patterns to Copy

1. Separate route discovery from execution — never combine into one function
2. Model route as ordered typed step array, not a single bridge call
3. Embed policy filtering at discovery stage, not execution stage
4. Score routes by operational context (speed vs cost vs lethality tier)
5. Track execution via events/hooks, not blocking await chains
6. Support destination chain calls natively (post-bridge actions in same route)
