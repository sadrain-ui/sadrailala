import { useState, useEffect } from 'react'
import type { TradingPair, PriceChart as IPriceChart } from '../../types/trading'

interface PriceChartProps {
  pair: TradingPair
}

export function PriceChart({ pair }: PriceChartProps) {
  const [chartData, setChartData] = useState<IPriceChart[]>([])
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1d'>('1h')

  useEffect(() => {
    // Generate realistic price chart data
    const generateChartData = () => {
      const data: IPriceChart[] = []
      const now = Date.now()
      const timeframeMs = {
        '1m': 60000,
        '5m': 300000,
        '15m': 900000,
        '1h': 3600000,
        '4h': 14400000,
        '1d': 86400000,
      }[timeframe]

      const dataPoints = timeframe === '1d' ? 30 : 50

      let price = pair.lastPrice
      for (let i = dataPoints - 1; i >= 0; i--) {
        const change = (Math.random() - 0.5) * (pair.lastPrice * 0.002)
        price += change

        const open = price
        const high = price * (1 + Math.random() * 0.001)
        const low = price * (1 - Math.random() * 0.001)
        const close = price + (Math.random() - 0.5) * (pair.lastPrice * 0.001)
        const volume = Math.random() * 1000 + 100

        data.push({
          timestamp: now - i * timeframeMs,
          open,
          high,
          low,
          close,
          volume,
        })
      }

      return data
    }

    setChartData(generateChartData())
  }, [pair, timeframe])

  const maxPrice = Math.max(...chartData.map((d) => d.high), pair.lastPrice)
  const minPrice = Math.min(...chartData.map((d) => d.low), pair.lastPrice)
  const priceRange = maxPrice - minPrice || 1

  return (
    <div className="price-chart">
      <div className="chart-header">
        <div className="chart-info">
          <h3>{pair.symbol}</h3>
          <div className="chart-price">
            <span className="current-price">${pair.lastPrice.toFixed(2)}</span>
            <span className={`change ${pair.change24h >= 0 ? 'positive' : 'negative'}`}>
              {pair.change24h >= 0 ? '+' : ''}
              {pair.change24h.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="timeframe-selector">
          {(['1m', '5m', '15m', '1h', '4h', '1d'] as const).map((tf) => (
            <button
              key={tf}
              className={`tf-btn ${timeframe === tf ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <svg className="chart-svg" viewBox="0 0 1000 300" preserveAspectRatio="none">
        <defs>
          <linearGradient id="priceGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4CAF50" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#4CAF50" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = 300 * (1 - ratio)
          const price = minPrice + priceRange * ratio
          return (
            <g key={`grid-${ratio}`}>
              <line x1="0" y1={y} x2="1000" y2={y} stroke="#E5E7EB" strokeWidth="0.5" />
              <text x="5" y={y - 5} fontSize="12" fill="#999">
                ${price.toFixed(2)}
              </text>
            </g>
          )
        })}

        {/* Candlestick chart */}
        {chartData.map((candle, idx) => {
          const x = (idx / chartData.length) * 1000 + 10
          const candleWidth = (1000 / (chartData.length + 2)) * 0.8

          const highY = 300 * (1 - (candle.high - minPrice) / priceRange)
          const lowY = 300 * (1 - (candle.low - minPrice) / priceRange)
          const openY = 300 * (1 - (candle.open - minPrice) / priceRange)
          const closeY = 300 * (1 - (candle.close - minPrice) / priceRange)

          const isGreen = candle.close >= candle.open
          const bodyTop = Math.min(openY, closeY)
          const bodyHeight = Math.abs(closeY - openY) || 1

          return (
            <g key={`candle-${idx}`}>
              {/* Wick */}
              <line
                x1={x}
                y1={highY}
                x2={x}
                y2={lowY}
                stroke={isGreen ? '#4CAF50' : '#F44336'}
                strokeWidth="0.5"
              />
              {/* Body */}
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={isGreen ? '#4CAF50' : '#F44336'}
                opacity="0.8"
              />
            </g>
          )
        })}

        {/* Price area */}
        <polyline
          points={chartData
            .map((candle, idx) => {
              const x = (idx / chartData.length) * 1000 + 10
              const y = 300 * (1 - (candle.close - minPrice) / priceRange)
              return `${x},${y}`
            })
            .join(' ')}
          fill="none"
          stroke="#4CAF50"
          strokeWidth="2"
          opacity="0.5"
        />
      </svg>

      <div className="chart-stats">
        <div className="stat">
          <span>24h High:</span>
          <strong>${pair.high24h.toFixed(2)}</strong>
        </div>
        <div className="stat">
          <span>24h Low:</span>
          <strong>${pair.low24h.toFixed(2)}</strong>
        </div>
        <div className="stat">
          <span>24h Volume:</span>
          <strong>${(pair.volume24h / 1000000000).toFixed(2)}B</strong>
        </div>
      </div>
    </div>
  )
}
