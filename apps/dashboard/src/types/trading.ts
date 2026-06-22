export interface TradingPair {
  symbol: string
  name: string
  baseAsset: string
  quoteAsset: string
  lastPrice: number
  change24h: number
  volume24h: number
  high24h: number
  low24h: number
}

export interface OrderBook {
  bids: Array<[price: number, quantity: number]>
  asks: Array<[price: number, quantity: number]>
}

export interface TradeOrder {
  id: string
  symbol: string
  type: 'BUY' | 'SELL'
  price: number
  quantity: number
  filledQuantity: number
  status: 'PENDING' | 'PARTIAL_FILLED' | 'FILLED' | 'CANCELLED'
  createdAt: Date
  updatedAt: Date
  totalValue: number
  fee: number
}

export interface Balance {
  asset: string
  free: number
  locked: number
  total: number
}

export interface Portfolio {
  totalValue: number
  totalValueUSD: number
  btcValue: number
  balances: Balance[]
  lastUpdated: Date
}

export interface Deposit {
  id: string
  asset: string
  amount: number
  address: string
  txHash: string
  confirmations: number
  requiredConfirmations: number
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
  createdAt: Date
  updatedAt: Date
}

export interface Withdrawal {
  id: string
  asset: string
  amount: number
  address: string
  fee: number
  txHash: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  createdAt: Date
  updatedAt: Date
}

export interface PriceChart {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SpotTradeInput {
  symbol: string
  side: 'BUY' | 'SELL'
  orderType: 'LIMIT' | 'MARKET'
  quantity: number
  price?: number
}
