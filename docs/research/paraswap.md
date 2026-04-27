# Logic-Map: ParaSwap (Augustus Protocol)

**Target Repository**: `https://github.com/paraswap/paraswap-augustus`
**Focus**: Multi-path routing (MegaSwap), gas efficiency via virtual price impact, and partner-based liquidity access.

## 1. Augustus Router V6.2 (Core Interface)

Mainnet Router: `0x6a000f20005980200259b80c5102003040001068`

### 1.1 The `multiSwap` Function
```solidity
struct Route {
    address payable exchange;
    address targetExchange;
    uint percent;
    bytes payload;
    uint256 networkFee;
}

struct Path {
    address to;
    uint256 totalNetworkFee;
    Route[] routes;
}

function multiSwap(
    IERC20 fromToken,
    IERC20 toToken,
    uint256 fromAmount,
    uint256 toAmount,
    uint256 expectedAmount,
    Path[] calldata path,
    // ... metadata
) external payable;
```

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: ParaSwap V6 had a critical vulnerability. ALWAYS verify you are interacting with V6.2+ contracts.
- **RULE 02**: Use `GenericSwap` functions for simple, direct swaps to save gas over the complex `multiSwap` entry point.
- **RULE 03**: Verify `expectedAmount` vs `toAmount` (min return). ParaSwap's API provides a theoretical best price; the on-chain execution must strictly adhere to the user's slippage limit.

## 3. High-Lethality Patterns

### 3.1 RFQ (Request For Quote) Integration
ParaSwap integrates private market makers. These routes often provide better prices for large volumes than public AMMs but require specific signature payloads in the `Path` struct.

### 3.2 Token Transfer Proxy
ParaSwap uses a separate `TokenTransferProxy` to handle approvals. Approving the router itself may not be sufficient for all swap types.

## 4. Operational API Surface
| Endpoint | Description | Legion Pattern |
| :--- | :--- | :--- |
| `GET /prices` | Fetch optimal route and quote | `Scout` phase discovery. |
| `POST /transactions` | Build signed calldata | `Dispatcher` phase execution. |
| `GET /adapters` | List active DEX adapters | Verify liquidity source coverage. |

## 5. Legion Use Cases
- **Gas-Optimized Routing**: Use ParaSwap for chains with high gas costs (like Mainnet) where Augustus's virtual impact model provides significant savings.
- **Partner Arbitrage**: Leverage ParaSwap's partner registry to access private liquidity pools not available on standard aggregators.
- **Multi-Chain Closer**: Execute cross-chain rebalancing using ParaSwap as the local aggregator on the target chain.
