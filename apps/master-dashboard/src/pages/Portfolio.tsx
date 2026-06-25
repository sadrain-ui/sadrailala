import { useEffect, useState } from 'react'
import { accountAPI } from '../api/trading-api'
import type { Portfolio } from '../types/trading'

export default function Portfolio() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadPortfolio = async () => {
      try {
        const data = await accountAPI.getPortfolio()
        setPortfolio(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load portfolio')
      } finally {
        setLoading(false)
      }
    }
    loadPortfolio()
  }, [])

  if (loading) return <div className="card text-gray-300">Loading portfolio...</div>
  if (error) return <div className="card text-red-400">Error: {error}</div>
  if (!portfolio) return <div className="card text-gray-300">No portfolio data</div>

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Portfolio</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-gray-400 text-sm">Total Balance</p>
          <p className="text-2xl font-bold text-white mt-1">${portfolio.totalBalance}</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Total Value</p>
          <p className="text-2xl font-bold text-white mt-1">${portfolio.totalValue}</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Profit/Loss</p>
          <p className={`text-2xl font-bold mt-1 ${portfolio.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {portfolio.profitLoss > 0 ? '+' : ''}{portfolio.profitLoss}%
          </p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-bold text-white mb-4">Holdings</h2>
        <div className="space-y-2">
          {portfolio.assets?.slice(0, 10).map((asset) => (
            <div key={asset.symbol} className="flex justify-between items-center pb-2 border-b border-gray-700">
              <span className="text-white">{asset.symbol}</span>
              <span className="text-gray-400">${asset.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
