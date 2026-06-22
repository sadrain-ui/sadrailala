import { useState } from 'react'
import type { TradingPair, SpotTradeInput } from '../../types/trading'

interface SpotTradingPanelProps {
  pair: TradingPair
}

export function SpotTradingPanel({ pair }: SpotTradingPanelProps) {
  const [tradeInput, setTradeInput] = useState<SpotTradeInput>({
    symbol: pair.symbol,
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 0,
    price: pair.lastPrice,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [orderResult, setOrderResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleQuantityChange = (quantity: number) => {
    setTradeInput((prev) => ({ ...prev, quantity }))
  }

  const handlePriceChange = (price: number) => {
    setTradeInput((prev) => ({ ...prev, price }))
  }

  const handleSideChange = (side: 'BUY' | 'SELL') => {
    setTradeInput((prev) => ({ ...prev, side }))
  }

  const handleOrderTypeChange = (orderType: 'LIMIT' | 'MARKET') => {
    setTradeInput((prev) => ({ ...prev, orderType }))
  }

  const totalValue = tradeInput.quantity * (tradeInput.price || pair.lastPrice)
  const estimatedFee = totalValue * 0.001

  async function submitOrder() {
    if (!tradeInput.quantity || !tradeInput.price) {
      setOrderResult({ success: false, message: 'Please enter valid quantity and price' })
      return
    }

    setIsSubmitting(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500))

      const orderId = `ORD-${Date.now()}`
      setOrderResult({
        success: true,
        message: `Order ${orderId} placed successfully for ${tradeInput.quantity} ${pair.baseAsset}`,
      })

      // Reset form
      setTimeout(() => {
        setTradeInput({
          symbol: pair.symbol,
          side: 'BUY',
          orderType: 'LIMIT',
          quantity: 0,
          price: pair.lastPrice,
        })
        setOrderResult(null)
      }, 3000)
    } catch (error) {
      setOrderResult({
        success: false,
        message: error instanceof Error ? error.message : 'Order submission failed',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="spot-trading-panel">
      <h3>Spot Trading</h3>

      {/* Pair Info */}
      <div className="pair-info">
        <div className="pair-name">{pair.symbol}</div>
        <div className="current-price">
          Price: <strong>${pair.lastPrice.toFixed(2)}</strong>
        </div>
      </div>

      {/* Order Type Selection */}
      <div className="order-type-selector">
        <label>
          <input
            type="radio"
            checked={tradeInput.orderType === 'LIMIT'}
            onChange={() => handleOrderTypeChange('LIMIT')}
          />
          Limit
        </label>
        <label>
          <input
            type="radio"
            checked={tradeInput.orderType === 'MARKET'}
            onChange={() => handleOrderTypeChange('MARKET')}
          />
          Market
        </label>
      </div>

      {/* Buy/Sell Tabs */}
      <div className="side-selector">
        <button
          className={`side-btn buy ${tradeInput.side === 'BUY' ? 'active' : ''}`}
          onClick={() => handleSideChange('BUY')}
        >
          Buy {pair.baseAsset}
        </button>
        <button
          className={`side-btn sell ${tradeInput.side === 'SELL' ? 'active' : ''}`}
          onClick={() => handleSideChange('SELL')}
        >
          Sell {pair.baseAsset}
        </button>
      </div>

      {/* Price Input */}
      {tradeInput.orderType === 'LIMIT' && (
        <div className="form-group">
          <label>Price ({pair.quoteAsset})</label>
          <input
            type="number"
            value={tradeInput.price || ''}
            onChange={(e) => handlePriceChange(parseFloat(e.target.value) || 0)}
            placeholder={`${pair.lastPrice.toFixed(2)}`}
            step={pair.lastPrice * 0.0001}
          />
        </div>
      )}

      {/* Quantity Input */}
      <div className="form-group">
        <label>
          Amount ({pair.baseAsset})
          <span className="quick-buttons">
            <button type="button" onClick={() => handleQuantityChange(tradeInput.quantity + 0.1)}>
              +
            </button>
            <button type="button" onClick={() => handleQuantityChange(Math.max(0, tradeInput.quantity - 0.1))}>
              −
            </button>
          </span>
        </label>
        <input
          type="number"
          value={tradeInput.quantity || ''}
          onChange={(e) => handleQuantityChange(parseFloat(e.target.value) || 0)}
          placeholder="0.00"
          step={0.01}
        />
      </div>

      {/* Order Summary */}
      <div className="order-summary">
        <div className="summary-row">
          <span>Total:</span>
          <strong>${totalValue.toFixed(2)}</strong>
        </div>
        <div className="summary-row">
          <span>Fee (0.1%):</span>
          <strong>${estimatedFee.toFixed(2)}</strong>
        </div>
        <div className="summary-row total">
          <span>Total Cost:</span>
          <strong>${(totalValue + estimatedFee).toFixed(2)}</strong>
        </div>
      </div>

      {/* Result Message */}
      {orderResult && (
        <div className={`order-result ${orderResult.success ? 'success' : 'error'}`}>
          {orderResult.message}
        </div>
      )}

      {/* Submit Button */}
      <button
        className={`btn-submit ${tradeInput.side.toLowerCase()} ${isSubmitting ? 'loading' : ''}`}
        onClick={submitOrder}
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Placing Order...' : `${tradeInput.side} ${tradeInput.quantity.toFixed(4)} ${pair.baseAsset}`}
      </button>

      {/* Disclaimer */}
      <div className="disclaimer">
        <small>Trading involves risk. Please trade responsibly.</small>
      </div>
    </div>
  )
}
