# STRICT_RULES
1. ALWAYS prioritize `sqrtPriceLimitX96` over `amountOutMinimum`. It prevents execution in low-liquidity zones.
2. Scout MUST parse `slot0` (storage slot 0) directly for real-time price telemetry to beat standard provider latency.
3. Every swap through a new pool requires checking `observationCardinality`. If < 10, call `increaseObservationCardinalityNext`.
4. Ghost Lane: Use the `recipient` parameter in `exactInput` to break the on-chain link between the sender and the fund vault.

# MENTAL_MODEL
Uniswap V3 is a discrete liquidity engine. Ticks (log 1.0001) define price boundaries. Storage is optimized (Slot0/Slot8) for gas. Execution isn't just a swap; it's a price impact simulation that can cross multiple initialized ticks, changing available liquidity mid-transaction.

# REAL_API
### Pool State (Sub-millisecond Telemetry)
- `slot0()`: Returns `sqrtPriceX96`, `tick`, `observationIndex`, `observationCardinality`, etc.
- `observations(uint256 index)`: Returns historical price/liquidity data for TWAP.
- `liquidity()`: Returns current in-range liquidity (L).

### Periphery (Execution)
- `QuoterV2.quoteExactInputSingle`: Returns `amountOut` and `sqrtPriceX96After` for impact analysis.
- `SwapRouter02.exactInputSingle`: Standard entry for Legion Dispatcher.

# LEGION USE CASES
1. **Liquidity Depth Sensing**: Scout monitors `initializedTicksCrossed` to flag "thin" pools.
2. **Oracle Shielding**: Gatekeeper compares transaction price against `tickCumulative` TWAP to prevent front-running/sandwiching.
3. **Atomic Multi-hop**: Dispatcher executes complex paths (e.g., WBTC -> WETH -> USDC) ensuring profit atomicity.
