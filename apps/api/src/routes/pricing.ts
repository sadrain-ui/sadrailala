/**
 * Public Pricing API — exposes cached price oracle data to frontend
 * Used by Uniswap/PancakeSwap clones and dashboard price tickers
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getOracleRatesUsd } from '@legion/core'
import { sendFailure, sendSuccess } from '../lib/api-response.js'

export async function registerPricingRoute(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/price
   * Returns current prices for major cryptocurrencies
   * Format: { ETH: 2500, BTC: 45000, SOL: 150, ... }
   */
  app.get('/api/v1/price', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rates = await getOracleRatesUsd()
      const prices = {
        ETH: rates.eth || 0,
        BTC: rates.btc || 0,
        SOL: rates.sol || 0,
        TRX: rates.trx || 0,
        TON: rates.ton || 0,
        BNBUSD: rates.eth ? rates.eth * 0.97 : 0, // Approximate BNB based on ETH
        BUSD: 1, // Stablecoin
        USDC: 1, // Stablecoin
        USDT: 1, // Stablecoin
      }
      return sendSuccess(reply, 200, 'Current prices', prices)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[PRICING_ROUTE] Error fetching prices:', msg)
      return sendFailure(reply, 500, `Failed to fetch prices: ${msg}`, {
        code: 'PriceFetchError',
      })
    }
  })

  /**
   * GET /api/v1/price/:symbol
   * Returns price for a specific token symbol (ETH, BTC, SOL, etc.)
   */
  app.get('/api/v1/price/:symbol', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const symbol = (request.params as any).symbol?.toUpperCase()
      if (!symbol) {
        return sendFailure(reply, 400, 'Symbol parameter required', { code: 'MissingSymbol' })
      }

      const rates = await getOracleRatesUsd()
      const symbolKey = symbol.toLowerCase() as 'eth' | 'btc' | 'sol' | 'trx' | 'ton'

      if (!(symbolKey in rates)) {
        return sendFailure(reply, 404, `Symbol ${symbol} not found in price oracle`, {
          code: 'SymbolNotFound',
        })
      }

      return sendSuccess(reply, 200, `Price for ${symbol}`, {
        symbol,
        price: rates[symbolKey] || 0,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return sendFailure(reply, 500, `Failed to fetch price: ${msg}`, {
        code: 'PriceFetchError',
      })
    }
  })
}
