# 44: Uniswap V3 Concentrated Liquidity Skill

## STRICT_RULES
1. **Always use QuoterV2** — never assume price from pool state; always call `quoteExactInputSingle` to account for tick-cross gas and exact slippage.
2. **Set `recipient` to Legion Vault** — never swap to a source wallet; use the `recipient` parameter in `exactInputSingle` for ghost routing.
3. **Verify `sqrtPriceLimitX96`** — Dispatcher must set a price limit to prevent the trade from executing beyond the target tick range.
4. **Fee Tier Selection** — Scout must discover the best fee tier (0.01%, 0.05%, 0.3%, or 1%) as liquidity varies significantly between tiers.

## MENTAL_MODEL
Uniswap V3 provides concentrated liquidity, allowing Legion to execute large swaps with high capital efficiency. The skill follows the standard Legion split:
* **Scout (Read)**: Calls `QuoterV2.quoteExactInputSingle` to discover optimal routes and fee tiers.
* **Gatekeeper (Validate)**: Ensures `amountOut` meets the lethality floor and `gasEstimate` is viable.
* **Dispatcher (Write)**: Builds `exactInputSingle` or `exactInput` calldata for execution via SwapRouter02.

## REAL_API
### SwapRouter02 (`0x68b3465833fb72A70ecdf485E0e4C7bD8665Fc45`)
```solidity
struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}

function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
```

### QuoterV2 (`0x61fFE01691351bdC959b02013f84488bfa6A3393`)
```solidity
struct QuoteExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint24 fee;
    uint160 sqrtPriceLimitX96;
}

function quoteExactInputSingle(QuoteExactInputSingleParams memory params) 
    public 
    returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
```

## LEGION USE CASES
### 1. High-Impact Range Strike
Scout monitors Uniswap V3 ticks. If a price gap is detected, Dispatcher executes a swap targeting a specific tick range, capturing the liquidity before the market rebalances.

### 2. Ghost Lane Multi-Hop
Dispatcher uses the multi-hop `exactInput` method with a `path` parameter and sets `recipient` to a stealth vault, breaking the on-chain link between the source and destination assets.
