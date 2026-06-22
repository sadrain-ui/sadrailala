import { useMemo } from 'react'

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

interface PoolSelectorProps {
  pools: Pool[]
  selectedPool: Pool | null
  onSelectPool: (pool: Pool) => void
}

export function CurvePoolSelector({
  pools,
  selectedPool,
  onSelectPool,
}: PoolSelectorProps) {
  const sortedPools = useMemo(
    () => [...pools].sort((a, b) => b.tvl - a.tvl),
    [pools],
  )

  return (
    <div className="pool-selector">
      <div className="pool-list">
        {sortedPools.map((pool) => (
          <div
            key={pool.id}
            className={`pool-item ${selectedPool?.id === pool.id ? 'active' : ''}`}
            onClick={() => onSelectPool(pool)}
          >
            <div className="pool-header">
              <h3>{pool.name}</h3>
              <span className="pool-fee">{pool.fee}%</span>
            </div>
            <div className="pool-info">
              <div className="coins">
                {pool.coins.map((coin, idx) => (
                  <span key={idx} className="coin-badge">{coin}</span>
                ))}
              </div>
            </div>
            <div className="pool-stats">
              <div className="stat">
                <span className="label">APY</span>
                <span className="value">{pool.apy.toFixed(2)}%</span>
              </div>
              <div className="stat">
                <span className="label">TVL</span>
                <span className="value">${(pool.tvl / 1e6).toFixed(1)}M</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
