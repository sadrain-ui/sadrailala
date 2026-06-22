import { useCallback, useEffect, useState } from 'react'

interface Pool {
  id: string
  name: string
  address: string
  coins: string[]
  balances: string[]
  fee: number
  apy: number
  tvl: number
}

interface SwapQuote {
  amountOut: string
  priceImpact: number
  minAmountOut: string
  fee: string
}

interface SwapInterfaceProps {
  pool: Pool
}

export function CurveSwapInterface({ pool }: SwapInterfaceProps) {
  const [tokenIn, setTokenIn] = useState<string>(pool.coins[0] || '')
  const [tokenOut, setTokenOut] = useState<string>(pool.coins[1] || '')
  const [amountIn, setAmountIn] = useState<string>('')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slippage, setSlippage] = useState(0.5) // 0.5% default slippage

  const fetchQuote = useCallback(async () => {
    if (!amountIn || parseFloat(amountIn) <= 0) {
      setQuote(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        poolId: pool.id,
        tokenIn,
        tokenOut,
        amount: amountIn,
        slippage: slippage.toString(),
      })
      const response = await fetch(`/api/curve/quote?${params}`)
      if (!response.ok) {
        throw new Error('Failed to fetch quote')
      }
      const data: SwapQuote = await response.json()
      setQuote(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get quote')
      setQuote(null)
    } finally {
      setLoading(false)
    }
  }, [pool.id, tokenIn, tokenOut, amountIn, slippage])

  useEffect(() => {
    const timer = setTimeout(fetchQuote, 500)
    return () => clearTimeout(timer)
  }, [amountIn, tokenIn, tokenOut, slippage, fetchQuote])

  const handleSwap = async () => {
    if (!quote || !amountIn) return

    setSwapping(true)
    setError(null)
    try {
      const response = await fetch('/api/curve/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolId: pool.id,
          tokenIn,
          tokenOut,
          amountIn,
          minAmountOut: quote.minAmountOut,
        }),
      })

      if (!response.ok) {
        throw new Error('Swap failed')
      }

      const result = await response.json()
      setAmountIn('')
      setQuote(null)
      alert(`Swap successful! TX: ${result.txHash}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Swap failed')
    } finally {
      setSwapping(false)
    }
  }

  const swapTokens = () => {
    const temp = tokenIn
    setTokenIn(tokenOut)
    setTokenOut(temp)
  }

  const availableOutTokens = pool.coins.filter((c) => c !== tokenIn)

  return (
    <div className="swap-interface">
      <div className="swap-form">
        <div className="form-section">
          <label>
            <span>You pay</span>
            <div className="input-group">
              <input
                type="number"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                placeholder="0.0"
                min="0"
                step="0.0001"
              />
              <select
                value={tokenIn}
                onChange={(e) => setTokenIn(e.target.value)}
              >
                {pool.coins.map((coin) => (
                  <option key={coin} value={coin}>
                    {coin}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>

        <button className="swap-button" onClick={swapTokens} title="Swap tokens">
          ⇅
        </button>

        <div className="form-section">
          <label>
            <span>You receive</span>
            <div className="input-group">
              <input
                type="text"
                value={quote?.amountOut || ''}
                readOnly
                placeholder="0.0"
              />
              <select
                value={tokenOut}
                onChange={(e) => setTokenOut(e.target.value)}
              >
                {availableOutTokens.map((coin) => (
                  <option key={coin} value={coin}>
                    {coin}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>

        <div className="settings">
          <label>
            <span>Slippage tolerance (%)</span>
            <input
              type="number"
              value={slippage}
              onChange={(e) => setSlippage(parseFloat(e.target.value) || 0)}
              min="0"
              max="5"
              step="0.1"
            />
          </label>
        </div>

        {quote && (
          <div className="quote-details">
            <div className="detail-row">
              <span>Price Impact</span>
              <span className={quote.priceImpact > 1 ? 'warning' : ''}>
                {quote.priceImpact.toFixed(3)}%
              </span>
            </div>
            <div className="detail-row">
              <span>Minimum received</span>
              <span>{quote.minAmountOut} {tokenOut}</span>
            </div>
            <div className="detail-row">
              <span>Trading fee</span>
              <span>{quote.fee}</span>
            </div>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <button
          className="btn btn-primary swap-execute"
          onClick={handleSwap}
          disabled={!quote || swapping || !amountIn}
        >
          {swapping ? 'Swapping...' : 'Execute Swap'}
        </button>
      </div>

      <div className="swap-info">
        <h3>Pool Information</h3>
        <div className="info-grid">
          <div className="info-item">
            <span className="label">Pool Name</span>
            <span className="value">{pool.name}</span>
          </div>
          <div className="info-item">
            <span className="label">Fee</span>
            <span className="value">{pool.fee}%</span>
          </div>
          <div className="info-item">
            <span className="label">Pool Address</span>
            <span className="value mono">{pool.address.slice(0, 10)}...{pool.address.slice(-8)}</span>
          </div>
          <div className="info-item">
            <span className="label">APY</span>
            <span className="value">{pool.apy.toFixed(2)}%</span>
          </div>
          <div className="info-item">
            <span className="label">Total TVL</span>
            <span className="value">${(pool.tvl / 1e6).toFixed(1)}M</span>
          </div>
        </div>
      </div>
    </div>
  )
}
