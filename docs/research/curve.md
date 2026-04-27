# Logic-Map: Curve Finance (Stable Liquidity & Reward Telemetry)

**Target Repository**: `https://github.com/curvefi/curve-contract`
**Focus**: Stable S# Logic-Map: Curve Finance (StableSwap Invariants)

**Target Repository**: `https://github.com/curvefi/curve-contract`
**Focus**: Low-slippage stable swaps and meta-pool mechanics.

## 1. Mathematical Invariant (StableSwap)

The core equation combining constant sum and constant product:
$$A n^n \sum x_i + D = A D n^n + \frac{D^{n+1}}{n^n \prod x_i}$$

- **$A$**: Amplification coefficient. Higher $A$ = flatter curve (less slippage near peg).
- **$D$**: Total pool deposits (invariant).
- **$n$**: Number of tokens in the pool.

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: ALWAYS account for token decimals. Curve pools do not normalize to 1e18 internally; indices represent tokens with their native decimals (e.g., USDC = 6, DAI = 18).
- **RULE 02**: Use `min_dy` in `exchange` to prevent sandwich attacks. Calculate `min_dy` as `get_dy * (1 - slippage_tolerance)`.
- **RULE 03**: For Metapools (Base Pool + New Token), use `exchange_underlying` to swap directly between the new token and base pool constituents.

## 3. High-Lethality Patterns

### 3.1 Basic Exchange (3Pool Example)
```solidity
// Indices: DAI=0, USDC=1, USDT=2
interface IStableSwap3Pool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external;
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
}

// pattern: Swap 1000 DAI for USDC
uint256 dy = pool.get_dy(0, 1, 1000 * 1e18);
pool.exchange(0, 1, 1000 * 1e18, dy * 99 / 100); // 1% slippage
```

### 3.2 LP Token Price (The "Virtual Price")
`get_virtual_price()` returns the value of 1 LP token in the pool's base currency (e.g., USD). It only increases due to fees.
**Lethality**: If `get_virtual_price` drops, a malicious pool owner or exploit is likely occurring (invariant violation).

### 3.3 Registry Discovery
Mainnet Registry: `0x90E01980302b17726a9D7f8b9e4aB9d40e34c982`
Use `get_pool_from_lp_token(address)` or `get_coins(address)` to dynamically resolve pool layouts.

## 4. Operational Indices (Core Pools)
| Pool | Token 0 | Token 1 | Token 2 |
| :--- | :--- | :--- | :--- |
| **3Pool** | DAI | USDC | USDT |
| **stETH** | ETH | stETH | - |
| **Frax** | FRAX | 3CRV | - |

## 5. Legion Use Cases
- **Liquidity Scout**: Monitor `A` changes via `RampA` events to predict slippage volatility.
- **Arbitrage**: Curve-Uniswap cycles using `get_dy` for real-time price estimation.
- **Stable-Pair Guard**: Monitor `get_virtual_price` to detect depeg events in real-time.
ctrl+waps,# Logic-Map: Curve Finance (StableSwap Invariants)

**Target Repository**: `https://github.com/curvefi/curve-contract`
**Focus**: Low-slippage stable swaps and meta-pool mechanics.

## 1. Mathematical Invariant (StableSwap)

The core equation combining constant sum and constant product:
$$A n^n \sum x_i + D = A D n^n + \frac{D^{n+1}}{n^n \prod x_i}$$

- **$A$**: Amplification coefficient. Higher $A$ = flatter curve (less slippage near peg).
- **$D$**: Total pool deposits (invariant).
- **$n$**: Number of tokens in the pool.

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: ALWAYS account for token decimals. Curve pools do not normalize to 1e18 internally; indices represent tokens with their native decimals (e.g., USDC = 6, DAI = 18).
- **RULE 02**: Use `min_dy` in `exchange` to prevent sandwich attacks. Calculate `min_dy` as `get_dy * (1 - slippage_tolerance)`.
- **RULE 03**: For Metapools (Base Pool + New Token), use `exchange_underlying` to swap directly between the new token and base pool constituents.

## 3. High-Lethality Patterns

### 3.1 Basic Exchange (3Pool Example)
```solidity
// Indices: DAI=0, USDC=1, USDT=2
interface IStableSwap3Pool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external;
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
}

// pattern: Swap 1000 DAI for USDC
uint256 dy = pool.get_dy(0, 1, 1000 * 1e18);
pool.exchange(0, 1, 1000 * 1e18, dy * 99 / 100); // 1% slippage
```

### 3.2 LP Token Price (The "Virtual Price")
`get_virtual_price()` returns the value of 1 LP token in the pool's base currency (e.g., USD). It only increases due to fees.
**Lethality**: If `get_virtual_price` drops, a malicious pool owner or exploit is likely occurring (invariant violation).

### 3.3 Registry Discovery
Mainnet Registry: `0x90E01980302b17726a9D7f8b9e4aB9d40e34c982`
Use `get_pool_from_lp_token(address)` or `get_coins(address)` to dynamically resolve pool layouts.

## 4. Operational Indices (Core Pools)
| Pool | Token 0 | Token 1 | Token 2 |
| :--- | :--- | # Logic-Map: Curve Finance (StableSwap Invariants)

**Target Repository**: `https://github.com/curvefi/curve-contract`
**Focus**: Low-slippage stable swaps and meta-pool mechanics.

## 1. Mathematical Invariant (StableSwap)

The core equation combining constant sum and constant product:
$$A n^n \sum x_i + D = A D n^n + \frac{D^{n+1}}{n^n \prod x_i}$$

- **$A$**: Amplification coefficient. Higher $A$ = flatter curve (less slippage near peg).
- **$D$**: Total pool deposits (invariant).
- **$n$**: Number of tokens in the pool.

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: ALWAYS account for token decimals. Curve pools do not normalize to 1e18 internally; indices represent tokens with their native decimals (e.g., USDC = 6, DAI = 18).
- **RULE 02**: Use `min_dy` in `exchange` to prevent sandwich attacks. Calculate `min_dy` as `get_dy * (1 - slippage_tolerance)`.
- **RULE 03**: For Metapools (Base Pool + New Token), use `exchange_underlying` to swap directly between the new token and base pool constituents.

## 3. High-Lethality Patterns

### 3.1 Basic Exchange (3Pool Example)
```solidity
// Indices: DAI=0, USDC=1, USDT=2
interface IStableSwap3Pool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external;
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
}

// pattern: Swap 1000 DAI for USDC
uint256 dy = pool.get_dy(0, 1, 1000 * 1e18);
pool.exchange(0, 1, 1000 * 1e18, dy * 99 / 100); // 1% slippage
```

### 3.2 LP Token Price (The "Virtual Price")
`get_virtual_price()` returns the value of 1 LP token in the pool's base currency (e.g., USD). It only increases due to fees.
**Lethality**: If `get_virtual_price` drops, a malicious pool owner or exploit is likely occurring (invariant violation).

### 3.3 Registry Discovery
Mainnet Registry: `0x90E01980302b17726a9D7f8b9e4aB9d40e34c982`
Use `get_pool_from_lp_token(address)` or `get_coins(address)` to dynamically resolve pool layouts.

## 4. Operational Indices (Core Pools)
| Pool | Token 0 | Token 1 | Token 2 |
| :--- | :--- | :--- # Logic-Map: Curve Finance (StableSwap Invariants)

**Target Repository**: `https://github.com/curvefi/curve-contract`
**Focus**: Low-slippage stable swaps and meta-pool mechanics.

## 1. Mathematical Invariant (StableSwap)

The core equation combining constant sum and constant product:
$$A n^n \sum x_i + D = A D n^n + \frac{D^{n+1}}{n^n \prod x_i}$$

- **$A$**: Amplification coefficient. Higher $A$ = flatter curve (less slippage near peg).
- **$D$**: Total pool deposits (invariant).
- **$n$**: Number of tokens in the pool.

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: ALWAYS account for token decimals. Curve pools do not normalize to 1e18 internally; indices represent tokens with their native decimals (e.g., USDC = 6, DAI = 18).
- **RULE 02**: Use `min_dy` in `exchange` to prevent sandwich attacks. Calculate `min_dy` as `get_dy * (1 - slippage_tolerance)`.
- **RULE 03**: For Metapools (Base Pool + New Token), use `exchange_underlying` to swap directly between the new token and base pool constituents.

## 3. High-Lethality Patterns

### 3.1 Basic Exchange (3Pool Example)
```solidity
// Indices: DAI=0, USDC=1, USDT=2
interface IStableSwap3Pool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external;
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
}

// pattern: Swap 1000 DAI for USDC
uint256 dy = pool.get_dy(0, 1, 1000 * 1e18);
pool.exchange(0, 1, 1000 * 1e18, dy * 99 / 100); // 1% slippage
```

### 3.2 LP Token Price (The "Virtual Price")
`get_virtual_price()` returns the value of 1 LP token in the pool's base currency (e.g., USD). It only increases due to fees.
**Lethality**: If `get_virtual_price` drops, a malicious pool owner or exploit is likely occurring (invariant violation).

### 3.3 Registry Discovery
Mainnet Registry: `0x90E0198# Logic-Map: Curve Finance (StableSwap Invariants)

**Target Repository**: `https://github.com/curvefi/curve-contract`
**Focus**: Low-slippage stable swaps and meta-pool mechanics.

## 1. Mathematical Invariant (StableSwap)

The core equation combining constant sum and constant product:
$$A n^n \sum x_i + D = A D n^n + \frac{D^{n+1}}{n^n \prod x_i}$$

- **$A$**: Amplification coefficient. Higher $A$ = flatter curve (less slippage near peg).
- **$D$**: Total pool deposits (invariant).
- **$n$**: Number of tokens in the pool.

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: ALWAYS account for token decimals. Curve pools do not normalize to 1e18 internally; indices represent tokens with their native decimals (e.g., USDC = 6, DAI = 18).
- **RULE 02**: Use `min_dy` in `exchange` to prevent sandwich attacks. Calculate `min_dy` as `get_dy * (1 - slippage_tolerance)`.
- **RULE 03**: For Metapools (Base Pool + New Token), use `exchange_underlying` to swap directly between the new token and base pool constituents.

## 3. High-Lethality Patterns

### 3.1 Basic Exchange (3Pool Example)
```solidity
// Indices: DAI=0, USDC=1, USDT=2
interface IStableSwap3Pool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external;
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
}

// pattern: Swap 1000 DAI for USDC
uint256 dy = pool.get_dy(0, 1, 1000 * 1e18);
pool.exchange(0, 1, 1000 * 1e18, dy * 99 / 100); // 1% slippage
```

### 3.2 LP Token Price (The "Virtual Price")
`get_virtual_price()` returns the value of 1 LP token in the pool's base currency (e.g., USD). It only increases due to fees.
**Lethality**: If `get_virtual_price` drops, a malicious pool owner or exploit is likely occurring (invariant violation).

### 3.3 Registry Discovery
Mainnet Registry: `0x90E01980302b17726a9D7f8b9e4aB9d40e34c982`
Use `get_pool_from_lp_token(address)` or `get_coins(address)` to dynamically resolve pool layouts.

## 4. Operational Indices (Core Pools)
| Pool | Token 0 | Token 1 | Token 2 |
| :--- | :--- | :--- | :--- |
| **3Pool** | DAI | USDC | USDT |
| **stETH** | ETH | stETH | - |
| **Frax** | FRAX | 3CRV | - |

## 5. Legion Use Cases
- **Liquidity Scout**: Monitor `A` changes via `RampA` events to predict slippage volatility.
- **Arbitrage**: Curve-Uniswap cycles using `get_dy` for real-time price estimation.
- **Stable-Pair Guard**: Monitor `get_virtual_price` to detect depeg events in real-time.
ctrl+0302b17726a9D7f8b9e4aB9d40e34c982`
Use `get_pool_from_lp_token(address)` or `get_coins(address)` to dynamically resolve pool layouts.

## 4. Operational Indices (Core Pools)
| Pool | Token 0 | Token 1 | Token 2 |
| :--- | :--- | :--- | :--- |
| **3Pool** | DAI | USDC | USDT |
| **stETH** | ETH | stETH | - |
| **Frax** | FRAX | 3CRV | - |

## 5. Legion Use Cases
- **Liquidity Scout**: Monitor `A` changes via `RampA` events to predict slippage volatility.
- **Arbitrage**: Curve-Uniswap cycles using `get_dy` for real-time price estimation.
- **Stable-Pair Guard**: Monitor `get_virtual_price` to detect depeg events in real-time.
ctrl+| :--- |
| **3Pool** | DAI | USDC | USDT |
| **stETH** | ETH | stETH | - |
| **Frax** | FRAX | 3CRV | - |

## 5. Legion Use Cases
- **Liquidity Scout**: Monitor `A` changes via `RampA` events to predict slippage volatility.
- **Arbitrage**: Curve-Uniswap cycles using `get_dy` for real-time price estimation.
- **Stable-Pair Guard**: Monitor `get_virtual_price` to detect depeg events in real-time.
ctrl+:--- | :--- |
| **3Pool** | DAI | USDC | USDT |
| **stETH** | ETH | stETH | - |
| **Frax** | FRAX | 3CRV | - |

## 5. Legion Use Cases
- **Liquidity Scout**: Monitor `A` changes via `RampA` events to predict slippage volatility.
- **Arbitrage**: Curve-Uniswap cycles using `get_dy` for real-time price estimation.
- **Stable-Pair Guard**: Monitor `get_virtual_price` to detect depeg events in real-time.
ctrl+ Metapools, and Gauge-based Asset Telemetry.

## 🏗️ Architecture Overview

Curve specializes in low-slippage swaps between correlated assets (e.g., stablecoins, liquid staking tokens). For Legion Engine, this defines the **Scout (Discovery)** and **Closer (Execution)** sentinels for deep liquidity venues.

- **`contracts/pool-templates/StableSwap.vy`**: The core logic for exchange and liquidity provision.
- **`contracts/GaugeController.vy`**: Manages the allocation of rewards across different pools.
- **`contracts/Registry.vy`**: The source of truth for all deployed pools and their meta-data.

## 🔍 Core Patterns to Copy

1. **Stable Asset Telemetry (Scout)**:
   - Curve pools use an "Amplification Coefficient" (A) to concentrate liquidity.
   - **Legion Application**: The **Scout** sentinel monitors "A-parameter" shifts to calculate the "Lethality" of a large trade before executing an extraction lane.

2. **Metapool DNA (Closer)**:
   - Metapools allow one asset to be traded against a base pool (e.g., LUSD vs 3Pool).
   - **Legion Application**: The **Closer** sentinel treats Metapools as "Recursive Liquidity Lanes," enabling multi-layered asset extraction in a single transaction.

3. **Gauge Reward Extraction (Closer)**:
   - Assets in Curve often accumulate rewards (CRV, etc.) in Gauges.
   - **Legion Application**: The **Closer** sentinel implements "Atomic Reward Harvesting" to ensure no value is left behind during a "Sovereign Sync."

## 🛤️ Execution Flow (Logic Map)

1. **Identification**: `Registry.vy` identifies the pool for a specific asset pair.
2. **Quoting**: `get_dy` calculates the output amount for a swap.
3. **Execution**: `exchange` or `exchange_underlying` is called.
4. **Liquidity**: `add_liquidity` and `remove_liquidity` manage the asset base.
5. **Harvesting**: `claim_rewards` extracts accumulated incentives from the Gauge.

## 📂 Key File References

- `contracts/pool-templates/base/StableSwap.vy`: Core swap invariant logic.
- `contracts/Registry.vy`: Pattern for protocol-wide discovery.
- `contracts/liquidity_gauge/LiquidityGaugeV5.vy`: Reward distribution state machine.
