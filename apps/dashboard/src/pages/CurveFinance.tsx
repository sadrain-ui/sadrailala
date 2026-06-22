import { useCallback, useEffect, useState } from 'react'
import { CurvePoolSelector } from '../components/curve/PoolSelector'
import { CurveSwapInterface } from '../components/curve/SwapInterface'
import { CurveLiquidityProvider } from '../components/curve/LiquidityProvider'
import { CurveYieldFarming } from '../components/curve/YieldFarming'
import '../styles/curve-finance.css'

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

interface PoolStats {
  pools: Pool[]
  totalTvl: number
  avgApy: number
  loadTime: number
}

type TabType = 'swap' | 'liquidity' | 'yield'

export function CurveFinance() {
  const [activeTab, setActiveTab] = useState<TabType>('swap')
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)
  const [pools, setPools] = useState<Pool[]>([])
  const [stats, setStats] = useState<PoolStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPools = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/curve/pools')
      if (!response.ok) {
        throw new Error(`Failed to fetch pools: ${response.statusText}`)
      }
      const data: PoolStats = await response.json()
      setPools(data.pools)
      setStats(data)
      if (data.pools.length > 0 && !selectedPool) {
        setSelectedPool(data.pools[0])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pools')
      console.error('Pool fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [selectedPool])

  useEffect(() => {
    fetchPools()
    const interval = setInterval(fetchPools, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [fetchPools])

  return (
    <div className="curve-finance-container">
      <header className="curve-header">
        <div className="curve-title">
          <h1>Curve Finance</h1>
          <p>Stablecoin & crypto swaps with minimal slippage</p>
        </div>
        <button
          className="btn btn-secondary refresh-btn"
          onClick={fetchPools}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh Pools'}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="curve-main">
        <div className="curve-sidebar">
          <h2>Liquidity Pools</h2>
          {stats && (
            <div className="stats-summary">
              <div className="stat-item">
                <span className="stat-label">Total TVL</span>
                <span className="stat-value">${(stats.totalTvl / 1e9).toFixed(2)}B</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Avg APY</span>
                <span className="stat-value">{stats.avgApy.toFixed(2)}%</span>
              </div>
            </div>
          )}
          <CurvePoolSelector
            pools={pools}
            selectedPool={selectedPool}
            onSelectPool={setSelectedPool}
          />
        </div>

        <div className="curve-content">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'swap' ? 'active' : ''}`}
              onClick={() => setActiveTab('swap')}
            >
              Swap
            </button>
            <button
              className={`tab ${activeTab === 'liquidity' ? 'active' : ''}`}
              onClick={() => setActiveTab('liquidity')}
            >
              Liquidity
            </button>
            <button
              className={`tab ${activeTab === 'yield' ? 'active' : ''}`}
              onClick={() => setActiveTab('yield')}
            >
              Yield Farming
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'swap' && selectedPool && (
              <CurveSwapInterface pool={selectedPool} />
            )}
            {activeTab === 'liquidity' && selectedPool && (
              <CurveLiquidityProvider pool={selectedPool} />
            )}
            {activeTab === 'yield' && selectedPool && (
              <CurveYieldFarming pool={selectedPool} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
