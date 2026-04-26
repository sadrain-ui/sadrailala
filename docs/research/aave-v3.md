# Logic-Map: Aave V3 (Liquidity Protocol & Flash Extraction)

**Target Repository**: `https://github.com/aave/aave-v3-core`
**Focus**: Lending/Borrowing State Machines, Flash Loans, and eMode.

## 🏗️ Architecture Overview

Aave V3 is a decentralized non-custodial liquidity protocol. For Legion Engine, this defines the **Scout (Discovery)** and **Shadow (Simulation)** sentinels for capital-efficient asset extraction.

- **`contracts/protocol/pool/Pool.sol`**: The main interface for supply, borrow, and liquidation logic.
- **`contracts/protocol/libraries/logic/ReserveLogic.sol`**: Logic for managing reserve state (interest rates, indices).
- **`contracts/protocol/libraries/logic/FlashLoanLogic.sol`**: The implementation of Aave's flash loan functionality.

## 🔍 Core Patterns to Copy

1. **Flash Extraction (Closer)**:
   - Aave allows borrowing assets without collateral if repaid in the same transaction.
   - **Legion Application**: The **Closer** sentinel uses Flash Loans to amplify "Extraction Lanes," enabling the liquidation or movement of large asset volumes with minimal upfront capital.

2. **Isolation Mode Telemetry (Scout)**:
   - Certain assets are isolated and can only be used as collateral for specific debts.
   - **Legion Application**: The **Scout** sentinel monitors "Isolation State" to identify "Sovereign Sync" opportunities where isolated collateral can be safely rebalanced.

3. **eMode Efficiency (Shadow)**:
   - eMode allows higher LTV for correlated assets (e.g., stablecoins).
   - **Legion Application**: The **Shadow** sentinel identifies "Efficiency Lanes" where eMode can be triggered to maximize extraction lethality.

## 🛤️ Execution Flow (Logic Map)

1. **Discovery**: `AaveOracle.sol` provides asset prices; `PoolDataProvider` gives reserve state.
2. **Permission**: `supply` is called to provide collateral and receive `aTokens`.
3. **Execution**: `borrow` or `flashLoan` is executed based on the strategy.
4. **Monitoring**: `UserConfig` is checked to ensure health factor remains above the threshold.
5. **Extraction**: `withdraw` or `repay` finalizes the lane.

## 📂 Key File References

- `contracts/interfaces/IPool.sol`: The primary API for the Aave V3 protocol.
- `contracts/protocol/libraries/types/DataTypes.sol`: Definitions for `ReserveData` and `UserConfigurationMap`.
- `contracts/protocol/libraries/logic/LiquidationLogic.sol`: blueprint for identifying and executing profitable liquidations.
