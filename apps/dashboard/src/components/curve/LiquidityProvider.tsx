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

interface LPPositionQuote {
  lpTokenAmount: string
  share: number
  poolShare: number
  fee: string
}

interface LiquidityProviderProps {
  pool: Pool
}

export function CurveLiquidityProvider({ pool }: LiquidityProviderProps) {
  const [amounts, setAmounts] = useState<Record<string, string>>(
    pool.coins.reduce((acc, coin) => ({ ...acc, [coin]: '' }), {}),
  )
  const [quote, setQuote] = useState<LPPositionQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [providing, setProviding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeType, setActiveType] = useState<'balanced' | 'single'>('balanced')

  const fetchQuote = useCallback(async () => {
    const nonZeroAmounts = Object.entries(amounts).filter(([, val]) => val && parseFloat(val) > 0)
    if (nonZeroAmounts.length === 0) {
      setQuote(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        poolId: pool.id,
        ...Object.fromEntries(nonZeroAmounts),
      })
      const response = await fetch(`/api/curve/liquidity/quote?${params}`)
      if (!response.ok) {
        throw new Error('Failed to fetch liquidity quote')
      }
      const data: LPPositionQuote = await response.json()
      setQuote(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get quote')
      setQuote(null)
    } finally {
      setLoading(false)
    }
  }, [pool.id, amounts])

  useEffect(() => {
    const timer = setTimeout(fetchQuote, 500)
    return () => clearTimeout(timer)
  }, [amounts, fetchQuote])

  const handleProvideLiquidity = async () => {
    if (!quote) return

    setProviding(true)
    setError(null)
    try {
      const response = await fetch('/api/curve/liquidity/provide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolId: pool.id,
          amounts,
          minLPTokens: quote.lpTokenAmount,
        }),
      })

      if (!response.ok) {
        throw new Error('Liquidity provision failed')
      }

      const result = await response.json()
      setAmounts(pool.coins.reduce((acc, coin) => ({ ...acc, [coin]: '' }), {}))
      setQuote(null)
      alert(`Liquidity provided! TX: ${result.txHash}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Liquidity provision failed')
    } finally {
      setProviding(false)
    }
  }

  const handleBalancedDeposit = () => {
    // Auto-calculate balanced amounts based on pool ratios
    const baseAmount = amounts[pool.coins[0]] || '1'
    const balanced = pool.coins.reduce((acc, coin) => {
      acc[coin] = baseAmount
      return acc
    }, {} as Record<string, string>)
    setAmounts(balanced)
  }

  const updateAmount = (coin: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [coin]: value }))
  }

  return (
    <div className="liquidity-provider">
      <div className="lp-form">
        <div className="type-selector">
          <button
            className={`type-btn ${activeType === 'balanced' ? 'active' : ''}`}
            onClick={() => setActiveType('balanced')}
          >
            Balanced Deposit
          </button>
          <button
            className={`type-btn ${activeType === 'single' ? 'active' : ''}`}
            onClick={() => setActiveType('single')}
          >
            Single-Sided
          </button>
        </div>

        <div className="deposit-inputs">
          <h3>Deposit Amounts</h3>
          {pool.coins.map((coin, idx) => (
            <div key={coin} className="input-section">
              <label>
                <span>{coin}</span>
                <input
                  type="number"
                  value={amounts[coin]}
                  onChange={(e) => updateAmount(coin, e.target.value)}
                  placeholder="0.0"
                  min="0"
                  step="0.0001"
                />
              </label>
              <span className="balance">Balance available in pool: {pool.balances[idx]}</span>
            </div>
          ))}
        </div>

        {activeType === 'balanced' && (
          <button className="btn btn-secondary auto-balance" onClick={handleBalancedDeposit}>
            Auto-calculate balanced amounts
          </button>
        )}

        {quote && (
          <div className="lp-quote">
            <div className="quote-section">
              <h4>Quote Details</h4>
              <div className="detail-row">
                <span>LP Tokens to Mint</span>
                <span className="highlight">{quote.lpTokenAmount}</span>
              </div>
              <div className="detail-row">
                <span>Your Pool Share</span>
                <span>{quote.poolShare.toFixed(4)}%</span>
              </div>
              <div className="detail-row">
                <span>Share of LP Tokens</span>
                <span>{quote.share.toFixed(4)}%</span>
              </div>
              <div className="detail-row">
                <span>Transaction Fee</span>
                <span>{quote.fee}</span>
              </div>
            </div>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <button
          className="btn btn-primary provide-btn"
          onClick={handleProvideLiquidity}
          disabled={!quote || providing || Object.values(amounts).every((v) => !v)}
        >
          {providing ? 'Providing...' : 'Provide Liquidity'}
        </button>
      </div>

      <div className="lp-benefits">
        <h3>LP Benefits</h3>
        <ul>
          <li>
            <strong>Trading Fees:</strong> Earn {pool.fee}% on all trades in this pool
          </li>
          <li>
            <strong>Yield Farming:</strong> Additional rewards of up to {pool.apy.toFixed(2)}% APY
          </li>
          <li>
            <strong>Impermanent Loss:</strong> Minimized on stablecoin pools
          </li>
          <li>
            <strong>Liquidity Rewards:</strong> Proportional to your share of the pool
          </li>
        </ul>

        <div className="position-info">
          <h4>Current Pool Stats</h4>
          <div className="stat-grid">
            <div className="stat">
              <span className="label">Total TVL</span>
              <span className="value">${(pool.tvl / 1e6).toFixed(1)}M</span>
            </div>
            <div className="stat">
              <span className="label">Current APY</span>
              <span className="value">{pool.apy.toFixed(2)}%</span>
            </div>
            <div className="stat">
              <span className="label">Pool Fee</span>
              <span className="value">{pool.fee}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
