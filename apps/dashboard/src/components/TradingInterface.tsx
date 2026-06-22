import { useState, useEffect } from 'react'
import type { TradingPair } from '../types/trading'
import { SpotTradingPanel } from './trading/SpotTradingPanel'
import { OrderBook } from './trading/OrderBook'
import { TradeHistory } from './trading/TradeHistory'
import { PriceChart } from './trading/PriceChart'
import '../styles/trading.css'

const TRADING_PAIRS: TradingPair[] = [
  {
    symbol: 'BTCUSDT',
    name: 'Bitcoin / USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    lastPrice: 65432.10,
    change24h: 2.45,
    volume24h: 28500000000,
    high24h: 66800,
    low24h: 63200,
  },
  {
    symbol: 'ETHUSDT',
    name: 'Ethereum / USDT',
    baseAsset: 'ETH',
    quoteAsset: 'USDT',
    lastPrice: 3245.50,
    change24h: 1.85,
    volume24h: 14200000000,
    high24h: 3350,
    low24h: 3100,
  },
  {
    symbol: 'BNBUSDT',
    name: 'Binance Coin / USDT',
    baseAsset: 'BNB',
    quoteAsset: 'USDT',
    lastPrice: 615.30,
    change24h: 0.95,
    volume24h: 2100000000,
    high24h: 632,
    low24h: 598,
  },
  {
    symbol: 'SOLUSDT',
    name: 'Solana / USDT',
    baseAsset: 'SOL',
    quoteAsset: 'USDT',
    lastPrice: 142.75,
    change24h: 3.20,
    volume24h: 1850000000,
    high24h: 148,
    low24h: 135,
  },
  {
    symbol: 'ADAUSDT',
    name: 'Cardano / USDT',
    baseAsset: 'ADA',
    quoteAsset: 'USDT',
    lastPrice: 0.9850,
    change24h: 1.12,
    volume24h: 780000000,
    high24h: 1.02,
    low24h: 0.96,
  },
]

interface TradingInterfaceProps {
  onClose?: () => void
}

export function TradingInterface({ onClose }: TradingInterfaceProps) {
  const [selectedPair, setSelectedPair] = useState<TradingPair>(TRADING_PAIRS[0])
  const [pairs, setPairs] = useState<TradingPair[]>(TRADING_PAIRS)
  const [searchQuery, setSearchQuery] = useState('')

  // Simulate price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setPairs((prev) =>
        prev.map((pair) => ({
          ...pair,
          lastPrice: pair.lastPrice * (0.999 + Math.random() * 0.002),
          change24h: pair.change24h + (Math.random() - 0.5) * 0.1,
        })),
      )
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const filteredPairs = pairs.filter(
    (pair) =>
      pair.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pair.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="trading-interface">
      <div className="trading-header">
        <h1>Spot Trading</h1>
        {onClose && (
          <button className="btn-close" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      <div className="trading-container">
        {/* Left Sidebar - Trading Pairs */}
        <div className="trading-sidebar">
          <div className="pairs-search">
            <input
              type="text"
              placeholder="Search pairs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="pairs-list">
            {filteredPairs.map((pair) => (
              <div
                key={pair.symbol}
                className={`pair-item ${selectedPair.symbol === pair.symbol ? 'active' : ''}`}
                onClick={() => setSelectedPair(pair)}
              >
                <div className="pair-header">
                  <div className="pair-symbol">
                    <span className="symbol-text">{pair.symbol}</span>
                    <span className="symbol-name">{pair.baseAsset}</span>
                  </div>
                  <div className={`pair-change ${pair.change24h >= 0 ? 'positive' : 'negative'}`}>
                    {pair.change24h >= 0 ? '+' : ''}
                    {pair.change24h.toFixed(2)}%
                  </div>
                </div>
                <div className="pair-price">
                  ${pair.lastPrice.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Trading Area */}
        <div className="trading-main">
          {/* Price Chart */}
          <PriceChart pair={selectedPair} />

          {/* Trading Details Row */}
          <div className="trading-details-row">
            {/* Order Book */}
            <OrderBook pair={selectedPair} />

            {/* Spot Trading Panel */}
            <SpotTradingPanel pair={selectedPair} />
          </div>

          {/* Trade History */}
          <TradeHistory pair={selectedPair} />
        </div>
      </div>
    </div>
  )
}
