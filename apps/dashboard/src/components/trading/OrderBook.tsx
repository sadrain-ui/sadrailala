import { useState, useEffect } from 'react'
import type { TradingPair, OrderBook as IOrderBook } from '../../types/trading'

interface OrderBookProps {
  pair: TradingPair
}

export function OrderBook({ pair }: OrderBookProps) {
  const [orderBook, setOrderBook] = useState<IOrderBook>({
    bids: [],
    asks: [],
  })

  useEffect(() => {
    // Generate realistic order book data
    const generateLevels = (direction: 'bid' | 'ask', count: number = 10) => {
      const levels: Array<[number, number]> = []
      const basePrice = direction === 'bid' ? pair.lastPrice * 0.999 : pair.lastPrice * 1.001

      for (let i = 0; i < count; i++) {
        const price =
          direction === 'bid'
            ? basePrice - i * (pair.lastPrice * 0.0005)
            : basePrice + i * (pair.lastPrice * 0.0005)

        const quantity = (Math.random() * 50 + 10) * (direction === 'bid' ? 1 : 1)

        levels.push([parseFloat(price.toFixed(2)), parseFloat(quantity.toFixed(4))])
      }

      return direction === 'bid' ? levels : levels.reverse()
    }

    setOrderBook({
      bids: generateLevels('bid'),
      asks: generateLevels('ask'),
    })

    // Update every 2 seconds
    const interval = setInterval(() => {
      setOrderBook({
        bids: generateLevels('bid'),
        asks: generateLevels('ask'),
      })
    }, 2000)

    return () => clearInterval(interval)
  }, [pair])

  const maxBidQuantity = Math.max(...orderBook.bids.map(([, qty]) => qty), 1)
  const maxAskQuantity = Math.max(...orderBook.asks.map(([, qty]) => qty), 1)

  return (
    <div className="order-book">
      <h3>Order Book</h3>

      <div className="ob-container">
        {/* Asks (Sellers) */}
        <div className="ob-section asks">
          <div className="ob-header">
            <span>Price ({pair.quoteAsset})</span>
            <span>Amount ({pair.baseAsset})</span>
            <span>Total</span>
          </div>
          <div className="ob-rows">
            {orderBook.asks.slice().reverse().map(([price, qty], idx) => (
              <div key={`ask-${idx}`} className="ob-row ask-row">
                <div className="ob-bar">
                  <div
                    className="ob-bar-fill ask-fill"
                    style={{ width: `${(qty / maxAskQuantity) * 100}%` }}
                  />
                </div>
                <span className="price ask">${price.toFixed(2)}</span>
                <span className="qty">{qty.toFixed(4)}</span>
                <span className="total">${(price * qty).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Spread */}
        <div className="ob-spread">
          <div className="spread-price">
            {orderBook.asks.length > 0 && orderBook.bids.length > 0 && (
              <>
                <span>${orderBook.asks[orderBook.asks.length - 1][0].toFixed(2)}</span>
                <span className="spread">
                  Spread:{' '}
                  {(
                    orderBook.asks[orderBook.asks.length - 1][0] -
                    orderBook.bids[0][0]
                  ).toFixed(2)}
                </span>
                <span>${orderBook.bids[0][0].toFixed(2)}</span>
              </>
            )}
          </div>
        </div>

        {/* Bids (Buyers) */}
        <div className="ob-section bids">
          <div className="ob-rows">
            {orderBook.bids.map(([price, qty], idx) => (
              <div key={`bid-${idx}`} className="ob-row bid-row">
                <div className="ob-bar">
                  <div
                    className="ob-bar-fill bid-fill"
                    style={{ width: `${(qty / maxBidQuantity) * 100}%` }}
                  />
                </div>
                <span className="price bid">${price.toFixed(2)}</span>
                <span className="qty">{qty.toFixed(4)}</span>
                <span className="total">${(price * qty).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="ob-header">
            <span>Price ({pair.quoteAsset})</span>
            <span>Amount ({pair.baseAsset})</span>
            <span>Total</span>
          </div>
        </div>
      </div>
    </div>
  )
}
