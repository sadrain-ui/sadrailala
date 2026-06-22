import { useState } from 'react'
import { useLiquidityStore } from '../stores/liquidityStore'
import { useWalletStore } from '../stores/walletStore'
import '../styles/Liquidity.css'

const MOCK_POOLS = [
  {
    id: '1',
    token0: { address: '0x1', symbol: 'BNB', name: 'Binance Coin', decimals: 18 },
    token1: { address: '0x2', symbol: 'BUSD', name: 'Binance USD', decimals: 18 },
    reserve0: '1000000',
    reserve1: '500000000',
    totalSupply: '22360679',
    feeTier: 25,
    volume24h: '5000000',
    apr: 45.2,
    tvl: '500000000',
    lpTokenAddress: '0xpool1',
  },
  {
    id: '2',
    token0: { address: '0x1', symbol: 'BNB', name: 'Binance Coin', decimals: 18 },
    token1: { address: '0x3', symbol: 'USDT', name: 'Tether USD', decimals: 18 },
    reserve0: '2000000',
    reserve1: '1000000000',
    totalSupply: '44721359',
    feeTier: 25,
    volume24h: '8000000',
    apr: 38.5,
    tvl: '1000000000',
    lpTokenAddress: '0xpool2',
  },
]

export function Liquidity() {
  const {
    pools,
    selectedPool,
    amount0,
    amount1,
    transactionState,
    userShare,
    setSelectedPool,
    setAmount0,
    setAmount1,
    addLiquidity,
    removeLiquidity,
    resetForm,
  } = useLiquidityStore()

  const { wallet } = useWalletStore()
  const [mode, setMode] = useState<'add' | 'remove'>('add')

  const currentPools = pools.length > 0 ? pools : MOCK_POOLS

  const handleAddLiquidity = async () => {
    if (!selectedPool || !amount0 || !amount1) {
      alert('Please select a pool and enter amounts')
      return
    }

    await addLiquidity(selectedPool, amount0, amount1)
    setTimeout(() => resetForm(), 2000)
  }

  const handleRemoveLiquidity = async () => {
    if (!selectedPool || !amount0) {
      alert('Please select a pool and enter LP amount')
      return
    }

    await removeLiquidity(selectedPool, amount0)
    setTimeout(() => resetForm(), 2000)
  }

  return (
    <div className="liquidity-container">
      <div className="liquidity-content">
        <div className="pools-list">
          <h2>Liquidity Pools</h2>
          <div className="pools-grid">
            {currentPools.map((pool) => (
              <div
                key={pool.id}
                className={`pool-card ${selectedPool?.id === pool.id ? 'selected' : ''}`}
                onClick={() => setSelectedPool(pool)}
              >
                <div className="pool-header">
                  <span className="pool-pair">
                    {pool.token0.symbol}/{pool.token1.symbol}
                  </span>
                  <span className="pool-fee">{pool.feeTier / 10000}%</span>
                </div>
                <div className="pool-stats">
                  <div className="stat">
                    <span className="label">TVL</span>
                    <span className="value">${parseFloat(pool.tvl) / 1000000}M</span>
                  </div>
                  <div className="stat">
                    <span className="label">APR</span>
                    <span className="value highlight">{pool.apr}%</span>
                  </div>
                  <div className="stat">
                    <span className="label">24h Volume</span>
                    <span className="value">${parseFloat(pool.volume24h) / 1000000}M</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="liquidity-card">
          <div className="mode-switch">
            <button
              className={mode === 'add' ? 'active' : ''}
              onClick={() => {
                setMode('add')
                resetForm()
              }}
            >
              Add Liquidity
            </button>
            <button
              className={mode === 'remove' ? 'active' : ''}
              onClick={() => {
                setMode('remove')
                resetForm()
              }}
            >
              Remove Liquidity
            </button>
          </div>

          {!selectedPool ? (
            <div className="no-selection">
              <p>Select a pool to {mode === 'add' ? 'add' : 'remove'} liquidity</p>
            </div>
          ) : (
            <>
              <div className="pool-info">
                <h3>
                  {selectedPool.token0.symbol}/{selectedPool.token1.symbol}
                </h3>
                <p>APR: {selectedPool.apr}%</p>
                {userShare > 0 && <p>Your Share: {userShare.toFixed(2)}%</p>}
              </div>

              {mode === 'add' ? (
                <div className="liquidity-form">
                  <div className="form-group">
                    <label>
                      {selectedPool.token0.symbol}
                      <input
                        type="number"
                        placeholder="0.0"
                        value={amount0}
                        onChange={(e) => setAmount0(e.target.value)}
                      />
                    </label>
                    <small>Balance: 0.00</small>
                  </div>

                  <div className="plus-sign">+</div>

                  <div className="form-group">
                    <label>
                      {selectedPool.token1.symbol}
                      <input
                        type="number"
                        placeholder="0.0"
                        value={amount1}
                        onChange={(e) => setAmount1(e.target.value)}
                      />
                    </label>
                    <small>Balance: 0.00</small>
                  </div>

                  {transactionState.status === 'success' && (
                    <div className="success-message">
                      Liquidity added successfully!
                    </div>
                  )}

                  <button
                    className="action-button"
                    onClick={handleAddLiquidity}
                    disabled={transactionState.status === 'pending'}
                  >
                    {transactionState.status === 'pending'
                      ? 'Adding...'
                      : 'Add Liquidity'}
                  </button>
                </div>
              ) : (
                <div className="liquidity-form">
                  <div className="form-group">
                    <label>
                      LP Tokens to Remove
                      <input
                        type="number"
                        placeholder="0.0"
                        value={amount0}
                        onChange={(e) => setAmount0(e.target.value)}
                      />
                    </label>
                    <small>Your LP Balance: 0.00</small>
                  </div>

                  <div className="removal-preview">
                    <p>You will receive:</p>
                    <div className="preview-item">
                      {selectedPool.token0.symbol}: {(parseFloat(amount0 || '0') * 0.5).toFixed(6)}
                    </div>
                    <div className="preview-item">
                      {selectedPool.token1.symbol}: {(parseFloat(amount0 || '0') * 0.5).toFixed(6)}
                    </div>
                  </div>

                  {transactionState.status === 'success' && (
                    <div className="success-message">
                      Liquidity removed successfully!
                    </div>
                  )}

                  <button
                    className="action-button danger"
                    onClick={handleRemoveLiquidity}
                    disabled={transactionState.status === 'pending'}
                  >
                    {transactionState.status === 'pending'
                      ? 'Removing...'
                      : 'Remove Liquidity'}
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
