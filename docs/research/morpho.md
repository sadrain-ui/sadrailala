# Morpho Blue Logic-Map — Legion Engine Integration

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
