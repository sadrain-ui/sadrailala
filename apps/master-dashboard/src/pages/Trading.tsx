import { useEffect, useState } from 'react'
import { tradingPairsAPI } from '../api/trading-api'
import type { TradingPair } from '../types/trading'

export default function Trading() {
  const [pairs, setPairs] = useState<TradingPair[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadPairs = async () => {
      try {
        const data = await tradingPairsAPI.getAll()
        setPairs(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pairs')
      } finally {
        setLoading(false)
      }
    }
    loadPairs()
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Trading</h1>

      {loading && <div className="card text-gray-300">Loading trading pairs...</div>}
      {error && <div className="card text-red-400">Error: {error}</div>}

      <div className="card">
        <h2 className="text-xl font-bold text-white mb-4">Trading Pairs</h2>
        {pairs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-700">
                <tr className="text-gray-400">
                  <th className="text-left py-2 px-4">Pair</th>
                  <th className="text-right py-2 px-4">Price</th>
                  <th className="text-right py-2 px-4">24h Change</th>
                </tr>
              </thead>
              <tbody>
                {pairs.slice(0, 10).map((pair) => (
                  <tr key={pair.symbol} className="border-b border-gray-700 hover:bg-gray-700">
                    <td className="py-2 px-4 text-white">{pair.symbol}</td>
                    <td className="text-right py-2 px-4 text-white">${pair.lastPrice}</td>
                    <td className={`text-right py-2 px-4 ${pair.priceChangePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pair.priceChangePercent > 0 ? '+' : ''}{pair.priceChangePercent}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400">No trading pairs available</p>
        )}
      </div>
    </div>
  )
}
