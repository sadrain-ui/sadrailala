# STRICT_RULES
1. ALWAYS interact with Comet proxy addresses, never direct implementations.
2. Distinguish between Base assets (interest-bearing) and Collateral assets (non-interest-bearing).
3. Rewards are NOT automatic; explicit `claim` calls to `CometRewards` are required.
4. Use `isBorrowCollateralized` for binary checks, but calculate custom Liquidation Margin for extraction.

# MENTAL_MODEL
Compound v3 (Comet) is a monolithic money market where each market is a separate proxy. Unlike v2's global comptroller, v3 isolates risk by having one borrowable asset per Comet instance. Users supply collateral to borrow the base asset. Efficiency is gained via Bulker batching.

# REAL_API
### Comet Interface
- `supply(address asset, uint amount)`: Supply base or collateral.
- `withdraw(address asset, uint amount)`: Withdraw base or collateral.
- `supplyTo(address dst, address asset, uint amount)`: Supply to a specific address.
- `withdrawTo(address to, address asset, uint amount)`: Withdraw to a specific address.
- `borrowBalanceOf(address account)`: Get account's borrow balance.
- `isBorrowCollateralized(address account)`: Check if borrow is collateralized.
- `allow(address manager, bool isAllowed)`: Set operators.

# LEGION USE CASES
1. **Scout (Telemetry)**: Monitors collateral ratios and utilization rates across different Comet proxies.
2. **Closer (Payload Prep)**: Builds batched transactions using Bulker for efficient `supply`/`borrow` or `claim` operations.
3. **Sovereign Asset Control**: High-efficiency lending against single base assets (USDC, WETH).
