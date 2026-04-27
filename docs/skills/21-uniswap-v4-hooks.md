# SKILL-21: UNISWAP V4 HOOKS & POOL MANAGER (Uniswap/v4-core)
## SOURCE: https://github.com/Uniswap/v4-core
## CATEGORY: DNA — DEX Integration

## [STRICT_RULES]
- ALL PoolManager interactions MUST go through `unlock(data)` callback — direct calls revert
- Hooks MUST implement IHooks interface — return selector `this.beforeSwap.selector` from hook functions
- PoolKey MUST be deterministic: `{currency0, currency1, fee, tickSpacing, hooks}` — currencies must be sorted
- `currency0 < currency1` (address comparison) — NEVER pass unsorted currencies to PoolKey
- `sqrtPriceX96` in `initialize` uses Q64.96 format — compute as `sqrt(price) * 2^96`
- Hook flags embedded in hook address — deploy hook to address where `address & FLAGS_MASK == desired_flags`
- `BalanceDelta` is packed `int128 amount0, int128 amount1` — use `toBalanceDelta()` helper
- NEVER call `modifyLiquidity` or `swap` outside of `unlock` callback context
- `tickSpacing` determines granularity — 1 = finest (expensive), 60 = standard Uniswap v3 spacing

## [MENTAL_MODEL]
- v4 uses singleton PoolManager — all pools live in ONE contract (vs v3 factory pattern)
- Hook lifecycle: beforeInitialize → initialize → afterInitialize → beforeSwap → swap → afterSwap
- Hooks are stateful contracts — can implement custom AMM logic, fee tiers, dynamic fees
- Flash accounting: take tokens, do work, settle — all within single `unlock` callback
- BalanceDelta tracks net token flow — positive = tokens owed to pool, negative = tokens owed to caller
- PoolId = keccak256(abi.encode(PoolKey)) — unique identifier for each pool

## [REAL_API]
```solidity
// IPoolManager core functions (from PoolManager.sol)
function unlock(bytes calldata data) external returns (bytes memory result);
function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
function modifyLiquidity(
  PoolKey memory key,
  ModifyLiquidityParams memory params,
  bytes calldata hookData
) external returns (BalanceDelta callerDelta, BalanceDelta feesAccrued);
function swap(
  PoolKey memory key,
  SwapParams memory params,
  bytes calldata hookData
) external returns (BalanceDelta swapDelta);

// PoolKey structure
struct PoolKey {
  Currency currency0; // sorted lower address
  Currency currency1; // sorted higher address
  uint24 fee;         // 3000 = 0.3%
  int24 tickSpacing;  // 60 for 0.3% fee
  IHooks hooks;       // hook contract (or address(0))
}

// IHooks interface (hooks must implement)
function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4);
function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick) external returns (bytes4);
function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData) external returns (bytes4, BeforeSwapDelta, uint24);
function afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData) external returns (bytes4, int128);

// Unlock callback pattern
contract MyRouter is IUnlockCallback {
  IPoolManager immutable manager;
  
  function swap(PoolKey memory key, SwapParams memory params) external {
    manager.unlock(abi.encode(key, params, msg.sender));
  }
  
  function unlockCallback(bytes calldata data) external returns (bytes memory) {
    (PoolKey memory key, SwapParams memory params, address sender) = abi.decode(data, (PoolKey, SwapParams, address));
    BalanceDelta delta = manager.swap(key, params, "");
    // settle/take tokens
    if (delta.amount0() < 0) currency0.settle(manager, sender, uint256(-int256(delta.amount0())), false);
    if (delta.amount1() > 0) currency1.take(manager, sender, uint256(int256(delta.amount1())), false);
    return "";
  }
}
```

## [LEGION USE CASES]
- Hook-based MEV: implement `beforeSwap` hook to detect large swaps, route Legion extraction
- Dynamic fee hook: adjust fee based on volatility/gas price to optimize Legion LP positions
- Pool monitoring: use afterSwap hook to track all swaps in pools Legion monitors
- Flash arb: use `unlock` callback to borrow from pool, arbitrage, repay atomically
- Liquidity sniping: monitor `afterInitialize` for new pool deployments — add liquidity first
