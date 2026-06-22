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

interface FarmPosition {
  depositAmount: string
  lpTokens: string
  pendingRewards: string
  claimableRewards: string
  estimatedYearlyYield: string
  stakedDuration: string
  unlockDate: string
}

interface YieldFarmingProps {
  pool: Pool
}

export function CurveYieldFarming({ pool }: YieldFarmingProps) {
  const [position, setPosition] = useState<FarmPosition | null>(null)
  const [stakeAmount, setStakeAmount] = useState<string>('')
  const [duration, setDuration] = useState<string>('30') // days
  const [loading, setLoading] = useState(false)
  const [staking, setStaking] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lpBalance, setLpBalance] = useState<string>('0')

  const fetchPosition = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/curve/yield/position?poolId=${pool.id}`)
      if (!response.ok) {
        throw new Error('Failed to fetch farm position')
      }
      const data = await response.json()
      setPosition(data.position)
      setLpBalance(data.lpBalance)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch position')
    } finally {
      setLoading(false)
    }
  }, [pool.id])

  useEffect(() => {
    fetchPosition()
    const interval = setInterval(fetchPosition, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [fetchPosition])

  const handleStake = async () => {
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setStaking(true)
    setError(null)
    try {
      const response = await fetch('/api/curve/yield/stake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolId: pool.id,
          amount: stakeAmount,
          lockDuration: parseInt(duration),
        }),
      })

      if (!response.ok) {
        throw new Error('Staking failed')
      }

      const result = await response.json()
      setStakeAmount('')
      setDuration('30')
      await fetchPosition()
      alert(`Staked successfully! TX: ${result.txHash}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Staking failed')
    } finally {
      setStaking(false)
    }
  }

  const handleClaimRewards = async () => {
    if (!position || parseFloat(position.claimableRewards) <= 0) {
      setError('No rewards to claim')
      return
    }

    setClaiming(true)
    setError(null)
    try {
      const response = await fetch('/api/curve/yield/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolId: pool.id,
        }),
      })

      if (!response.ok) {
        throw new Error('Claim failed')
      }

      const result = await response.json()
      await fetchPosition()
      alert(`Rewards claimed! TX: ${result.txHash}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed')
    } finally {
      setClaiming(false)
    }
  }

  const estimateYield = (amount: string, days: string): string => {
    if (!amount || !days) return '0'
    const principal = parseFloat(amount)
    const dayCount = parseInt(days)
    const dailyRate = pool.apy / 365
    const yield_ = principal * (dailyRate / 100) * dayCount
    return yield_.toFixed(6)
  }

  return (
    <div className="yield-farming">
      <div className="farming-form">
        <h3>Stake LP Tokens</h3>

        <div className="form-section">
          <label>
            <span>LP Token Amount</span>
            <div className="input-with-balance">
              <input
                type="number"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="0.0"
                min="0"
                step="0.0001"
              />
              <span className="balance">Balance: {lpBalance}</span>
            </div>
          </label>
        </div>

        <div className="form-section">
          <label>
            <span>Lock Duration (days)</span>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days (default)</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </select>
          </label>
        </div>

        <div className="yield-estimate">
          <h4>Estimated Yield</h4>
          <div className="estimate-row">
            <span>APY</span>
            <span className="value">{pool.apy.toFixed(2)}%</span>
          </div>
          <div className="estimate-row">
            <span>Est. {duration} day return</span>
            <span className="value highlight">
              {estimateYield(stakeAmount, duration)} tokens
            </span>
          </div>
          <div className="estimate-row">
            <span>Unlock date</span>
            <span className="value">
              {new Date(Date.now() + parseInt(duration) * 24 * 60 * 60 * 1000).toLocaleDateString()}
            </span>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        <button
          className="btn btn-primary stake-btn"
          onClick={handleStake}
          disabled={staking || !stakeAmount || parseFloat(stakeAmount) <= 0}
        >
          {staking ? 'Staking...' : 'Stake Tokens'}
        </button>
      </div>

      {position && (
        <div className="farming-position">
          <h3>Your Position</h3>

          <div className="position-section">
            <h4>Deposit Info</h4>
            <div className="info-grid">
              <div className="info-item">
                <span className="label">LP Tokens Staked</span>
                <span className="value">{position.lpTokens}</span>
              </div>
              <div className="info-item">
                <span className="label">Initial Deposit</span>
                <span className="value">{position.depositAmount}</span>
              </div>
              <div className="info-item">
                <span className="label">Lock Duration</span>
                <span className="value">{position.stakedDuration}</span>
              </div>
              <div className="info-item">
                <span className="label">Unlock Date</span>
                <span className="value">{position.unlockDate}</span>
              </div>
            </div>
          </div>

          <div className="position-section">
            <h4>Rewards</h4>
            <div className="rewards-grid">
              <div className="reward-item">
                <span className="label">Pending Rewards</span>
                <span className="value pending">{position.pendingRewards}</span>
              </div>
              <div className="reward-item">
                <span className="label">Claimable Rewards</span>
                <span className="value claimable">{position.claimableRewards}</span>
              </div>
              <div className="reward-item">
                <span className="label">Est. Yearly Yield</span>
                <span className="value">{position.estimatedYearlyYield}</span>
              </div>
            </div>

            {parseFloat(position.claimableRewards) > 0 && (
              <button
                className="btn btn-secondary claim-btn"
                onClick={handleClaimRewards}
                disabled={claiming}
              >
                {claiming ? 'Claiming...' : 'Claim Rewards'}
              </button>
            )}
          </div>
        </div>
      )}

      {!position && !loading && (
        <div className="no-position">
          <p>No active farming position. Stake LP tokens to earn rewards!</p>
        </div>
      )}

      <div className="farming-info">
        <h3>Yield Farming Overview</h3>
        <div className="info-cards">
          <div className="info-card">
            <h4>Rewards Structure</h4>
            <p>
              Earn trading fees ({pool.fee}%) plus additional governance token rewards based on your stake
              and lock duration.
            </p>
          </div>
          <div className="info-card">
            <h4>Lock Duration Benefits</h4>
            <ul>
              <li>7 days: 1x boost</li>
              <li>14 days: 1.2x boost</li>
              <li>30 days: 1.5x boost</li>
              <li>90 days: 2.0x boost</li>
              <li>180 days: 2.5x boost</li>
              <li>365 days: 3.0x boost</li>
            </ul>
          </div>
          <div className="info-card">
            <h4>Early Unstaking</h4>
            <p>
              Unstaking before the lock period expires incurs a penalty. The penalty decreases as you approach
              the unlock date.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
