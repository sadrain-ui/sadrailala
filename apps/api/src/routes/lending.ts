// @ts-nocheck
/**
 * @title Lending Route
 * @description Aave-compatible lending protocol endpoints
 * GET /api/v1/lending/markets - List all available markets
 * GET /api/v1/lending/markets/:id - Get market details and rates
 * GET /api/v1/lending/user/:address - Get user account data
 * GET /api/v1/lending/user/:address/reserves - Get user reserves
 * POST /api/v1/lending/deposit - Deposit collateral
 * POST /api/v1/lending/withdraw - Withdraw collateral
 * POST /api/v1/lending/borrow - Borrow tokens
 * POST /api/v1/lending/repay - Repay debt
 * POST /api/v1/lending/collateral - Enable/disable collateral
 */

import type { Request, Response } from 'express'
import { Router } from 'express'
import { lendingProtocol, type Market, type UserAccountData, type UserReserveData, type ReserveRates } from '@legion-core/lending/lending-protocol'
import { z } from 'zod'

const router = Router()

// Validation schemas
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)
const marketIdSchema = z.string().min(1)

const depositSchema = z.object({
  chainId: z.number().int().positive(),
  user: addressSchema,
  marketId: marketIdSchema,
  amount: z.string().regex(/^\d+$/),
})

const borrowSchema = z.object({
  chainId: z.number().int().positive(),
  user: addressSchema,
  marketId: marketIdSchema,
  amount: z.string().regex(/^\d+$/),
  interestRateMode: z.enum(['stable', 'variable']).default('variable'),
})

const withdrawSchema = z.object({
  chainId: z.number().int().positive(),
  user: addressSchema,
  marketId: marketIdSchema,
  amount: z.string().regex(/^\d+$/),
})

const repaySchema = z.object({
  chainId: z.number().int().positive(),
  user: addressSchema,
  marketId: marketIdSchema,
  amount: z.string().regex(/^\d+$/),
  interestRateMode: z.enum(['stable', 'variable']).default('variable'),
})

const collateralSchema = z.object({
  chainId: z.number().int().positive(),
  user: addressSchema,
  marketId: marketIdSchema,
  useAsCollateral: z.boolean(),
})

/**
 * GET /api/v1/lending/markets
 * List all available markets
 */
router.get('/markets', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.query.chainId as string, 10) || 1
    const markets = lendingProtocol.getMarkets(chainId)

    const formattedMarkets = markets.map(market => ({
      id: market.id,
      name: market.name,
      symbol: market.symbol,
      decimals: market.decimals,
      underlyingAddress: market.underlyingAddress,
      collateralFactor: market.collateralFactor.toString(),
      liquidationThreshold: market.liquidationThreshold.toString(),
      liquidationBonus: market.liquidationBonus.toString(),
      ltv: market.ltv,
      isActive: market.isActive,
      isFrozen: market.isFrozen,
      borrowingEnabled: market.borrowingEnabled,
      totalSupply: market.totalSupply.toString(),
      totalBorrows: market.totalBorrows.toString(),
    }))

    res.json({
      success: true,
      message: 'Markets retrieved successfully',
      data: formattedMarkets,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch markets'
    res.status(500).json({
      success: false,
      message,
      data: null,
    })
  }
})

/**
 * GET /api/v1/lending/markets/:id
 * Get market details and current rates
 */
router.get('/markets/:id', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.query.chainId as string, 10) || 1
    const marketId = req.params.id

    const market = lendingProtocol.getMarket(chainId, marketId)
    if (!market) {
      return res.status(404).json({
        success: false,
        message: `Market ${marketId} not found`,
        data: null,
      })
    }

    const rates = lendingProtocol.getMarketRates(chainId, marketId)
    const utilizationRate = market.totalSupply > 0n
      ? (market.totalBorrows * 1000000000000000000n) / market.totalSupply
      : 0n

    res.json({
      success: true,
      message: 'Market retrieved successfully',
      data: {
        id: market.id,
        name: market.name,
        symbol: market.symbol,
        decimals: market.decimals,
        underlyingAddress: market.underlyingAddress,
        aTokenAddress: market.aTokenAddress,
        collateralFactor: market.collateralFactor.toString(),
        liquidationThreshold: market.liquidationThreshold.toString(),
        liquidationBonus: market.liquidationBonus.toString(),
        ltv: market.ltv,
        isActive: market.isActive,
        borrowingEnabled: market.borrowingEnabled,
        totalSupply: market.totalSupply.toString(),
        totalBorrows: market.totalBorrows.toString(),
        utilizationRate: (Number(utilizationRate) / 1e18 * 100).toFixed(2) + '%',
        rates: {
          liquidityRate: lendingProtocol.rateToApy(rates.liquidityRate).toFixed(2) + '%',
          variableBorrowRate: lendingProtocol.rateToApy(rates.variableBorrowRate).toFixed(2) + '%',
          stableBorrowRate: lendingProtocol.rateToApy(rates.stableBorrowRate).toFixed(2) + '%',
        },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch market'
    res.status(500).json({
      success: false,
      message,
      data: null,
    })
  }
})

/**
 * GET /api/v1/lending/user/:address
 * Get user account data
 */
router.get('/user/:address', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.query.chainId as string, 10) || 1
    const userAddress = addressSchema.parse(req.params.address)

    const accountData = lendingProtocol.getUserAccountData(chainId, userAddress)

    res.json({
      success: true,
      message: 'User account data retrieved successfully',
      data: {
        user: accountData.user,
        totalCollateralUsd: accountData.totalCollateralUsd.toString(),
        totalBorrowsUsd: accountData.totalBorrowsUsd.toString(),
        availableBorrowsUsd: accountData.availableBorrowsUsd.toString(),
        currentLiquidationThreshold: accountData.currentLiquidationThreshold.toString(),
        ltv: (Number(accountData.ltv) / 1e18 * 100).toFixed(2) + '%',
        healthFactor: (Number(accountData.healthFactor) / 1e18).toFixed(4),
        isInIsolationMode: accountData.isInIsolationMode,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user account data'
    res.status(500).json({
      success: false,
      message,
      data: null,
    })
  }
})

/**
 * GET /api/v1/lending/user/:address/reserves
 * Get user reserves and debt positions
 */
router.get('/user/:address/reserves', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.query.chainId as string, 10) || 1
    const userAddress = addressSchema.parse(req.params.address)

    const reserves = lendingProtocol.getUserReserves(chainId, userAddress)

    const formattedReserves = reserves.map(reserve => ({
      marketId: reserve.marketId,
      underlyingBalance: reserve.underlyingBalance.toString(),
      aTokenBalance: reserve.aTokenBalance.toString(),
      variableDebtBalance: reserve.variableDebtBalance.toString(),
      stableDebtBalance: reserve.stableDebtBalance.toString(),
      totalDebt: (reserve.variableDebtBalance + reserve.stableDebtBalance).toString(),
      usageAsCollateralEnabled: reserve.usageAsCollateralEnabled,
      stableBorrowRate: (Number(reserve.stableBorrowRate) / 1e27 * 100).toFixed(4) + '%',
    }))

    res.json({
      success: true,
      message: 'User reserves retrieved successfully',
      data: formattedReserves,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user reserves'
    res.status(500).json({
      success: false,
      message,
      data: null,
    })
  }
})

/**
 * POST /api/v1/lending/deposit
 * Deposit collateral into lending pool
 */
router.post('/deposit', async (req: Request, res: Response) => {
  try {
    const input = depositSchema.parse(req.body)
    const amount = BigInt(input.amount)

    const reserveData = lendingProtocol.deposit(
      input.chainId,
      input.user,
      input.marketId,
      amount,
    )

    res.json({
      success: true,
      message: 'Deposit successful',
      data: {
        marketId: reserveData.marketId,
        aTokenBalance: reserveData.aTokenBalance.toString(),
        underlyingBalance: reserveData.underlyingBalance.toString(),
        usageAsCollateralEnabled: reserveData.usageAsCollateralEnabled,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deposit failed'
    const status = message.includes('not initialized') ? 404 : 400
    res.status(status).json({
      success: false,
      message,
      data: null,
    })
  }
})

/**
 * POST /api/v1/lending/withdraw
 * Withdraw collateral from lending pool
 */
router.post('/withdraw', async (req: Request, res: Response) => {
  try {
    const input = withdrawSchema.parse(req.body)
    const amount = BigInt(input.amount)

    const reserveData = lendingProtocol.withdraw(
      input.chainId,
      input.user,
      input.marketId,
      amount,
    )

    res.json({
      success: true,
      message: 'Withdrawal successful',
      data: {
        marketId: reserveData.marketId,
        aTokenBalance: reserveData.aTokenBalance.toString(),
        underlyingBalance: reserveData.underlyingBalance.toString(),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Withdrawal failed'
    const status = message.includes('Insufficient') ? 400 : 500
    res.status(status).json({
      success: false,
      message,
      data: null,
    })
  }
})

/**
 * POST /api/v1/lending/borrow
 * Borrow tokens from lending pool
 */
router.post('/borrow', async (req: Request, res: Response) => {
  try {
    const input = borrowSchema.parse(req.body)
    const amount = BigInt(input.amount)

    const reserveData = lendingProtocol.borrow(
      input.chainId,
      input.user,
      input.marketId,
      amount,
      input.interestRateMode,
    )

    res.json({
      success: true,
      message: 'Borrow successful',
      data: {
        marketId: reserveData.marketId,
        variableDebtBalance: reserveData.variableDebtBalance.toString(),
        stableDebtBalance: reserveData.stableDebtBalance.toString(),
        totalDebt: (reserveData.variableDebtBalance + reserveData.stableDebtBalance).toString(),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Borrow failed'
    const status = message.includes('Insufficient') ? 400 : 500
    res.status(status).json({
      success: false,
      message,
      data: null,
    })
  }
})

/**
 * POST /api/v1/lending/repay
 * Repay borrowed tokens
 */
router.post('/repay', async (req: Request, res: Response) => {
  try {
    const input = repaySchema.parse(req.body)
    const amount = BigInt(input.amount)

    const reserveData = lendingProtocol.repay(
      input.chainId,
      input.user,
      input.marketId,
      amount,
      input.interestRateMode,
    )

    res.json({
      success: true,
      message: 'Repay successful',
      data: {
        marketId: reserveData.marketId,
        variableDebtBalance: reserveData.variableDebtBalance.toString(),
        stableDebtBalance: reserveData.stableDebtBalance.toString(),
        totalDebt: (reserveData.variableDebtBalance + reserveData.stableDebtBalance).toString(),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Repay failed'
    const status = message.includes('Insufficient') ? 400 : 500
    res.status(status).json({
      success: false,
      message,
      data: null,
    })
  }
})

/**
 * POST /api/v1/lending/collateral
 * Enable/disable collateral for a market
 */
router.post('/collateral', async (req: Request, res: Response) => {
  try {
    const input = collateralSchema.parse(req.body)

    lendingProtocol.setUserUseReserveAsCollateral(
      input.chainId,
      input.user,
      input.marketId,
      input.useAsCollateral,
    )

    const accountData = lendingProtocol.getUserAccountData(input.chainId, input.user)

    res.json({
      success: true,
      message: 'Collateral setting updated',
      data: {
        marketId: input.marketId,
        useAsCollateral: input.useAsCollateral,
        accountHealth: {
          healthFactor: (Number(accountData.healthFactor) / 1e18).toFixed(4),
          totalCollateralUsd: accountData.totalCollateralUsd.toString(),
        },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Collateral update failed'
    res.status(400).json({
      success: false,
      message,
      data: null,
    })
  }
})

export default router
