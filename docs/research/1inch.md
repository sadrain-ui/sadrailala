# Logic-Map: 1inch Network (Aggregation Protocol)

**Target Repository**: `https://github.com/1inch/1inchProtocol`
**Focus**: Pathfinding (Pathfinder), high-efficiency aggregation routers, and Fusion (off-chain matching).

## 1. Aggregation Router V6 (Core Interface)

Mainnet Router: `0x111111125421cA6dc452d289314280a0f8842A65`

### 1.1 The `swap` Function
```solidity
struct SwapDescription {
    address srcToken;
    address dstToken;
    address srcReceiver;
    address dstReceiver;
    uint256 amount;
    uint256 minReturnAmount;
    uint256 flags;
}

function swap(
    address executor,
    SwapDescription calldata desc,
    bytes calldata data
) external payable returns (uint256 returnAmount, uint256 spentAmount);
```

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: NEVER manually construct the `data` field for complex routes. ALWAYS use the 1inch `/swap` API to generate the `executor` and `data` parameters.
- **RULE 02**: Verify `minReturnAmount`. 1inch splits trades across multiple DEXs; ensure the aggregate return satisfies the slippage tolerance.
- **RULE 03**: For MEV protection, use **Fusion Mode**. Fusion orders are filled by "resolvers" off-chain, preventing front-running on-chain.

## 3. High-Lethality Patterns

### 3.1 Optimized Swap Types
| Function | Use Case | Pattern |
| :--- | :--- | :--- |
| `unoswap` | Simple 1-hop or direct pool swap | `unoswap(srcToken, amount, minReturn, pools)` |
| `clipperSwap` | Swapping through Clipper LP | `clipperSwap(srcToken, dstToken, amount, minReturn)` |
| `uniswapV3Swap` | Optimized UniV3 route | `uniswapV3Swap(amount, minReturn, pools)` |

### 3.2 Flag Bitmasking
- `0x01`: Partial fill allowed.
- `0x02`: Use `permit` for approval.
- `0x04`: Source token is ETH (native).

## 4. Mathematical Invariants
- **Pathfinder Invariant**: The algorithm seeks to maximize `returnAmount` by solving a graph-based optimization problem where edges are DEX pools and weights are liquidity/price.

## 5. Legion Use Cases
- **Liquidity Aggregator**: Use 1inch as the primary execution engine for all Legion "Closer" operations to ensure best-price execution.
- **Arbitrage Entry**: Use 1inch to swap large chunks of capital into the target asset of a cross-chain or cross-protocol arbitrage loop.
- **Gasless Swap (Fusion)**: Trigger Fusion orders from Legion to execute trades without holding native gas tokens on the execution account.
