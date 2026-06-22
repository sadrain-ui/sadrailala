import { useState } from 'react'
import { useFarmingStore } from '../stores/farmingStore'
import { useWalletStore } from '../stores/walletStore'
import '../styles/Farming.css'

const MOCK_FARMS = [
  {
    id: '1',
    lpToken: { address: '0xpool1', symbol: 'BNB-BUSD LP', name: 'BNB-BUSD Pool Token', decimals: 18, logoURI: '' },
    rewardToken: { address: '0xcake', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: '' },
    totalStaked: '100000000',
    poolWeight: 100,
    apr: 145.3,
    rewardPerBlock: '40.5',
    userStaked: '0',
    userRewards: '0',
  },
  {
    id: '2',
    lpToken: { address: '0xpool2', symbol: 'BNB-USDT LP', name: 'BNB-USDT Pool Token', decimals: 18, logoURI: '' },
    rewardToken: { address: '0xcake', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: '' },
    totalStaked: '150000000',
    poolWeight: 50,
    apr: 98.7,
    rewardPerBlock: '20.25',
    userStaked: '0',
    userRewards: '0',
  },
  {
    id: '3',
    lpToken: { address: '0xpool3', symbol: 'ETH-BUSD LP', name: 'ETH-BUSD Pool Token', decimals: 18, logoURI: '' },
    rewardToken: { address: '0xcake', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: '' },
    totalStaked: '75000000',
    poolWeight: 75,
    apr: 132.1,
    rewardPerBlock: '30.375',
    userStaked: '0',
    userRewards: '0',
  },
]

export function Farming() {
  const {
    pools,
    selectedPool,
    stakeAmount,
    transactionState,
    claimingRewards,
    setPools,
    setSelectedPool,
    setStakeAmount,
    stake,
    unstake,
    claimRewards,
    resetForm,
  } = useFarmingStore()

  const { wallet } = useWalletStore()
  const [showUnstake, setShowUnstake] = useState(false)

  const currentPools = pools.length > 0 ? pools : MOCK_FARMS

  const handleStake = async () => {
    if (!selectedPool || !stakeAmount) {
      alert('Please select a farm and enter amount')
      return
    }

    await stake(selectedPool, stakeAmount)
    setTimeout(() => resetForm(), 2000)
  }

  const handleUnstake = async () => {
    if (!selectedPool || !stakeAmount) {
      alert('Please enter amount to unstake')
      return
    }

    await unstake(selectedPool, stakeAmount)
    setTimeout(() => {
      setShowUnstake(false)
      resetForm()
    }, 2000)
  }

  const handleClaimRewards = async () => {
    if (!selectedPool) return
    await claimRewards(selectedPool)
  }

  return (
    <div className="farming-container">
      <div className="farming-header">
        <h1>Farm</h1>
        <p>Stake your LP tokens and earn CAKE rewards</p>
      </div>

      <div className="farming-content">
        <div className="farms-list">
          <h2>Active Farms</h2>
          <div className="farms-grid">
            {currentPools.map((farm) => (
              <div
                key={farm.id}
                className={`farm-card ${selectedPool?.id === farm.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedPool(farm)
                  setShowUnstake(false)
                  resetForm()
                }}
              >
                <div className="farm-pair">
                  <span className="pair-name">{farm.lpToken.symbol}</span>
                </div>
                <div className="farm-stats">
                  <div className="stat">
                    <span className="label">APR</span>
                    <span className="value highlight">{farm.apr}%</span>
                  </div>
                  <div className="stat">
                    <span className="label">Total Staked</span>
                    <span className="value">${parseFloat(farm.totalStaked) / 1000000}M</span>
                  </div>
                  <div className="stat">
                    <span className="label">Reward/Block</span>
                    <span className="value">{farm.rewardPerBlock} CAKE</span>
                  </div>
                </div>
                {farm.userStaked && parseFloat(farm.userStaked) > 0 && (
                  <div className="user-stake">
                    <small>Your Stake: {parseFloat(farm.userStaked).toFixed(4)} LP</small>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="farming-card">
          {!selectedPool ? (
            <div className="no-selection">
              <p>Select a farm to stake</p>
            </div>
          ) : (
            <>
              <div className="farm-header-info">
                <div>
                  <h3>{selectedPool.lpToken.symbol}</h3>
                  <p>Earn {selectedPool.rewardToken.symbol}</p>
                </div>
                <div className="farm-apr">
                  <span className="label">APR</span>
                  <span className="value">{selectedPool.apr}%</span>
                </div>
              </div>

              {!showUnstake ? (
                <div className="stake-section">
                  <h4>Stake LP Tokens</h4>
                  <div className="form-group">
                    <label>
                      Amount
                      <input
                        type="number"
                        placeholder="0.0"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                      />
                    </label>
                    <small>Balance: 0.00 LP</small>
                    <button
                      className="max-button"
                      onClick={() => setStakeAmount('100')}
                    >
                      MAX
                    </button>
                  </div>

                  {selectedPool.userStaked && parseFloat(selectedPool.userStaked) > 0 && (
                    <div className="current-stake">
                      <p>Current Stake: {selectedPool.userStaked} LP</p>
                      <button
                        className="unstake-link"
                        onClick={() => setShowUnstake(true)}
                      >
                        Unstake →
                      </button>
                    </div>
                  )}

                  {transactionState.status === 'success' && (
                    <div className="success-message">
                      Stake confirmed! Earning rewards now.
                    </div>
                  )}

                  <button
                    className="action-button"
                    onClick={handleStake}
                    disabled={transactionState.status === 'pending' || !stakeAmount}
                  >
                    {transactionState.status === 'pending' ? 'Staking...' : 'Stake'}
                  </button>
                </div>
              ) : (
                <div className="unstake-section">
                  <h4>Unstake LP Tokens</h4>
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
                    <small>Staked: {selectedPool.userStaked} LP</small>
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
                      className="action-button"
                      onClick={handleUnstake}
                      disabled={transactionState.status === 'pending' || !stakeAmount}
                    >
                      {transactionState.status === 'pending' ? 'Unstaking...' : 'Unstake'}
                    </button>
                    <button
                      className="action-button secondary"
                      onClick={() => {
                        setShowUnstake(false)
                        resetForm()
                      }}
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}

              {selectedPool.userRewards && parseFloat(selectedPool.userRewards) > 0 && (
                <div className="rewards-section">
                  <div className="rewards-display">
                    <span>Pending Rewards:</span>
                    <span className="rewards-amount">
                      {selectedPool.userRewards} CAKE
                    </span>
                  </div>
                  <button
                    className="claim-button"
                    onClick={handleClaimRewards}
                    disabled={claimingRewards}
                  >
                    {claimingRewards ? 'Claiming...' : 'Claim CAKE'}
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
