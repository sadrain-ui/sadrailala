# Logic-Map: Curve Finance (Stable Liquidity & Reward Telemetry)

**Target Repository**: `https://github.com/curvefi/curve-contract`
**Focus**: Stable Swaps, Metapools, and Gauge-based Asset Telemetry.

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
