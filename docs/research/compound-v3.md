# Compound v3 Logic-Map — Legion Engine Integration

Target Repository: `https://github.com/compound-finance/comet` Focus: Monolithic Money Markets, Base-Asset Borrowing, COMP Reward Accrual, Bulker Batching.

## 1. Role in Legion Engine

- • **Primary Sentinel**: Scout (telemetry) + Closer (payload prep).
- • **Function**: High-efficiency lending against a single base asset (e.g., USDC, WETH).
- • **Legion Use-Case**: Scout monitors collateral ratios and utilization rates; Closer builds `supply` and `withdraw` payloads for sovereign asset control.

## 2. Core Architecture

### 2.1 Monolithic Comet
Each market is a separate `Comet` proxy. Unlike v2, there is no global comptroller for market logic.
- • **Base Asset**: Every Comet instance has one borrowable asset.
- • **Collateral Assets**: Multiple tokens can be supplied as collateral but cannot be borrowed.

### 2.2 Core Functions
- • `supply(asset, amount)`: Supply base or collateral.
- • `withdraw(asset, amount)`: Withdraw base or collateral.
- • `transferAsset(dst, asset, amount)`: Transfer within the protocol.
- • `allow(manager, isAllowed)`: Set operators.

## 📘 Real Contract ABIs & Interfaces

### CometMainInterface.sol
```solidity
function supply(address asset, uint amount) external;
function supplyTo(address dst, address asset, uint amount) external;
function withdraw(address asset, uint amount) external;
function withdrawTo(address to, address asset, uint amount) external;

function borrowBalanceOf(address account) public view returns (uint256);
function isBorrowCollateralized(address account) public view returns (bool);
```

## 🎯 Compound v3 Patterns to Copy

- • **Bulker Batching**: Use the `Bulker` contract to combine `supply`, `borrow`, and `transfer` into a single transaction, reducing gas and atomicity risk.
- • **Tracking Index**: COMP rewards are tracked via a global index and accrued per-user upon interaction.
- • **Reserved Values**: Compound uses immutable variables for many parameters, requiring new implementation deployments for updates.

## 🔑 Critical Rules for Developers

- 1. **Proxy Only** — ALWAYS interact with the Proxy address, never the implementation.
- 2. **Base vs Collateral** — Base asset logic (interest bearing) differs from Collateral logic (no interest). Scout must distinguish these in telemetry.
- 3. **Reward Accrual** — Rewards are not automatically sent. Closer must include a `claim` call to `CometRewards` to extract COMP.
- 4. **Health Factor** — Use `isBorrowCollateralized` for a binary check, but calculate custom Liquidation Margin for proactive extraction.
