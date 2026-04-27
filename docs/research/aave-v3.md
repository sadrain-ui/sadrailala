# Logic-Map: Aave V3 (Liquidity Protocol & Flash Extraction)

**Target Repository**: `https://github.com/aave/aave-v3-core`  
**Focus**: Lending/Borrowing State Machines, Flash Loans, eMode, Liquidation Math

## 🏗 Architecture Overview

Aave V3 is a decentralized non-custodial liquidity protocol. For Legion Engine, this defines the **Scout** (Discovery) and **Shadow** (Simulation) sentinels for capital-efficient asset extraction.

### Core Contracts
- **`contracts/protocol/pool/Pool.sol`** (`0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2` on Ethereum): Main interface for supply, borrow, and liquidation
- **`contracts/protocol/libraries/logic/ReserveLogic.sol`**: Interest rate model, reserve state management  
- **`contracts/protocol/libraries/logic/FlashLoanLogic.sol`**: Flash loan execution and fee calculation  
- **`contracts/protocol/libraries/logic/LiquidationLogic.sol`**: Liquidation threshold checks, bonus calculation  
- **`contracts/protocol/libraries/logic/GenericLogic.sol`**: Health factor formula implementation

## 📘 Real API Signatures (IPool.sol)

### Supply & Withdraw
```solidity
// Deposit assets to receive aTokens (interest-bearing)
function supply(
  address asset,
  uint256 amount,
  address onBehalfOf,
  uint16 referralCode
) external;

// Withdraw underlying asset by burning aTokens
function withdraw(
  address asset,
  uint256 amount,  // type(uint256).max for full balance
  address to
) external returns (uint256);
```

### Borrow & Repay
```solidity
// Borrow assets against supplied collateral
function borrow(
  address asset,
  uint256 amount,
  uint256 interestRateMode,  // 1 = Stable, 2 = Variable
  uint16 referralCode,
  address onBehalfOf
) external;

// Repay borrowed assets
function repay(
  address asset,
  uint256 amount,  // type(uint256).max for full debt
  uint256 interestRateMode,
  address onBehalfOf
) external returns (uint256);
```

### Flash Loans
```solidity
// Multi-asset flash loan
function flashLoan(
  address receiverAddress,
  address[] calldata assets,
  uint256[] calldata amounts,
  uint256[] calldata interestRateModes,  // 0 = no debt, 1/2 = open debt position
  address onBehalfOf,
  bytes calldata params,
  uint16 referralCode
) external;

// Single-asset flash loan (gas-optimized)
function flashLoanSimple(
  address receiverAddress,
  address asset,
  uint256 amount,
  bytes calldata params,
  uint16 referralCode
) external;
```

**Flash Loan Fee**: `FLASHLOAN_PREMIUM_TOTAL = 0.05%` (5 bps)  
**Protocol Share**: `FLASHLOAN_PREMIUM_TO_PROTOCOL = 0.04%` (4 bps) → Treasury  
**LP Share**: `0.01%` (1 bps) → Liquidity providers

**Repayment**: `amountOwed = amount + (amount * FLASHLOAN_PREMIUM_TOTAL / 10000)`

### Liquidation
```solidity
// Liquidate undercollateralized positions
function liquidationCall(
  address collateralAsset,
  address debtAsset,
  address user,
  uint256 debtToCover,  // amount of debt to repay
  bool receiveAToken  // true = receive aToken, false = underlying
) external;
```

**Liquidation Rules**:  
- **Health Factor < 1.0** → position is liquidatable  
- **HF > 0.95**: max 50% of debt can be liquidated (if collateral & debt each > $2k)  
- **HF ≤ 0.95**: 100% of debt can be liquidated (`MAX_LIQUIDATION_CLOSE_FACTOR`)  
- **Liquidation Bonus**: 5-15% depending on asset (e.g., WETH = 5%, volatile altcoins = 15%)  

### Health Factor Formula
```solidity
// From GenericLogic.sol:calculateUserAccountData()
function getUserAccountData(address user) external view returns (
  uint256 totalCollateralBase,        // in base currency (USD-pegged)
  uint256 totalDebtBase,              // in base currency
  uint256 availableBorrowsBase,
  uint256 currentLiquidationThreshold,  // weighted avg of all collateral LTs
  uint256 ltv,                          // weighted avg LTV
  uint256 healthFactor
);

// Health Factor Math:
// HF = (totalCollateralBase * currentLiquidationThreshold / 10000) / totalDebtBase
// 
// Example:
// - Supply $10,000 ETH (LT = 82.5% = 8250 bps)
// - Borrow $6,000 USDC
// - HF = (10000 * 8250 / 10000) / 6000 = 8250 / 6000 = 1.375
//
// If ETH price drops and collateral is now worth $7,000:
// - HF = (7000 * 8250 / 10000) / 6000 = 5775 / 6000 = 0.9625
// - HF < 1.0 → LIQUIDATABLE
```

## 🔍 eMode (High Efficiency Mode)

**Category 1: Stablecoins** (USDC, USDT, DAI, FRAX, etc.)  
- LTV: 97%  
- Liquidation Threshold: 97.5%  
- Liquidation Penalty: 1%  

**Category 2: ETH Correlated** (WETH, wstETH, rETH, cbETH, etc.)  
- LTV: 92.5%  
- Liquidation Threshold: 95%  
- Liquidation Penalty: 1%  

**Enable eMode**: `setUserEMode(uint8 categoryId)`  
**Benefit**: Dramatically higher capital efficiency when both collateral and debt are in the same eMode category

## 🧠 Core Patterns to Copy

### 1. Flash Extraction (Closer)
Aave allows borrowing assets without collateral if repaid in the same transaction. **Legion Application**: The **Closer** sentinel uses flash loans to amplify "Extraction Lanes," enabling liquidation or movement of large asset volumes with minimal upfront capital.

```typescript
// Pseudo-code for flash loan extraction
const flashLoanAmount = parseEther('100')  // 100 WETH
const flashLoanParams = encodeFlashLoanParams({
  targetProtocol: 'compound',
  action: 'liquidate',
  targetUser: '0x...',
})

await pool.flashLoanSimple(
  legionExecutorAddress,
  WETH_ADDRESS,
  flashLoanAmount,
  flashLoanParams,
  0  // referralCode
)

// Inside executeOperation() callback:
// 1. Use 100 WETH to liquidate underwater position
// 2. Receive collateral with 5% bonus
// 3. Swap collateral to WETH
// 4. Repay 100.05 WETH to Aave
// 5. Keep profit
```

### 2. Isolation Mode Telemetry (Scout)
Certain assets are isolated and can only be used as collateral for specific debts. **Legion Application**: The **Scout** sentinel monitors "Isolation State" to identify "Sovereign Sync" opportunities where isolated collateral can be safely rebalanced.

### 3. eMode Efficiency (Shadow)
eMode allows higher LTV for correlated assets (e.g., stablecoins). **Legion Application**: The **Shadow** sentinel identifies "Efficiency Lanes" where eMode can be triggered to maximize extraction lethality.

## 🛤 Execution Flow (Logic Map)

1. **Discovery**: `AaveOracle.sol` provides asset prices; `PoolDataProvider.getReserveData()` gives reserve state  
2. **Permission**: `supply()` is called to provide collateral and receive `aTokens`  
3. **Execution**: `borrow()` or `flashLoan()` is executed based on strategy  
4. **Monitoring**: `getUserAccountData()` is checked to ensure health factor remains above threshold  
5. **Extraction**: `withdraw()` or `repay()` finalizes the lane  

## 📂 Key File References

- `contracts/interfaces/IPool.sol`: Primary API for Aave V3 protocol  
- `contracts/protocol/libraries/types/DataTypes.sol`: Definitions for `ReserveData` and `UserConfigurationMap`  
- `contracts/protocol/libraries/logic/LiquidationLogic.sol`: Blueprint for identifying and executing profitable liquidations  
- `contracts/protocol/libraries/logic/ValidationLogic.sol`: Validation rules for all pool actions  
- `contracts/protocol/libraries/math/PercentageMath.sol`: Basis point calculations (10000 = 100%)  

## 🔗 Contract Addresses

### Ethereum Mainnet
- **Pool**: `0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2`  
- **PoolAddressesProvider**: `0x2f39d218133afab8f2b819b1066c7e434ad94e9e`  
- **PoolDataProvider**: `0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3`  
- **AaveOracle**: `0x54586bE62E3c3580375aE3723C145253060Ca0C2`  

### Polygon
- **Pool**: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`  

### Arbitrum
- **Pool**: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`  

## 💡 Legion Use Cases

### 1. Flash Loan Arbitrage
```typescript
// Scout detects price discrepancy between Aave and external market
// Closer executes flash loan to capture arbitrage
// Shadow simulates the full flow before execution
```

### 2. Liquidation Hunting
```typescript
// Scout monitors getUserAccountData() for all major positions
// When HF < 1.0 detected:
//   - Calculate max liquidation amount (50% or 100% based on HF)
//   - Calculate profit: (debtToCover * liquidationBonus) - flashLoanFee
//   - If profitable: execute liquidationCall via flash loan
```

### 3. eMode Leverage Stacking
```typescript
// For stablecoin category (97% LTV):
// - Supply $1000 USDC
// - Borrow $970 DAI
// - Supply $970 DAI
// - Borrow $941 USDC
// - Repeat until max leverage (~33x)
```
