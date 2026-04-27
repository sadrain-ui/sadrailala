# 1inch Logic-Map — Legion Engine Integration

**Target Repository**: `https://github.com/1inch` (AggregationProtocol, LimitOrderProtocol, Fusion+)  
**Focus**: Multi-DEX Aggregation, Fusion+ Dutch Auctions, Intent-based Routing, Settlement Math

## 1. Role in Legion Engine
- **Primary Sentinel**: Scout (price discovery) + Dispatcher (execution)
- **Function**: Best-price DEX aggregation across 400+ liquidity sources on 10+ EVM chains
- **Legion Use-Case**: Scout calls 1inch API for optimal routing; Dispatcher executes via Viem OR Fusion+ gasless intents; Ghost Lane uses `destReceiver` for stealth routing.

## 2. Core Architecture

### 2.1 Three-Tier Product Surface

**Layer 1: Aggregation Protocol v5.2+** (Immediate Settlement)
- `/v5.2/{chainId}/quote` → Scout discovery
- `/v5.2/{chainId}/swap` → Dispatcher execution (calldata generation)
- `/v5.2/{chainId}/approve/transaction` → Closer approval building

**Layer 2: Limit Order Protocol v3** (Conditional Settlement)
- Off-chain EIP-712 orders + On-chain fill logic
- Supports partial fills, multiple fills, and custom predicates (conditions)

**Layer 3: Fusion+ v2** (Cross-chain & MEV-Protected)
- Dutch Auction pricing (decaying price curve)
- Resolver network (whitelisted arbitrageurs)
- Atomic cross-chain swaps via hashed-time-lock-escrows (HTLC)

## 📘 Real Contract ABIs & Interfaces

### AggregationRouterV5 (`0x1111111254EEB25477B68fb85Ed929f73A960582`)

```solidity
// High-level swap entry point
function swap(
  IAggregationExecutor executor,
  SwapDescription calldata desc,
  bytes calldata permit,
  bytes calldata data
) external payable returns (uint256 returnAmount, uint256 spentAmount);

struct SwapDescription {
  IERC20 srcToken;
  IERC20 dstToken;
  address payable srcReceiver;
  address payable dstReceiver; // Legion Vault / Ghost Lane
  uint256 amount;
  uint256 minReturnAmount;
  uint256 flags; // bitmask for partial fills / etc.
}
```

### LimitOrderProtocol v3 (Fusion Core)

```solidity
// Fill maker order with taker funds
function fillOrder(
  Order memory order,
  bytes calldata signature,
  bytes calldata interactionData, // call to resolver
  uint256 makingAmount,
  uint256 takingAmount,
  uint256 skipPermitAndThresholdAmount // packed 
) external payable returns (uint256, uint256);

struct Order {
  uint256 salt;
  address maker;
  address receiver;
  address makerAsset;
  address takerAsset;
  uint256 makingAmount;
  uint256 takingAmount;
  MakerTraits makerTraits; // BITMAP FLAGS (see below)
}
```

### 🧬 MakerTraits Bitmap (Ultra-Deep Logic)
MakerTraits is a `uint256` bitmap used for gas-efficient conditional logic:
- **Bit 255**: `NO_PARTIAL_FILLS_FLAG` (If set, order must be filled in one go)
- **Bit 254**: `ALLOW_MULTIPLE_FILLS_FLAG` (If set, order remains active after partial fill)
- **Bit 252**: `PRE_INTERACTION_CALL_FLAG` (Triggers callback BEFORE funds move)
- **Bit 251**: `POST_INTERACTION_CALL_FLAG` (Triggers callback AFTER funds move)
- **Bit 250**: `NEED_CHECK_EPOCH_MANAGER_FLAG` (Enables order cancellation by epoch)
- **Bit 247**: `UNWRAP_WETH_FLAG` (Auto-unwrap to native ETH)

## 🎯 Fusion+ Dutch Auction Math

Resolvers compete based on a decaying price curve. The profit for the resolver decreases as time passes.

```typescript
/**
 * Linear Price Decay Formula
 * @param startAmount Max tokens maker wants (Best price)
 * @param minAmount Min tokens maker will accept (Stop-loss)
 * @param startTime Start of auction
 * @param duration Auction length (e.g. 180s)
 */
function getAuctionOutput(
  startAmount: bigint,
  minAmount: bigint,
  startTime: number,
  duration: number,
  now: number
): bigint {
  const elapsed = BigInt(Math.max(0, now - startTime))
  if (elapsed >= BigInt(duration)) return minAmount
  
  const totalDrop = startAmount - minAmount
  const currentDrop = (totalDrop * elapsed) / BigInt(duration)
  
  return startAmount - currentDrop
}
```

## 📊 API Integration Patterns

### 1. Scout Discovery (Quote)
```typescript
const INCH_API = 'https://api.1inch.dev/swap/v5.2/1' // Ethereum

async function getLegionRoute(from: Address, to: Address, amount: string) {
  const params = new URLSearchParams({
    src: from,
    dst: to,
    amount: amount,
    includeTokensInfo: 'true',
    includeProtocols: 'true',
    complexityLevel: '2' // Deep routing
  })
  
  const res = await fetch(`${INCH_API}/quote?${params}`)
  return res.json() // returns { toAmount, protocols, gas }
}
```

### 2. Dispatcher Ghost Lane (Stealth Swap)
```typescript
async function buildStealthSwap(params: SwapParams) {
  const res = await fetch(`${INCH_API}/swap?${new URLSearchParams({
    ...params,
    fromAddress: userAddress,
    destReceiver: LEGION_GHOST_VAULT, // OUTPUT MOVES TO STEALTH ADDRESS
    slippage: '0.5',
    disableEstimate: 'false' // Enable on-chain simulation
  })}`)
  return res.json() // returns { tx: { data, to, value, gas } }
}
```

## 🔍 Legion Sentinel Matrix

| Sentinel | 1inch Implementation |
|----------|----------------------|
| **Scout** | `GET /quote` — map liquidity across 400+ venues; detect price gaps. |
| **Gatekeeper** | Verify `minReturnAmount` > slippage threshold; blacklist unsafe `protocols`. |
| **Closer** | Build `Permit2` signatures or `approve` txs for router/settlement. |
| **Dispatcher** | Broadcast `/swap` calldata; initiate Fusion orders via EIP-712. |
| **Shadow** | Decode 1inch `Interaction` data to verify HTLC safety in Fusion+ swaps. |
| **Ghost** | Manipulate `destReceiver` to break the on-chain link between maker/taker. |

## 💡 Legion Use Cases (Lethality Patterns)

### 1. Aggregator Arbitrage (Scout-Closer)
Scout monitors 1inch price vs raw DEX pools (Uniswap/Sushiswap). If `1inchPrice > RawPoolPrice`:
1. **Closer** executes flash loan from Aave.
2. **Dispatcher** buys in Raw Pool.
3. **Dispatcher** sells via 1inch Aggregator (ensuring `destReceiver` is the flash loan repayer).
4. Profit remains in Legion vault.

### 2. Zero-Gas Extraction (Fusion-Mask)
1. **Mask** (Safe) signs a 1inch Fusion order with 0 gas fee.
2. Order is set to expire in 5 blocks.
3. **Resolver** (Resolver network) fills the order and pays the gas.
4. Result: Asset extraction without needing native gas in the source wallet.

### 3. Cross-Chain Sovereign Sync (Fusion+)
1. **Sovereign Sync** triggers rebalance from ETH (Arbitrum) to ETH (Mainnet).
2. Legion initiates Fusion+ cross-chain swap.
3. HTLC escrow locks Arbitrum ETH.
4. Resolver releases Mainnet ETH to Legion Vault.
5.HTLC unlocks on Arbitrum for resolver.

## 🔗 Contract Addresses (Mainnet)
- **AggregationRouterV5**: `0x1111111254EEB25477B68fb85Ed929f73A960582`
- **LimitOrderProtocolV3**: `0x111111125421cA6dc452d289314280a0f8842A65`
- **Fusion Settlement**: `0x3ef51736315f52d568d6d2cf289419b9cfffe782`

## 🔑 Critical Rules for Developers
1. **Always `/quote` first** — never jump to `/swap` without Scout verification.
2. **Validate `protocols`** — If a route includes an unaudited/new DEX, Gatekeeper must flag.
3. **Ghost Routing** — Always use `destReceiver` when execUpgrade 1inch.md to god-level: Real ABIs, MakerTraits bitmap logic, Dutch auction formulas, and Legion extraction use cases.uting for high-net-worth accounts.
4. **HTLC Timeout** — Fusion+ swaps have a default 1-hour window; Shadow must monitor for lock-up.
