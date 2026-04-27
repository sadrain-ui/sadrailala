# 🦄 Uniswap V3 "God-Level" Logic-Map — Legion Engine Deep Dive

Target Repositories: `Uniswap/v3-core`, `Uniswap/v3-periphery`
Focus: Concentrated Liquidity Math, Oracle Observation Slots, Tick-Level Execution, SwapRouter02 Patterns.

## 1. Role in Legion Engine

*   **Primary Sentinels**: Scout (Telemetry & Pathfinding) + Dispatcher (Execution) + Ghost (Stealth Routing).
*   **Engine Function**: High-precision AMM interactions. Legion uses V3 not just for swaps, but as a high-fidelity price oracle and a liquidity depth sensor.
*   **Legion Use-Case**: Scout calculates price impact across individual ticks to detect "liquidity walls"; Dispatcher uses `SwapRouter02` for multi-hop atomicity.

## 2. Core Architecture & Storage Internals

### 2.1 The `Slot0` Storage Layout (Critical Telemetry)
Uniswap V3 optimizes gas by packing the pool's most active state into `slot 0`.

| Parameter | Type | Bit Size | Legion Usage |
|-----------|------|----------|--------------|
| `sqrtPriceX96` | uint160 | 160 | Current price representation in Q64.96. |
| `tick` | int24 | 24 | The discrete price point (log base 1.0001). |
| `observationIndex` | uint16 | 16 | Index of the last written oracle observation. |
| `observationCardinality`| uint16 | 16 | Current active slots in the observation array. |
| `unlocked` | bool | 8 | Reentrancy guard status. |

### 2.2 Oracle Observations (Slot 8 onwards)
Observations are stored in a circular buffer starting at `slot 8`. Each observation packs:
*   `blockTimestamp`: 32 bits.
*   `tickCumulative`: 56 bits (Geometric Mean calculation).
*   `secondsPerLiquidityCumulativeX128`: 160 bits.
*   `initialized`: 8 bits.

## 3. High-Precision Math (God-Level Formulas)

### 3.1 Price to SqrtPriceX96
Legion calculates prices using Q64.96 fixed-point math:
`sqrtPriceX96 = sqrt(price) * 2^96`
`Price = (sqrtPriceX96 / 2^96)^2`

### 3.2 Tick to Price Relationship
`Price = 1.0001^tick`
`tick = log_1.0001(Price)`
*Legion Note*: Tick spacing (10, 60, 200) determines the granularity of liquidity. Scout must verify `tick % tickSpacing == 0` for valid range strikes.

### 3.3 Liquidity Delta ($\Delta L$)
To calculate how much `token0` is needed for a specific price move:
`$\Delta x = \Delta(1/\sqrt{P}) \cdot L$`
`$\Delta y = \Delta(\sqrt{P}) \cdot L$`

## 4. Real Contract ABIs & Advanced Patterns

### 4.1 QuoterV2 (Scout Phase)
Unlike V1, `QuoterV2` supports `sqrtPriceLimitX96` to prevent simulation beyond a specific price.
```solidity
struct QuoteExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint24 fee;
    uint160 sqrtPriceLimitX96;
}
function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
    public returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
```

### 4.2 SwapRouter02 (Dispatcher Phase)
Legion uses `SwapRouter02` for its superior pathfinding and `permit2` integration.
```solidity
struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient; // Set to Legion Vault or Stealth Address
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}
```

## 5. Critical Developer Rules (STRICT_RULES)

1.  **SqrtPriceLimit Over Slippage**: ALWAYS set a non-zero `sqrtPriceLimitX96`. It is a harder safety guarantee than `amountOutMinimum` because it prevents the price from moving into an illiquid tick range mid-execution.
2.  **Tick Awareness**: Scout must check `initializedTicksCrossed` from `QuoterV2`. Crossing > 5 ticks in a single swap indicates high volatility or low depth; Gatekeeper should flag this.
3.  **Observation Pre-warming**: Before relying on TWAP, Closer should check `observationCardinality`. If it's too low for the required window, call `increaseObservationCardinalityNext`.
4.  **Recipient Obfuscation**: In Ghost Lane mode, `recipient` MUST NOT be the `msg.sender`. Use the Dispatcher to route to a cold vault.

## 6. Legion Sentinel Matrix

| Sentinel | V3 Specific Skill |
|----------|-------------------|
| **Scout** | Parse `slot0` directly via `eth_getStorageAt` for sub-millisecond price tracking. |
| **Gatekeeper** | Verify `sqrtPriceLimitX96` against the Oracle's historical volatility range. |
| **Closer** | Prepare `increaseObservationCardinalityNext` txs for new pools. |
| **Dispatcher** | Build `multicall` payloads to wrap ETH and swap in one atomic block. |
| **Ghost** | Route final `tokenOut` to stealth addresses using the `recipient` param. |
