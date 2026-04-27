# 46: Morpho Blue Extraction Skill

## STRICT_RULES

1. **Market ID Derivation** — NEVER hardcode Market IDs. Always derive them on-chain or via the `IdToMarketParams` mapping to prevent cross-market collisions.
2. **Accrue Interest First** — ALWAYS call `accrueInterest` before performing math on `totalSupplyAssets` or `totalBorrowAssets`. Static calls return stale data if not accrued in the same block.
3. **Approval Target** — The approval target for Morpho Blue is the singleton `Morpho` contract address.
4. **Flash Loan Efficiency** — Morpho Blue flash loans are 0% fee. Priority should be given to Morpho for any supported asset extraction.
5. **Callback Security** — When using `onMorphoSupply` or `onMorphoFlashLoan` callbacks, always verify `msg.sender == MORPHO_ADDRESS` to prevent unauthorized balance manipulation.

## MENTAL_MODEL

- • **Singleton Architecture** — All lending markets exist within a single `Morpho.sol` contract, enabling atomic multi-market operations with low gas.
- • **Isolated Risk** — Each market is an independent vault pairing one loan asset with one collateral asset. No cross-market contagion.
- • **Direct Balance (No aTokens)** — Unlike Aave/Compound, Morpho does not use intermediary rebasing tokens. Balances are tracked via shares internally.
- • **Oracle-Agnostic** — Markets can use any oracle (Chainlink, Redstone, etc.). The LLTV (Loan-to-Value) is hardcoded at market creation.
- • **Yield Mechanism** — Interest accrues to the `Market` state and is distributed proportionally to `supplyShares`.

## REAL_API

### Mainnet Singleton: `0xBBBBBbbBBb9cCEdAB5396F003BBbbb9cCeDAb539`

```typescript
const MORPHO_ABI = parseAbi([
  'function supply(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data) external returns (uint256 assetsSupplied, uint256 sharesSupplied)',
  'function borrow(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed)',
  'function withdraw(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) external returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)',
  'function repay(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data) external returns (uint256 assetsRepaid, uint256 sharesRepaid)',
  'function flashLoan(address token, uint256 assets, bytes calldata data) external',
  'function market(Id id) external view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(Id id, address user) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)'
])

// Market ID Creation
const marketId = keccak256(encodeAbiParameters(
  parseAbiParameters('address, address, address, address, uint256'),
  [loanToken, collateralToken, oracle, irm, lltv]
))
```

## LEGION USE CASES

- • **Atomic Leverage** — Use `onMorphoSupply` callback to flash-borrow loan assets, swap for collateral, and supply in a single transaction.
- • **Yield Vacuum** — Scout scans for markets where `totalBorrowAssets / totalSupplyAssets` is high, signaling high interest rates for idle capital.
- • **Stealth Debt Extraction** — Dispatcher routes borrow transactions through private lanes (MEV-Share) to prevent liquidation bots from front-running collateral ratio changes.
- • **Zero-Cost Flash Arb** — Leverage singleton liquidity for multi-dex arbitrage without paying flash loan premiums.
