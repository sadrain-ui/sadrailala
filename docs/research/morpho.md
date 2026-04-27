# Morpho Blue Logic-Map — Legion Engine Integration
ctrl+# Logic-Map: Morpho Blue (Minimalist Lending)

**Target Repository**: `https://github.com/morpho-org/morpho-blue`
**Focus**: Singleton architecture, permissionless market creation, and isolated risk.

## 1. Market Identification (ID Logic)

A market is uniquely identified by the hash of its parameters:
```solidity
struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

// Market ID calculation
bytes32 id = keccak256(abi.encode(marketParams));
```

## 2. STRICT_RULES: Execution Hardening

- **RULE 01**: ALWAYS pass the full `MarketParams` struct to functions. Morpho calculates the ID internally to save on `SLOAD` costs. Providing just the ID is often not supported for state-changing calls.
- **RULE 02**: Flash loans are FREE. Morpho Blue has a 0% fee for flash loans. Repayment must occur within the same transaction.
- **RULE 03**: Collateral is NOT lent out. Unlike Aave/Compound, collateral assets stay in the singleton and are never utilized by the borrow side.

## 3. High-Lethality Patterns

### 3.1 The Supply-Borrow Flow
```solidity
// 1. Supply Collateral
morpho.supply(marketParams, assets, 0, onBehalf, "");

// 2. Borrow Loan Token (shares calculated internally)
morpho.borrow(marketParams, assetsToBorrow, 0, onBehalf, receiver);
```

### 3.2 Flash Loan Pattern
```solidity
morpho.flashLoan(token, amount, data);

// Callback must be implemented:
function onMorphoFlashLoan(uint256 amount, bytes calldata data) external {
    // 1. Execute logic (arbitrage, leverage, etc.)
    // 2. Approve morpho to pull back the amount
    IERC20(token).approve(address(morpho), amount);
}
```

### 3.3 Interest Accrual
`accrueInterest(marketParams)` should be called manually before reading `totalBorrowAssets` or `totalSupplyAssets` if absolute precision is required for off-chain calculation.

## 4. Key Parameters & Constants
| Parameter | Description | Pattern |
| :--- | :--- | :--- |
| **LLTV** | Liquidation Loan-To-Value | `1e18` scale (e.g., `0.9e18` for 90%) |
| **IRM** | Interest Rate Model | Adaptive curve based on utilization. |
| **Oracle** | Price Feed | Agnostic (Chainlink, Chronicle, etc.) |

## 5. Legion Use Cases
- **Hyper-Efficient Flash Loans**: Use Morpho as the primary source for 0-fee liquidity in arbitrage loops.
- **Isolated Leverage**: Create custom leverage positions on niche collateral without systemic risk exposure.
- **Yield Aggregator**: Monitor `irm` adaptive curves to shift liquidity into markets with rising utilization.

Target Repository: `https://github.com/morpho-org/morpho-blue` Focus: Permissionless Lending, Singleton Architecture, Oracle-Agnostic Pricing, Zero-Fee Flash Loans.

## 1. Role in Legion Engine

- • **Primary Sentinel**: Scout (discovery) + Closer (payload prep).
- • **Function**: Permissionless lending markets with isolated risk.
- • **Legion Use-Case**: Scout monitors Morpho markets for high-yield supply opportunities; Closer builds supply/borrow payloads for multi-layered asset extraction.

## 2. Core Architecture

### 2.1 Singleton Surface
Morpho Blue uses a singleton contract for all markets, reducing gas and complexity.
- • **MarketParams**: `loanToken`, `collateralToken`, `oracle`, `irm`, `lltv`.
- • **Market ID**: `keccak256(abi.encode(marketParams))`.

### 2.2 Core Functions
- • `supply(marketParams, assets, shares, onBehalf, data)`
- • `borrow(marketParams, assets, shares, onBehalf, receiver)`
- • `withdraw(marketParams, assets, shares, onBehalf, receiver)`
- • `repay(marketParams, assets, shares, onBehalf, data)`
- • `flashLoan(token, assets, data)`

## 📘 Real Contract ABIs & Interfaces

### IMorpho.sol
```solidity
struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

function supply(
    MarketParams memory marketParams,
    uint256 assets,
    uint256 shares,
    address onBehalf,
    bytes memory data
) external returns (uint256 assetsSupplied, uint256 sharesSupplied);

function borrow(
    MarketParams memory marketParams,
    uint256 assets,
    uint256 shares,
    address onBehalf,
    address receiver
) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);
```

## 🎯 Morpho Patterns to Copy

- • **No aTokens**: Morpho tracks balances internally via shares, avoiding the gas cost of minting/burning rebasing tokens.
- • **Callbacks**: `onMorphoSupply`, `onMorphoRepay`, `onMorphoFlashLoan` allow for atomic, multi-step operations.
- • **EIP-712**: `setAuthorizationWithSig` for gasless position management.

## 🔑 Critical Rules for Developers

- 1. **Zero Fee Flash Loans** — Use Morpho as the primary flash loan source for any supported token balance.
- 2. **Accrue Interest** — Always check if `accrueInterest` is needed before reading market state for high-precision math.
- 3. **Market ID Stability** — Never hardcode Market IDs; always derive from `MarketParams`.
- 4. **LLTV Enforcement** — Scout must verify the enabled `lltv` before proposing a borrow path.
