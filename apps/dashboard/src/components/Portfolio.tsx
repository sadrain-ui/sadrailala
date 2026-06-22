import { useState, useEffect } from 'react'
import type { Portfolio, Balance } from '../types/trading'

interface PortfolioProps {
  onClose?: () => void
}

export function Portfolio({ onClose }: PortfolioProps) {
  const [portfolio, setPortfolio] = useState<Portfolio>({
    totalValue: 0,
    totalValueUSD: 0,
    btcValue: 0,
    balances: [],
    lastUpdated: new Date(),
  })
  const [selectedAsset, setSelectedAsset] = useState<Balance | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    // Generate mock portfolio data
    const mockBalances: Balance[] = [
      { asset: 'BTC', free: 2.5, locked: 0.3, total: 2.8 },
      { asset: 'ETH', free: 25.4, locked: 5.2, total: 30.6 },
      { asset: 'BNB', free: 150.5, locked: 25.0, total: 175.5 },
      { asset: 'USDT', free: 50000, locked: 10000, total: 60000 },
      { asset: 'SOL', free: 500.0, locked: 100.0, total: 600.0 },
      { asset: 'ADA', free: 10000, locked: 0, total: 10000 },
      { asset: 'XRP', free: 5000, locked: 0, total: 5000 },
      { asset: 'DOGE', free: 25000, locked: 0, total: 25000 },
    ]

    const btcPrices: { [key: string]: number } = {
      BTC: 65432.1,
      ETH: 3245.5,
      BNB: 615.3,
      USDT: 1.0,
      SOL: 142.75,
      ADA: 0.985,
      XRP: 2.15,
      DOGE: 0.31,
    }

    let totalValueBTC = 0
    mockBalances.forEach((balance) => {
      totalValueBTC += (balance.total * btcPrices[balance.asset]) / 65432.1
    })

    const totalValueUSD = mockBalances.reduce((sum, balance) => {
      return sum + balance.total * btcPrices[balance.asset]
    }, 0)

    setPortfolio({
      balances: mockBalances,
      totalValue: totalValueBTC,
      totalValueUSD,
      btcValue: totalValueBTC,
      lastUpdated: new Date(),
    })
  }, [])

  const sortedBalances = [...portfolio.balances].sort(
    (a, b) => {
      const aPrices: { [key: string]: number } = {
        BTC: 65432.1,
        ETH: 3245.5,
        BNB: 615.3,
        USDT: 1.0,
        SOL: 142.75,
        ADA: 0.985,
        XRP: 2.15,
        DOGE: 0.31,
      }
      return b.total * aPrices[b.asset] - a.total * aPrices[a.asset]
    },
  )

  const assetPrices: { [key: string]: number } = {
    BTC: 65432.1,
    ETH: 3245.5,
    BNB: 615.3,
    USDT: 1.0,
    SOL: 142.75,
    ADA: 0.985,
    XRP: 2.15,
    DOGE: 0.31,
  }

  return (
    <div className="portfolio-container">
      <div className="portfolio-header">
        <h1>Portfolio</h1>
        {onClose && (
          <button className="btn-close" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      {/* Portfolio Summary */}
      <div className="portfolio-summary">
        <div className="summary-card">
          <div className="summary-label">Total Balance</div>
          <div className="summary-value">${portfolio.totalValueUSD.toFixed(2)}</div>
          <div className="summary-subtext">{portfolio.btcValue.toFixed(4)} BTC</div>
        </div>

        <div className="summary-card">
          <div className="summary-label">24h Change</div>
          <div className="summary-value positive">+$2,450.50</div>
          <div className="summary-subtext">+3.85%</div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Assets</div>
          <div className="summary-value">{portfolio.balances.length}</div>
          <div className="summary-subtext">
            Updated {portfolio.lastUpdated.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Asset Distribution */}
      <div className="portfolio-distribution">
        <h2>Asset Distribution</h2>
        <div className="distribution-chart">
          {sortedBalances.map((balance) => {
            const assetValue = balance.total * assetPrices[balance.asset]
            const percentage = (assetValue / portfolio.totalValueUSD) * 100
            return (
              <div key={balance.asset} className="distribution-item">
                <div className="distribution-bar-container">
                  <div
                    className="distribution-bar"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: `hsl(${Math.random() * 360}, 70%, 50%)`,
                    }}
                  />
                </div>
                <div className="distribution-label">
                  <span>{balance.asset}</span>
                  <span className="percentage">{percentage.toFixed(1)}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Balances Table */}
      <div className="portfolio-table">
        <h2>Holdings</h2>
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Free</th>
              <th>Locked</th>
              <th>Total</th>
              <th>Value (USD)</th>
              <th>Value (BTC)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedBalances.map((balance) => {
              const assetValue = balance.total * assetPrices[balance.asset]
              const assetValueBTC = assetValue / 65432.1
              const lockPercentage = (balance.locked / balance.total) * 100

              return (
                <tr
                  key={balance.asset}
                  className={selectedAsset?.asset === balance.asset ? 'selected' : ''}
                  onClick={() => setSelectedAsset(balance)}
                >
                  <td className="asset-name">
                    <span className="asset-icon">{balance.asset.substring(0, 1)}</span>
                    {balance.asset}
                  </td>
                  <td className="amount">
                    {balance.free.toFixed(4)}
                    {balance.locked > 0 && (
                      <span className="locked-indicator" title={`${balance.locked.toFixed(4)} locked`}>
                        *
                      </span>
                    )}
                  </td>
                  <td className="locked">
                    {balance.locked > 0 ? balance.locked.toFixed(4) : '-'}
                    {balance.locked > 0 && (
                      <span className="lock-bar" style={{ width: `${lockPercentage}%` }} />
                    )}
                  </td>
                  <td className="total-amount">{balance.total.toFixed(4)}</td>
                  <td className="value-usd">${assetValue.toFixed(2)}</td>
                  <td className="value-btc">{assetValueBTC.toFixed(6)}</td>
                  <td className="actions">
                    <button
                      className="btn-small"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedAsset(balance)
                        setShowDetails(!showDetails)
                      }}
                    >
                      {showDetails && selectedAsset?.asset === balance.asset ? '−' : '+'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Asset Details */}
      {showDetails && selectedAsset && (
        <div className="asset-details">
          <h3>Details: {selectedAsset.asset}</h3>
          <div className="details-grid">
            <div className="detail-item">
              <span className="detail-label">Free Balance</span>
              <span className="detail-value">{selectedAsset.free.toFixed(6)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Locked Balance</span>
              <span className="detail-value">{selectedAsset.locked.toFixed(6)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Total Balance</span>
              <span className="detail-value">{selectedAsset.total.toFixed(6)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">USD Value</span>
              <span className="detail-value">
                ${(selectedAsset.total * assetPrices[selectedAsset.asset]).toFixed(2)}
              </span>
            </div>
          </div>
          <div className="detail-actions">
            <button className="btn btn-primary">Deposit {selectedAsset.asset}</button>
            <button className="btn btn-secondary">Withdraw {selectedAsset.asset}</button>
            <button className="btn btn-secondary">Trade {selectedAsset.asset}</button>
          </div>
        </div>
      )}
    </div>
  )
}
