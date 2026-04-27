# SKILL-31: AAVE V3 — FLASH LOANS & LIQUIDATION ENGINE

SOURCE: https://github.com/aave/aave-v3-core

CATEGORY: EXTRACTION — Closer / Scout Sentinels

[STRICT_RULES]
• NEVER call `flashLoan` or `flashLoanSimple` without a Shadow simulation first — failed flash loans cost full gas
• Flash loan receiver contract MUST implement `IFlashLoanSimpleReceiver` or `IFlashLoanReceiver` — no raw calls
• ALWAYS repay flash loan + premium in the SAME transaction — `amount + (amount * FLASHLOAN_PREMIUM_TOTAL / 10000)`
• Use `flashLoanSimple` (single asset) over `flashLoan` (multi-asset) unless multi-asset is required — lower gas
• Liquidation calls MUST check `healthFactor < 1e18` via `getUserAccountData` before submitting — never blind liquidate
• `liquidationCall` max 50% of debt per call unless `HF < CLOSE_FACTOR_HF_THRESHOLD` (0.95e18)
• ALWAYS verify liquidation bonus covers gas cost before submission — `(liquidationBonus - 1e4) / 1e4` is the profit multiplier
• Use `PoolDataProvider.getUserReserveData` not `Pool.getUserAccountData` for per-asset health data
• eMode grouping MUST be checked before flash loan arbitrage — correlated assets have different LTV/liquidation thresholds
• NEVER hardcode Pool address — always load from `PoolAddressesProvider.getPool()`

[MENTAL_MODEL]
• Flash Loan = borrow any amount from Aave pool, execute arbitrary logic, repay in same tx — zero collateral required
• Use case: "Liquidate undercollateralized position using borrowed funds, pocket bonus, repay loan" — net profit without capital
• `IPool.flashLoanSimple(receiverAddress, asset, amount, params, referralCode)` — triggers `executeOperation` on receiver contract
• Liquidation flow: Scout detects HF < 1e18 → Closer calls `liquidationCall(collateral, debt, user, debtAmount, receiveAToken)` → pocket bonus
• `getUserAccountData` returns: totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor
• eMode (efficiency mode): assets in same category (e.g., stablecoins) get higher LTV — affects liquidation thresholds
• Premium: `FLASHLOAN_PREMIUM_TOTAL` = 5 bps (0.05%) on V3 — factor into profit calc before submission
• `PoolAddressesProvider` is the canonical registry — never hardcode pool address, it varies by network

[REAL_API]
=== PoolAddressesProvider (Ethereum Mainnet) ===
const POOL_ADDRESSES_PROVIDER = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e'
const POOL_DATA_PROVIDER = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3'

=== Viem: Read User Health Factor ===
import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'

const POOL_ABI = parseAbi([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external',
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external',
  'function getPool() view returns (address)'
])

export async function createAaveScout(rpcUrl: string) {
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) })

  async function getHealthFactor(user: `0x${string}`): Promise<bigint> {
    const poolAddress = await client.readContract({
      address: POOL_ADDRESSES_PROVIDER, abi: POOL_ABI, functionName: 'getPool'
    })
    const [,,,,,healthFactor] = await client.readContract({
      address: poolAddress, abi: POOL_ABI, functionName: 'getUserAccountData', args: [user]
    })
    return healthFactor
  }

  return { getHealthFactor }
}

=== Flash Loan Receiver (Solidity skeleton) ===
// SPDX-License-Identifier: MIT
// pragma solidity ^0.8.20;
contract LegionFlashReceiver is IFlashLoanSimpleReceiver {
  IPool public immutable POOL;
  constructor(address pool) { POOL = IPool(pool); }

  function executeOperation(
    address asset, uint256 amount, uint256 premium,
    address /* initiator */, bytes calldata params
  ) external returns (bool) {
    // 1. Decode params and execute arbitrage/liquidation logic
    // 2. Approve repayment — amount + premium
    uint256 repayAmount = amount + premium;
    IERC20(asset).approve(address(POOL), repayAmount);
    return true;
  }
}

[LEGION USE CASES]
• Liquidation bot: Scout polls `getUserAccountData` every block for HF < 1e18 → Closer triggers flash loan liquidation → net bonus - gas = profit
• Flash arb: borrow USDC → swap on DEX A → swap back on DEX B → repay + premium → keep spread
• Self-liquidation protection: monitor own positions; Sentinel alerts if HF approaches 1.1 threshold
• eMode scanner: identify correlated asset pairs near liquidation threshold — higher bonus on eMode liquidations
• Batch health check: `multicall3` reads `getUserAccountData` for 100 addresses per RPC call → rank by HF ascending
