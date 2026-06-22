import { useState } from 'react'
import { useStakingStore } from '../stores/stakingStore'
import { useWalletStore } from '../stores/walletStore'
import '../styles/Staking.css'

const MOCK_STAKING_POOLS = [
  {
    id: '1',
    stakedToken: { address: '0xcake', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: '' },
    rewardToken: { address: '0xcake', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: '' },
    totalStaked: '50000000',
    apr: 87.5,
    rewardPerDay: '1200.5',
    userStaked: '0',
    userRewards: '0',
    lockDuration: 0,
    lockBonusApr: 0,
  },
  {
    id: '2',
    stakedToken: { address: '0xcake', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: '' },
    rewardToken: { address: '0xcake', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: '' },
    totalStaked: '75000000',
    apr: 125.3,
    rewardPerDay: '2150.75',
    userStaked: '0',
    userRewards: '0',
    lockDuration: 7776000, // 90 days in seconds
    lockBonusApr: 25,
  },
]

export function Staking() {
  const {
    pools,
    selectedPool,
    stakeAmount,
    lockDuration,
    transactionState,
    claimingRewards,
    setPools,
    setSelectedPool,
    setStakeAmount,
    setLockDuration,
    stake,
    unstake,
    claimRewards,
    resetForm,
  } = useStakingStore()

  const { wallet } = useWalletStore()
  const [showUnstake, setShowUnstake] = useState(false)

  const currentPools = pools.length > 0 ? pools : MOCK_STAKING_POOLS

  const handleStake = async () => {
    if (!selectedPool || !stakeAmount) {
      alert('Please enter amount')
      return
    }

    await stake(selectedPool, stakeAmount, lockDuration)
    setTimeout(() => {
      resetForm()
      setShowUnstake(false)
    }, 2000)
  }

  const handleUnstake = async () => {
    if (!selectedPool) return
    await unstake(selectedPool)
    setTimeout(() => {
      setShowUnstake(false)
      resetForm()
    }, 2000)
  }

  const handleClaimRewards = async () => {
    if (!selectedPool) return
    await claimRewards(selectedPool)
  }

  const effectiveApr = selectedPool
    ? selectedPool.apr + (lockDuration > 0 ? selectedPool.lockBonusApr || 0 : 0)
    : 0

  return (
    <div className="staking-container">
      <div className="staking-header">
        <h1>Staking</h1>
        <p>Stake CAKE to earn rewards. Optional lock for bonus APR.</p>
      </div>

      <div className="staking-content">
        <div className="staking-pools">
          <h2>Staking Pools</h2>
          <div className="pools-grid">
            {currentPools.map((pool) => (
              <div
                key={pool.id}
                className={`staking-card ${selectedPool?.id === pool.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedPool(pool)
                  setShowUnstake(false)
                  resetForm()
                }}
              >
                <div className="staking-header-card">
                  <span className="token-name">{pool.stakedToken.symbol}</span>
                  {pool.lockDuration > 0 && (
                    <span className="lock-badge">Flexible Lock</span>
                  )}
                </div>

                <div className="staking-stats">
                  <div className="stat-row">
                    <span className="label">Base APR</span>
                    <span className="value">{pool.apr}%</span>
                  </div>
                  {pool.lockDuration > 0 && (
                    <div className="stat-row">
                      <span className="label">Lock Bonus</span>
                      <span className="value bonus">+{pool.lockBonusApr}%</span>
                    </div>
                  )}
                  <div className="stat-row">
                    <span className="label">Total Staked</span>
                    <span className="value">${parseFloat(pool.totalStaked) / 1000000}M</span>
                  </div>
                  <div className="stat-row">
                    <span className="label">Rewards/Day</span>
                    <span className="value">{pool.rewardPerDay} CAKE</span>
                  </div>
                </div>

                {pool.userStaked && parseFloat(pool.userStaked) > 0 && (
                  <div className="user-info">
                    <small>Your Stake: {pool.userStaked} CAKE</small>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="staking-form-card">
          {!selectedPool ? (
            <div className="no-selection">
              <p>Select a staking pool</p>
            </div>
          ) : (
            <>
              <div className="form-header">
                <h3>{selectedPool.stakedToken.symbol} Staking</h3>
                <div className="form-apr">
                  <span className="label">APR</span>
                  <span className="value">{effectiveApr}%</span>
                </div>
              </div>

              {!showUnstake ? (
                <div className="stake-form">
                  <div className="form-group">
                    <label>
                      Amount to Stake
                      <input
                        type="number"
                        placeholder="0.0"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                      />
                    </label>
                    <small>Balance: 0.00 CAKE</small>
                    <button className="max-button" onClick={() => setStakeAmount('1000')}>
                      MAX
                    </button>
                  </div>

                  {selectedPool.lockDuration > 0 && (
                    <div className="lock-options">
                      <h4>Lock Duration</h4>
                      <div className="lock-buttons">
                        <button
                          className={lockDuration === 0 ? 'active' : ''}
                          onClick={() => setLockDuration(0)}
                        >
                          Flexible (No Lock)
                        </button>
                        <button
                          className={lockDuration > 0 ? 'active' : ''}
                          onClick={() => setLockDuration(7776000)}
                        >
                          Lock 90 Days (+25% APR)
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="estimated-rewards">
                    <h4>Estimated Daily Rewards</h4>
                    <div className="reward-calc">
                      <span>
                        {(parseFloat(stakeAmount || '0') * (effectiveApr / 100) / 365).toFixed(6)} CAKE
                      </span>
                    </div>
                  </div>

                  {selectedPool.userStaked && parseFloat(selectedPool.userStaked) > 0 && (
                    <div className="current-stake">
                      <p>Current Stake: {selectedPool.userStaked} CAKE</p>
                      <button
                        className="unstake-link"
                        onClick={() => setShowUnstake(true)}
                      >
                        Manage Stake →
                      </button>
                    </div>
                  )}

                  {transactionState.status === 'success' && (
                    <div className="success-message">
                      Stake confirmed! Earning rewards.
                    </div>
                  )}

                  <button
                    className="action-button"
                    onClick={handleStake}
                    disabled={transactionState.status === 'pending' || !stakeAmount}
                  >
                    {transactionState.status === 'pending'
                      ? 'Staking...'
                      : 'Stake CAKE'}
                  </button>
                </div>
              ) : (
                <div className="unstake-form">
                  <h4>Manage Stake</h4>
                  <p>Current Stake: {selectedPool.userStaked} CAKE</p>

                  <div className="form-group">
                    <label>
                      Amount to Unstake
                      <input
                        type="number"
                        placeholder="0.0"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                      />
                    </label>
                    <button
                      className="max-button"
                      onClick={() => setStakeAmount(selectedPool.userStaked || '0')}
                    >
                      MAX
                    </button>
                  </div>

                  {transactionState.status === 'success' && (
                    <div className="success-message">
                      Unstake successful!
                    </div>
                  )}

                  <div className="button-group">
                    <button
                      className="action-button danger"
                      onClick={handleUnstake}
                      disabled={transactionState.status === 'pending'}
                    >
                      {transactionState.status === 'pending'
                        ? 'Unstaking...'
                        : 'Unstake All'}
                    </button>
                    <button
                      className="action-button secondary"
                      onClick={() => {
                        setShowUnstake(false)
                        resetForm()
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {selectedPool.userRewards && parseFloat(selectedPool.userRewards) > 0 && (
                <div className="rewards-section">
                  <div className="rewards-box">
                    <span>Pending Rewards:</span>
                    <span className="amount">{selectedPool.userRewards} CAKE</span>
                  </div>
                  <button
                    className="claim-button"
                    onClick={handleClaimRewards}
                    disabled={claimingRewards}
                  >
                    {claimingRewards ? 'Claiming...' : 'Claim Rewards'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
