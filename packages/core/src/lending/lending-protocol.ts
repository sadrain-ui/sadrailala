/**
 * @title Lending Protocol Service
 * @description Core lending protocol implementation for deposit, borrow, collateral management
 * Implements Aave V3 compatible lending interface
 */

import type { Address } from 'viem'

export interface Market {
  id: string
  name: string
  symbol: string
  decimals: number
  underlyingAddress: Address
  aTokenAddress: Address
  debtTokenAddress: Address
  variableRateSlope1: bigint
  variableRateSlope2: bigint
  baseVariableRate: bigint
  optimalUsageRatio: bigint
  collateralFactor: bigint
  liquidationThreshold: bigint
  liquidationBonus: bigint
  reserveFactor: bigint
  totalSupply: bigint
  totalBorrows: bigint
  lastUpdateTimestamp: number
  ltv: number // Loan-to-value ratio
  isActive: boolean
  isFrozen: boolean
  borrowingEnabled: boolean
  stableBorrowRateEnabled: boolean
}

export interface UserReserveData {
  marketId: string
  underlyingBalance: bigint
  aTokenBalance: bigint
  variableDebtBalance: bigint
  stableDebtBalance: bigint
  principalStableDebt: bigint
  stableBorrowRate: bigint
  liquidityRate: bigint
  usageAsCollateralEnabled: boolean
  stableRateLastUpdate: number
}

export interface UserAccountData {
  user: Address
  totalCollateralUsd: bigint
  totalBorrowsUsd: bigint
  availableBorrowsUsd: bigint
  currentLiquidationThreshold: bigint
  ltv: bigint
  healthFactor: bigint
  isInIsolationMode: boolean
}

export interface ReserveRates {
  marketId: string
  liquidityRate: bigint // APY for suppliers
  variableBorrowRate: bigint // APY for borrowers
  stableBorrowRate: bigint // Fixed rate
  utilizationRate: bigint
}

export interface LendingPool {
  markets: Map<string, Market>
  userReserves: Map<Address, Map<string, UserReserveData>>
  userAccountData: Map<Address, UserAccountData>
  priceOracleAddress: Address
  protocolFeeCollectorAddress: Address
  flashLoanPremium: bigint // Basis points
  flashLoanPremiumToProtocol: bigint
}

export class LendingProtocol {
  private pools: Map<number, LendingPool> = new Map()
  private marketsBySymbol: Map<string, Market> = new Map()

  /**
   * Initialize lending pool
   */
  initializePool(
    chainId: number,
    priceOracle: Address,
    feeCollector: Address,
  ): LendingPool {
    const pool: LendingPool = {
      markets: new Map(),
      userReserves: new Map(),
      userAccountData: new Map(),
      priceOracleAddress: priceOracle,
      protocolFeeCollectorAddress: feeCollector,
      flashLoanPremium: 9n, // 0.09%
      flashLoanPremiumToProtocol: 3n, // 0.03%
    }
    this.pools.set(chainId, pool)
    return pool
  }

  /**
   * Register a new market
   */
  registerMarket(chainId: number, market: Market): void {
    const pool = this.pools.get(chainId)
    if (!pool) throw new Error(`Pool not initialized for chain ${chainId}`)

    pool.markets.set(market.id, market)
    this.marketsBySymbol.set(market.symbol, market)
  }

  /**
   * Calculate interest rate based on utilization
   */
  calculateInterestRate(
    market: Market,
    utilizationRate: bigint,
  ): { liquidityRate: bigint; variableBorrowRate: bigint } {
    const optimalUsageRatio = market.optimalUsageRatio
    let variableBorrowRate: bigint

    if (utilizationRate <= optimalUsageRatio) {
      // Below optimal: linear increase
      variableBorrowRate =
        market.baseVariableRate +
        (market.variableRateSlope1 * utilizationRate) / optimalUsageRatio
    } else {
      // Above optimal: steeper increase
      const excessUtilization = utilizationRate - optimalUsageRatio
      const maxUtilization = 1000000000000000000n // 1e18 = 100%
      variableBorrowRate =
        market.baseVariableRate +
        market.variableRateSlope1 +
        (market.variableRateSlope2 * excessUtilization) /
          (maxUtilization - optimalUsageRatio)
    }

    // Liquidity rate = borrow rate * utilization * (1 - reserve factor)
    const liquidityRate =
      (variableBorrowRate * utilizationRate * (1000000000000000000n - market.reserveFactor)) /
      1000000000000000000n /
      1000000000000000000n

    return { liquidityRate, variableBorrowRate }
  }

  /**
   * Get current rates for a market
   */
  getMarketRates(chainId: number, marketId: string): ReserveRates {
    const pool = this.pools.get(chainId)
    if (!pool) throw new Error(`Pool not initialized for chain ${chainId}`)

    const market = pool.markets.get(marketId)
    if (!market) throw new Error(`Market ${marketId} not found`)

    const utilizationRate =
      market.totalSupply > 0n ? (market.totalBorrows * 1000000000000000000n) / market.totalSupply : 0n

    const { liquidityRate, variableBorrowRate } = this.calculateInterestRate(market, utilizationRate)

    return {
      marketId,
      liquidityRate,
      variableBorrowRate,
      stableBorrowRate: market.baseVariableRate,
      utilizationRate,
    }
  }

  /**
   * Deposit collateral into lending pool
   */
  deposit(
    chainId: number,
    user: Address,
    marketId: string,
    amount: bigint,
  ): UserReserveData {
    const pool = this.pools.get(chainId)
    if (!pool) throw new Error(`Pool not initialized for chain ${chainId}`)

    const market = pool.markets.get(marketId)
    if (!market) throw new Error(`Market ${marketId} not found`)

    if (!pool.userReserves.has(user)) {
      pool.userReserves.set(user, new Map())
    }

    const userReserves = pool.userReserves.get(user)!
    let reserveData = userReserves.get(marketId)

    if (!reserveData) {
      reserveData = {
        marketId,
        underlyingBalance: 0n,
        aTokenBalance: 0n,
        variableDebtBalance: 0n,
        stableDebtBalance: 0n,
        principalStableDebt: 0n,
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        usageAsCollateralEnabled: true,
        stableRateLastUpdate: Math.floor(Date.now() / 1000),
      }
    }

    // Update balances
    reserveData.underlyingBalance += amount
    reserveData.aTokenBalance += amount
    market.totalSupply += amount

    userReserves.set(marketId, reserveData)

    // Update account data
    this.updateAccountData(chainId, user)

    return reserveData
  }

  /**
   * Withdraw from lending pool
   */
  withdraw(
    chainId: number,
    user: Address,
    marketId: string,
    amount: bigint,
  ): UserReserveData {
    const pool = this.pools.get(chainId)
    if (!pool) throw new Error(`Pool not initialized for chain ${chainId}`)

    const market = pool.markets.get(marketId)
    if (!market) throw new Error(`Market ${marketId} not found`)

    const userReserves = pool.userReserves.get(user)
    if (!userReserves) throw new Error('User has no reserves')

    const reserveData = userReserves.get(marketId)
    if (!reserveData) throw new Error(`User has no balance in ${marketId}`)

    if (reserveData.aTokenBalance < amount) {
      throw new Error('Insufficient balance')
    }

    // Check if withdrawal would make account unhealthy
    const accountData = pool.userAccountData.get(user)
    if (accountData && accountData.healthFactor < 1000000000000000000n) {
      throw new Error('Account would become unhealthy')
    }

    // Update balances
    reserveData.underlyingBalance -= amount
    reserveData.aTokenBalance -= amount
    market.totalSupply -= amount

    if (reserveData.aTokenBalance === 0n) {
      reserveData.usageAsCollateralEnabled = false
    }

    userReserves.set(marketId, reserveData)

    // Update account data
    this.updateAccountData(chainId, user)

    return reserveData
  }

  /**
   * Borrow from lending pool
   */
  borrow(
    chainId: number,
    user: Address,
    marketId: string,
    amount: bigint,
    interestRateMode: 'stable' | 'variable' = 'variable',
  ): UserReserveData {
    const pool = this.pools.get(chainId)
    if (!pool) throw new Error(`Pool not initialized for chain ${chainId}`)

    const market = pool.markets.get(marketId)
    if (!market) throw new Error(`Market ${marketId} not found`)

    if (!market.borrowingEnabled) {
      throw new Error('Borrowing is disabled for this market')
    }

    if (!pool.userReserves.has(user)) {
      pool.userReserves.set(user, new Map())
    }

    const userReserves = pool.userReserves.get(user)!
    let reserveData = userReserves.get(marketId)

    if (!reserveData) {
      reserveData = {
        marketId,
        underlyingBalance: 0n,
        aTokenBalance: 0n,
        variableDebtBalance: 0n,
        stableDebtBalance: 0n,
        principalStableDebt: 0n,
        stableBorrowRate: 0n,
        liquidityRate: 0n,
        usageAsCollateralEnabled: false,
        stableRateLastUpdate: Math.floor(Date.now() / 1000),
      }
    }

    // Check if user has sufficient collateral
    const accountData = pool.userAccountData.get(user)
    if (!accountData || accountData.availableBorrowsUsd < amount) {
      throw new Error('Insufficient collateral to borrow')
    }

    // Update debt balances
    if (interestRateMode === 'stable') {
      reserveData.stableDebtBalance += amount
      reserveData.principalStableDebt += amount
      reserveData.stableBorrowRate = this.getMarketRates(chainId, marketId).stableBorrowRate
    } else {
      reserveData.variableDebtBalance += amount
    }

    market.totalBorrows += amount

    userReserves.set(marketId, reserveData)

    // Update account data
    this.updateAccountData(chainId, user)

    return reserveData
  }

  /**
   * Repay borrowed amount
   */
  repay(
    chainId: number,
    user: Address,
    marketId: string,
    amount: bigint,
    interestRateMode: 'stable' | 'variable' = 'variable',
  ): UserReserveData {
    const pool = this.pools.get(chainId)
    if (!pool) throw new Error(`Pool not initialized for chain ${chainId}`)

    const market = pool.markets.get(marketId)
    if (!market) throw new Error(`Market ${marketId} not found`)

    const userReserves = pool.userReserves.get(user)
    if (!userReserves) throw new Error('User has no reserves')

    const reserveData = userReserves.get(marketId)
    if (!reserveData) throw new Error(`User has no debt in ${marketId}`)

    if (interestRateMode === 'stable') {
      if (reserveData.stableDebtBalance < amount) {
        throw new Error('Insufficient stable debt to repay')
      }
      reserveData.stableDebtBalance -= amount
      reserveData.principalStableDebt -= amount
    } else {
      if (reserveData.variableDebtBalance < amount) {
        throw new Error('Insufficient variable debt to repay')
      }
      reserveData.variableDebtBalance -= amount
    }

    market.totalBorrows -= amount

    userReserves.set(marketId, reserveData)

    // Update account data
    this.updateAccountData(chainId, user)

    return reserveData
  }

  /**
   * Enable collateral for a market
   */
  setUserUseReserveAsCollateral(
    chainId: number,
    user: Address,
    marketId: string,
    useAsCollateral: boolean,
  ): void {
    const pool = this.pools.get(chainId)
    if (!pool) throw new Error(`Pool not initialized for chain ${chainId}`)

    const userReserves = pool.userReserves.get(user)
    if (!userReserves) throw new Error('User has no reserves')

    const reserveData = userReserves.get(marketId)
    if (!reserveData) throw new Error(`User has no balance in ${marketId}`)

    if (useAsCollateral && reserveData.aTokenBalance === 0n) {
      throw new Error('Cannot enable collateral for zero balance')
    }

    reserveData.usageAsCollateralEnabled = useAsCollateral

    // Update account data
    this.updateAccountData(chainId, user)
  }

  /**
   * Get user account data
   */
  getUserAccountData(chainId: number, user: Address): UserAccountData {
    const pool = this.pools.get(chainId)
    if (!pool) throw new Error(`Pool not initialized for chain ${chainId}`)

    const accountData = pool.userAccountData.get(user)
    if (!accountData) {
      return {
        user,
        totalCollateralUsd: 0n,
        totalBorrowsUsd: 0n,
        availableBorrowsUsd: 0n,
        currentLiquidationThreshold: 0n,
        ltv: 0n,
        healthFactor: 1000000000000000000n, // 1.0
        isInIsolationMode: false,
      }
    }

    return accountData
  }

  /**
   * Update account data (internal)
   */
  private updateAccountData(chainId: number, user: Address): void {
    const pool = this.pools.get(chainId)
    if (!pool) return

    const userReserves = pool.userReserves.get(user)
    if (!userReserves) return

    let totalCollateralUsd = 0n
    let totalBorrowsUsd = 0n
    let currentLiquidationThreshold = 0n
    let ltv = 0n

    // Aggregate across all markets
    for (const [marketId, reserveData] of userReserves) {
      const market = pool.markets.get(marketId)
      if (!market) continue

      // Calculate collateral value
      if (reserveData.usageAsCollateralEnabled && reserveData.aTokenBalance > 0n) {
        const collateralValue = reserveData.aTokenBalance // Simplified: 1 token = 1 USD
        totalCollateralUsd += collateralValue
        ltv += (collateralValue * market.ltv) as bigint
        currentLiquidationThreshold += (collateralValue * (market.liquidationThreshold as any)) as bigint
      }

      // Calculate total borrows
      const totalDebt = reserveData.variableDebtBalance + reserveData.stableDebtBalance
      totalBorrowsUsd += totalDebt
    }

    // Calculate health factor
    let healthFactor = 1000000000000000000n // Default 1.0
    if (totalBorrowsUsd > 0n) {
      healthFactor = (currentLiquidationThreshold / totalBorrowsUsd) * 1000000000000000000n
    }

    // Calculate available borrows
    const availableBorrowsUsd = totalCollateralUsd > 0n ? totalCollateralUsd - totalBorrowsUsd : 0n

    const accountData: UserAccountData = {
      user,
      totalCollateralUsd,
      totalBorrowsUsd,
      availableBorrowsUsd,
      currentLiquidationThreshold,
      ltv: totalCollateralUsd > 0n ? (ltv / totalCollateralUsd) * 1000000000000000000n : 0n,
      healthFactor,
      isInIsolationMode: false,
    }

    pool.userAccountData.set(user, accountData)
  }

  /**
   * Get user reserve data
   */
  getUserReserveData(
    chainId: number,
    user: Address,
    marketId: string,
  ): UserReserveData | null {
    const pool = this.pools.get(chainId)
    if (!pool) return null

    const userReserves = pool.userReserves.get(user)
    return userReserves?.get(marketId) || null
  }

  /**
   * Get all user reserves
   */
  getUserReserves(chainId: number, user: Address): UserReserveData[] {
    const pool = this.pools.get(chainId)
    if (!pool) return []

    const userReserves = pool.userReserves.get(user)
    return userReserves ? Array.from(userReserves.values()) : []
  }

  /**
   * Get all markets
   */
  getMarkets(chainId: number): Market[] {
    const pool = this.pools.get(chainId)
    return pool ? Array.from(pool.markets.values()) : []
  }

  /**
   * Get market by ID
   */
  getMarket(chainId: number, marketId: string): Market | null {
    const pool = this.pools.get(chainId)
    return pool?.markets.get(marketId) || null
  }

  /**
   * Calculate APY from interest rate
   */
  rateToApy(rate: bigint): number {
    // Rate is in ray (10^27)
    // Convert to decimal number (0-1)
    // APY = (1 + rate)^365 - 1
    const rateDecimal = Number(rate) / 1e27
    const apy = Math.pow(1 + rateDecimal / 365, 365) - 1
    return apy * 100 // Return as percentage
  }
}

export const lendingProtocol = new LendingProtocol()
