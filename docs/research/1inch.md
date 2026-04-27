# 1inch Logic-Map — Legion Engine Integration

Target Repository: `https://github.com/1inch` (AggregationProtocol, LimitOrderProtocol, Fusion+)
Focus: Multi-DEX Aggregation, Fusion+ Dutch Auctions, Intent-based Routing, Settlement Math

## 1. Role in Legion Engine
* **Primary Sentinel**: Scout (price discovery) + Dispatcher (execution)
* **Function**: Best-price DEX aggregation across 400+ liquidity sources on 10+ EVM chains.
* **Legion Use-Case**: Scout calls 1inch API for optimal routing; Dispatcher executes via Viem OR Fusion+ gasless intents; Ghost Lane uses `destReceiver` for stealth routing.

## 2. Core Architecture
### 2.1 Three-Tier Product Surface
**Layer 1: Aggregation Protocol v5.2+** (Immediate Settlement)
* `/v5.2/{chainId}/quote` → Scout discovery
* `/v5.2/{chainId}/swap` → Dispatcher execution
* `/v5.2/{chainId}/approve/transaction` → Closer approval building

**Layer 2: Limit Order Protocol v3** (Conditional Settlement)
* Off-chain EIP-712 orders + On-chain fill logic
* Supports partial fills, multiple fills, and custom predicates.

**Layer 3: Fusion+ v2** (Cross-chain & MEV-Protected)
* Dutch Auction pricing (decaying price curve).
* Resolver network (whitelisted arbitrageurs).

## 📘 Real Contract ABIs & Interfaces
### AggregationRouterV5 (`0x1111111254EEB25477B68fb85Ed929f73A960582`)
```solidity
function swap(
    IAggregationExecutor executor,
    SwapDescription calldata desc,
    bytes calldata permit,
    bytes calldata data
) external payable returns (uint256 returnAmount, uint256 spentAmount);

struct SwapDescription {
    address srcToken;
    address dstToken;
    address payable srcReceiver;
    address payable dstReceiver;
    uint256 amount;
    uint256 minReturnAmount;
    uint256 flags;
}
```

### 🧬 MakerTraits Bitmap Flags
* **Bit 255**: `NO_PARTIAL_FILLS_FLAG`
* **Bit 254**: `ALLOW_MULTIPLE_FILLS_FLAG`
* **Bit 252**: `PRE_INTERACTION_CALL_FLAG`
* **Bit 251**: `POST_INTERACTION_CALL_FLAG`
* **Bit 250**: `NEED_CHECK_EPOCH_MANAGER_FLAG`

## 🎯 Fusion+ Dutch Auction Math
```typescript
function getAuctionOutput(
    startAmount: bigint,
    minAmount: bigint,
    startTime: number,
    duration: number,
    now: number
): bigint {
    const elapsed = BigInt(Math.max(0, now - startTime));
    if (elapsed >= BigInt(duration)) return minAmount;
    const totalDrop = startAmount - minAmount;
    const currentDrop = (totalDrop * elapsed) / BigInt(duration);
    return startAmount - currentDrop;
}
```

## 🔑 Critical Rules for Developers
1. **Always `/quote` first** — never jump to `/swap` without Scout verification.
2. **Validate `protocols`** — If a route includes an unaudited/new DEX, Gatekeeper must flag.
3. **Ghost Routing** — Always use `destReceiver` for high-net-worth accounts to break the on-chain link between maker and taker.
4. **HTLC Timeout** — Fusion+ swaps have a default 1-hour window; Shadow must monitor for lock-up.
