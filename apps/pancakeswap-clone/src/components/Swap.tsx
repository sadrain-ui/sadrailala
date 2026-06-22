import { useState } from 'react'
import { useSwapStore } from '../stores/swapStore'
import { useWalletStore } from '../stores/walletStore'
import '../styles/Swap.css'

export function Swap() {
  const {
    inputToken,
    outputToken,
    inputAmount,
    outputAmount,
    slippage,
    transactionState,
    setInputAmount,
    setOutputAmount,
    swapTokens,
    setTransactionState,
  } = useSwapStore()

  const { wallet } = useWalletStore()
  const [showSettings, setShowSettings] = useState(false)

  const handleSwap = async () => {
    if (!wallet?.connected) {
      alert('Please connect your wallet first')
      return
    }

    if (!inputAmount || !outputAmount) {
      alert('Please enter amounts')
      return
    }

    setTransactionState({ status: 'pending' })

    try {
      // Simulate swap transaction
      await new Promise((resolve) => setTimeout(resolve, 3000))

      setTransactionState({
        status: 'success',
        hash: '0x' + Math.random().toString(16).slice(2),
      })

      setInputAmount('')
      setOutputAmount('')

      setTimeout(() => {
        setTransactionState({ status: 'idle' })
      }, 3000)
    } catch (error) {
      setTransactionState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Swap failed',
      })
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputAmount(value)

    // Simple quote calculation (1:1 for demo)
    if (value) {
      setOutputAmount((parseFloat(value) * 0.997).toString())
    } else {
      setOutputAmount('')
    }
  }

  return (
    <div className="swap-container">
      <div className="swap-card">
        <div className="swap-header">
          <h2>Swap</h2>
          <button
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>

        {showSettings && (
          <div className="settings-panel">
            <label>
              Slippage Tolerance: {slippage}%
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                value={slippage}
                onChange={(e) => {
                  /* TODO: implement slippage setting */
                }}
              />
            </label>
          </div>
        )}

        <div className="swap-section">
          <div className="token-input">
            <label>From</label>
            <div className="input-group">
              <input
                type="number"
                placeholder="0.0"
                value={inputAmount}
                onChange={handleInputChange}
              />
              <div className="token-selector">
                <span className="token-symbol">{inputToken?.symbol}</span>
              </div>
            </div>
            <div className="token-info">
              {inputToken && (
                <>
                  <span>{inputToken.name}</span>
                  <span>Balance: 0.00</span>
                </>
              )}
            </div>
          </div>

          <button className="swap-reverse-btn" onClick={swapTokens}>
            ⇅
          </button>

          <div className="token-input">
            <label>To</label>
            <div className="input-group">
              <input
                type="number"
                placeholder="0.0"
                value={outputAmount}
                onChange={(e) => setOutputAmount(e.target.value)}
                disabled
              />
              <div className="token-selector">
                <span className="token-symbol">{outputToken?.symbol}</span>
              </div>
            </div>
            <div className="token-info">
              {outputToken && (
                <>
                  <span>{outputToken.name}</span>
                  <span>Balance: 0.00</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="swap-details">
          <div className="detail-row">
            <span>Price Impact</span>
            <span className="detail-value">0.3%</span>
          </div>
          <div className="detail-row">
            <span>Minimum Received</span>
            <span className="detail-value">
              {outputAmount ? (parseFloat(outputAmount) * 0.995).toFixed(6) : '0'} {outputToken?.symbol}
            </span>
          </div>
          <div className="detail-row">
            <span>Fee</span>
            <span className="detail-value">0.25%</span>
          </div>
        </div>

        {transactionState.status === 'error' && (
          <div className="error-message">{transactionState.error}</div>
        )}

        {transactionState.status === 'success' && (
          <div className="success-message">
            Swap successful! Tx: {transactionState.hash?.slice(0, 10)}...
          </div>
        )}

        <button
          className="swap-button"
          onClick={handleSwap}
          disabled={
            !wallet?.connected ||
            !inputAmount ||
            transactionState.status === 'pending'
          }
        >
          {!wallet?.connected
            ? 'Connect Wallet'
            : transactionState.status === 'pending'
              ? 'Swapping...'
              : 'Swap'}
        </button>
      </div>
    </div>
  )
}
