import { useState } from 'react'
import type { Deposit, Withdrawal } from '../types/trading'

interface WalletManagerProps {
  onClose?: () => void
}

export function WalletManager({ onClose }: WalletManagerProps) {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'history'>('deposit')
  const [selectedAsset, setSelectedAsset] = useState('BTC')
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const supportedAssets = [
    { name: 'Bitcoin', symbol: 'BTC', chain: 'Bitcoin' },
    { name: 'Ethereum', symbol: 'ETH', chain: 'Ethereum' },
    { name: 'Binance Coin', symbol: 'BNB', chain: 'Binance Smart Chain' },
    { name: 'Solana', symbol: 'SOL', chain: 'Solana' },
    { name: 'Tether', symbol: 'USDT', chain: 'Multiple' },
    { name: 'Cardano', symbol: 'ADA', chain: 'Cardano' },
  ]

  const deposits: Deposit[] = [
    {
      id: 'DEP-001',
      asset: 'BTC',
      amount: 0.5,
      address: '1A1z7agoat2LWQLRZUC....',
      txHash: '0x123456789abcdef',
      confirmations: 6,
      requiredConfirmations: 6,
      status: 'CONFIRMED',
      createdAt: new Date(Date.now() - 86400000),
      updatedAt: new Date(Date.now() - 86400000),
    },
    {
      id: 'DEP-002',
      asset: 'ETH',
      amount: 10.0,
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f....',
      txHash: '0x987654321fedcba',
      confirmations: 12,
      requiredConfirmations: 12,
      status: 'CONFIRMED',
      createdAt: new Date(Date.now() - 172800000),
      updatedAt: new Date(Date.now() - 172800000),
    },
    {
      id: 'DEP-003',
      asset: 'USDT',
      amount: 5000.0,
      address: '0x8d09A5a75a9F8af0....',
      txHash: '0x456789abcdef123',
      confirmations: 3,
      requiredConfirmations: 12,
      status: 'PENDING',
      createdAt: new Date(Date.now() - 3600000),
      updatedAt: new Date(Date.now() - 3600000),
    },
  ]

  const withdrawals: Withdrawal[] = [
    {
      id: 'WTH-001',
      asset: 'BTC',
      amount: 0.1,
      address: '1A1z7agoat2LWQLRZUC....',
      fee: 0.0005,
      txHash: '0xabcdef123456789',
      status: 'COMPLETED',
      createdAt: new Date(Date.now() - 259200000),
      updatedAt: new Date(Date.now() - 259200000),
    },
    {
      id: 'WTH-002',
      asset: 'ETH',
      amount: 5.0,
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f....',
      fee: 0.01,
      txHash: '0xfedcba987654321',
      status: 'COMPLETED',
      createdAt: new Date(Date.now() - 432000000),
      updatedAt: new Date(Date.now() - 432000000),
    },
    {
      id: 'WTH-003',
      asset: 'USDT',
      amount: 1000.0,
      address: '0x8d09A5a75a9F8af0....',
      fee: 1.0,
      txHash: '0x123456789abcdef',
      status: 'PROCESSING',
      createdAt: new Date(Date.now() - 7200000),
      updatedAt: new Date(Date.now() - 3600000),
    },
  ]

  async function handleDepositSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !address) {
      setResult({ success: false, message: 'Please fill in all fields' })
      return
    }

    setIsProcessing(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      setResult({
        success: true,
        message: `Deposit request initiated. Awaiting ${amount} ${selectedAsset} to ${address.substring(0, 10)}...`,
      })
      setAmount('')
      setAddress('')
      setTimeout(() => setResult(null), 5000)
    } catch (error) {
      setResult({ success: false, message: 'Failed to process deposit' })
    } finally {
      setIsProcessing(false)
    }
  }

  async function handleWithdrawSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !address) {
      setResult({ success: false, message: 'Please fill in all fields' })
      return
    }

    setIsProcessing(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      setResult({
        success: true,
        message: `Withdrawal initiated. ${amount} ${selectedAsset} will be sent to ${address.substring(0, 10)}...`,
      })
      setAmount('')
      setAddress('')
      setTimeout(() => setResult(null), 5000)
    } catch (error) {
      setResult({ success: false, message: 'Failed to process withdrawal' })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="wallet-manager">
      <div className="wallet-header">
        <h1>Wallet Manager</h1>
        {onClose && (
          <button className="btn-close" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      <div className="wallet-content">
        {/* Tab Navigation */}
        <div className="wallet-tabs">
          <button
            className={`tab-btn ${activeTab === 'deposit' ? 'active' : ''}`}
            onClick={() => setActiveTab('deposit')}
          >
            Deposit
          </button>
          <button
            className={`tab-btn ${activeTab === 'withdraw' ? 'active' : ''}`}
            onClick={() => setActiveTab('withdraw')}
          >
            Withdraw
          </button>
          <button
            className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
        </div>

        {/* Deposit Tab */}
        {activeTab === 'deposit' && (
          <div className="tab-content">
            <form onSubmit={handleDepositSubmit}>
              <div className="form-section">
                <h2>Deposit Crypto</h2>
                <p className="form-help">Send crypto from your wallet to the address below</p>

                <div className="form-group">
                  <label>Select Asset</label>
                  <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)}>
                    {supportedAssets.map((asset) => (
                      <option key={asset.symbol} value={asset.symbol}>
                        {asset.name} ({asset.symbol}) - {asset.chain}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Deposit Address */}
                <div className="address-box">
                  <div className="address-label">Your {selectedAsset} Deposit Address</div>
                  <div className="address-display">
                    <code>1A1z7agoat2LWQLRZUCRG6FwA3rLqcMb3V</code>
                    <button type="button" className="btn-copy" title="Copy address">
                      📋
                    </button>
                  </div>
                  <div className="address-warning">
                    Send only {selectedAsset} to this address. Sending other assets will result in permanent loss.
                  </div>
                </div>

                <div className="form-group">
                  <label>Amount to Deposit</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`0.00 ${selectedAsset}`}
                    step="0.00001"
                    disabled={isProcessing}
                  />
                </div>

                {result && (
                  <div className={`form-result ${result.success ? 'success' : 'error'}`}>
                    {result.message}
                  </div>
                )}

                <button type="submit" className="btn btn-primary" disabled={isProcessing}>
                  {isProcessing ? 'Processing...' : 'Confirm Deposit'}
                </button>
              </div>
            </form>

            {/* Recent Deposits */}
            <div className="recent-section">
              <h3>Recent Deposits</h3>
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Confirmations</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((dep) => (
                    <tr key={dep.id}>
                      <td>{dep.asset}</td>
                      <td>{dep.amount.toFixed(4)}</td>
                      <td className={`status status-${dep.status.toLowerCase()}`}>
                        {dep.status === 'CONFIRMED' ? '✓' : '⏱'} {dep.status}
                      </td>
                      <td>
                        {dep.confirmations}/{dep.requiredConfirmations}
                      </td>
                      <td>{dep.createdAt.toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Withdraw Tab */}
        {activeTab === 'withdraw' && (
          <div className="tab-content">
            <form onSubmit={handleWithdrawSubmit}>
              <div className="form-section">
                <h2>Withdraw Crypto</h2>
                <p className="form-help">Withdraw crypto to an external wallet</p>

                <div className="form-group">
                  <label>Select Asset</label>
                  <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)}>
                    {supportedAssets.map((asset) => (
                      <option key={asset.symbol} value={asset.symbol}>
                        {asset.name} ({asset.symbol})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Recipient Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter recipient wallet address"
                    disabled={isProcessing}
                  />
                </div>

                <div className="form-group">
                  <label>Withdrawal Amount</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`0.00 ${selectedAsset}`}
                    step="0.00001"
                    disabled={isProcessing}
                  />
                </div>

                <div className="withdrawal-fee">
                  <div className="fee-row">
                    <span>Network Fee:</span>
                    <span>0.0005 {selectedAsset}</span>
                  </div>
                  <div className="fee-row">
                    <span>You will receive:</span>
                    <strong>
                      {(parseFloat(amount) - 0.0005).toFixed(4)} {selectedAsset}
                    </strong>
                  </div>
                </div>

                {result && (
                  <div className={`form-result ${result.success ? 'success' : 'error'}`}>
                    {result.message}
                  </div>
                )}

                <button type="submit" className="btn btn-danger" disabled={isProcessing}>
                  {isProcessing ? 'Processing...' : 'Confirm Withdrawal'}
                </button>
              </div>
            </form>

            {/* Recent Withdrawals */}
            <div className="recent-section">
              <h3>Recent Withdrawals</h3>
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Amount</th>
                    <th>Fee</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((wtd) => (
                    <tr key={wtd.id}>
                      <td>{wtd.asset}</td>
                      <td>{wtd.amount.toFixed(4)}</td>
                      <td>{wtd.fee.toFixed(6)}</td>
                      <td className={`status status-${wtd.status.toLowerCase()}`}>
                        {wtd.status === 'COMPLETED' ? '✓' : '⏱'} {wtd.status}
                      </td>
                      <td>{wtd.createdAt.toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="tab-content">
            <div className="history-section">
              <h2>Transaction History</h2>

              <div className="history-tabs">
                <button className="history-tab-btn active">All Transactions</button>
                <button className="history-tab-btn">Deposits</button>
                <button className="history-tab-btn">Withdrawals</button>
              </div>

              <table className="full-history-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Asset</th>
                    <th>Amount</th>
                    <th>Fee</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((dep) => (
                    <tr key={dep.id}>
                      <td className="id">{dep.id}</td>
                      <td className="type">
                        <span className="badge deposit">Deposit</span>
                      </td>
                      <td>{dep.asset}</td>
                      <td className="positive">+{dep.amount.toFixed(4)}</td>
                      <td>0</td>
                      <td className={`status status-${dep.status.toLowerCase()}`}>{dep.status}</td>
                      <td>{dep.createdAt.toLocaleDateString()}</td>
                      <td>
                        <button className="btn-small">View</button>
                      </td>
                    </tr>
                  ))}
                  {withdrawals.map((wtd) => (
                    <tr key={wtd.id}>
                      <td className="id">{wtd.id}</td>
                      <td className="type">
                        <span className="badge withdrawal">Withdrawal</span>
                      </td>
                      <td>{wtd.asset}</td>
                      <td className="negative">-{wtd.amount.toFixed(4)}</td>
                      <td>{wtd.fee.toFixed(6)}</td>
                      <td className={`status status-${wtd.status.toLowerCase()}`}>{wtd.status}</td>
                      <td>{wtd.createdAt.toLocaleDateString()}</td>
                      <td>
                        <button className="btn-small">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
