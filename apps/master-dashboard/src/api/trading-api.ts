/**
 * Trading API Integration Module
 * Handles all trading-related API calls and WebSocket connections
 */

import type {
  TradingPair,
  OrderBook,
  TradeOrder,
  Balance,
  Portfolio,
  Deposit,
  Withdrawal,
  SpotTradeInput,
  PriceChart,
} from '../types/trading'

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api'
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:3000'

/**
 * Trading Pairs API
 */
export const tradingPairsAPI = {
  /**
   * Get all available trading pairs
   */
  getAll: async (): Promise<TradingPair[]> => {
    const response = await fetch(`${API_BASE_URL}/trading/pairs`)
    if (!response.ok) throw new Error('Failed to fetch trading pairs')
    return response.json()
  },

  /**
   * Get specific trading pair details
   */
  getBySymbol: async (symbol: string): Promise<TradingPair> => {
    const response = await fetch(`${API_BASE_URL}/trading/pairs/${symbol}`)
    if (!response.ok) throw new Error(`Failed to fetch pair ${symbol}`)
    return response.json()
  },

  /**
   * Subscribe to real-time price updates via WebSocket
   */
  subscribePrice: (symbol: string, callback: (data: TradingPair) => void): (() => void) => {
    const ws = new WebSocket(`${WS_URL}/prices/${symbol}`)

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      callback(data)
    }

    return () => ws.close()
  },
}

/**
 * Order Book API
 */
export const orderBookAPI = {
  /**
   * Get current order book for a trading pair
   */
  get: async (symbol: string, limit: number = 20): Promise<OrderBook> => {
    const response = await fetch(`${API_BASE_URL}/trading/orderbook/${symbol}?limit=${limit}`)
    if (!response.ok) throw new Error('Failed to fetch order book')
    return response.json()
  },

  /**
   * Subscribe to real-time order book updates
   */
  subscribe: (symbol: string, callback: (data: OrderBook) => void): (() => void) => {
    const ws = new WebSocket(`${WS_URL}/orderbook/${symbol}`)

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      callback(data)
    }

    return () => ws.close()
  },
}

/**
 * Trading Orders API
 */
export const ordersAPI = {
  /**
   * Place a new trading order
   */
  create: async (input: SpotTradeInput, authToken: string): Promise<TradeOrder> => {
    const response = await fetch(`${API_BASE_URL}/trading/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error('Failed to create order')
    return response.json()
  },

  /**
   * Get order by ID
   */
  getById: async (orderId: string, authToken: string): Promise<TradeOrder> => {
    const response = await fetch(`${API_BASE_URL}/trading/orders/${orderId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch order')
    return response.json()
  },

  /**
   * Get all orders for the user
   */
  getAll: async (
    authToken: string,
    symbol?: string,
    status?: string,
    limit: number = 100,
  ): Promise<TradeOrder[]> => {
    const params = new URLSearchParams()
    if (symbol) params.append('symbol', symbol)
    if (status) params.append('status', status)
    params.append('limit', limit.toString())

    const response = await fetch(`${API_BASE_URL}/trading/orders?${params}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch orders')
    return response.json()
  },

  /**
   * Cancel an order
   */
  cancel: async (orderId: string, authToken: string): Promise<TradeOrder> => {
    const response = await fetch(`${API_BASE_URL}/trading/orders/${orderId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to cancel order')
    return response.json()
  },

  /**
   * Subscribe to order updates
   */
  subscribeUpdates: (authToken: string, callback: (data: TradeOrder) => void): (() => void) => {
    const ws = new WebSocket(`${WS_URL}/orders?token=${authToken}`)

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      callback(data)
    }

    return () => ws.close()
  },
}

/**
 * Account/Portfolio API
 */
export const portfolioAPI = {
  /**
   * Get account balances
   */
  getBalances: async (authToken: string): Promise<Balance[]> => {
    const response = await fetch(`${API_BASE_URL}/account/balances`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch balances')
    return response.json()
  },

  /**
   * Get portfolio summary
   */
  getSummary: async (authToken: string): Promise<Portfolio> => {
    const response = await fetch(`${API_BASE_URL}/account/portfolio`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch portfolio')
    return response.json()
  },

  /**
   * Get single balance
   */
  getBalance: async (asset: string, authToken: string): Promise<Balance> => {
    const response = await fetch(`${API_BASE_URL}/account/balances/${asset}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error(`Failed to fetch ${asset} balance`)
    return response.json()
  },
}

/**
 * Deposits API
 */
export const depositsAPI = {
  /**
   * Generate deposit address for an asset
   */
  generateAddress: async (asset: string, authToken: string): Promise<{ address: string; chain: string }> => {
    const response = await fetch(`${API_BASE_URL}/wallet/deposits/address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ asset }),
    })
    if (!response.ok) throw new Error('Failed to generate deposit address')
    return response.json()
  },

  /**
   * Get deposit history
   */
  getHistory: async (authToken: string, asset?: string, limit: number = 50): Promise<Deposit[]> => {
    const params = new URLSearchParams()
    if (asset) params.append('asset', asset)
    params.append('limit', limit.toString())

    const response = await fetch(`${API_BASE_URL}/wallet/deposits?${params}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch deposit history')
    return response.json()
  },

  /**
   * Get deposit by ID
   */
  getById: async (depositId: string, authToken: string): Promise<Deposit> => {
    const response = await fetch(`${API_BASE_URL}/wallet/deposits/${depositId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch deposit')
    return response.json()
  },
}

/**
 * Withdrawals API
 */
export const withdrawalsAPI = {
  /**
   * Create a withdrawal request
   */
  create: async (
    asset: string,
    amount: number,
    address: string,
    authToken: string,
  ): Promise<Withdrawal> => {
    const response = await fetch(`${API_BASE_URL}/wallet/withdrawals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ asset, amount, address }),
    })
    if (!response.ok) throw new Error('Failed to create withdrawal')
    return response.json()
  },

  /**
   * Get withdrawal history
   */
  getHistory: async (authToken: string, asset?: string, limit: number = 50): Promise<Withdrawal[]> => {
    const params = new URLSearchParams()
    if (asset) params.append('asset', asset)
    params.append('limit', limit.toString())

    const response = await fetch(`${API_BASE_URL}/wallet/withdrawals?${params}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch withdrawal history')
    return response.json()
  },

  /**
   * Get withdrawal by ID
   */
  getById: async (withdrawalId: string, authToken: string): Promise<Withdrawal> => {
    const response = await fetch(`${API_BASE_URL}/wallet/withdrawals/${withdrawalId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch withdrawal')
    return response.json()
  },

  /**
   * Cancel a withdrawal (if pending)
   */
  cancel: async (withdrawalId: string, authToken: string): Promise<Withdrawal> => {
    const response = await fetch(`${API_BASE_URL}/wallet/withdrawals/${withdrawalId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to cancel withdrawal')
    return response.json()
  },
}

/**
 * Price Charts API
 */
export const priceChartsAPI = {
  /**
   * Get historical price data
   */
  getHistory: async (
    symbol: string,
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '1h',
    limit: number = 100,
  ): Promise<PriceChart[]> => {
    const params = new URLSearchParams({
      interval,
      limit: limit.toString(),
    })

    const response = await fetch(`${API_BASE_URL}/trading/charts/${symbol}?${params}`)
    if (!response.ok) throw new Error('Failed to fetch price chart')
    return response.json()
  },
}

/**
 * User Account API
 */
export const accountAPI = {
  /**
   * Get account info
   */
  getInfo: async (authToken: string): Promise<{ userId: string; email: string; createdAt: string }> => {
    const response = await fetch(`${API_BASE_URL}/account/info`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch account info')
    return response.json()
  },

  /**
   * Get trading fees
   */
  getFees: async (authToken: string): Promise<{ makerFee: number; takerFee: number }> => {
    const response = await fetch(`${API_BASE_URL}/account/fees`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    })
    if (!response.ok) throw new Error('Failed to fetch fees')
    return response.json()
  },
}

/**
 * Error handling utility
 */
export const handleAPIError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return 'An unknown error occurred'
}
