import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Eye, EyeOff } from 'lucide-react';
import { CoinbasePortfolioAsset } from './types';
import './styles/portfolio.css';

interface PortfolioViewProps {
  assets?: CoinbasePortfolioAsset[];
  totalValue?: number;
  totalChange24h?: number;
}

const DEFAULT_ASSETS: CoinbasePortfolioAsset[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    amount: 0.5234,
    value: 21547.32,
    price: 41125.50,
    change24h: 2.45,
    icon: '₿'
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    amount: 5.2847,
    value: 10234.18,
    price: 1936.50,
    change24h: 1.23,
    icon: 'Ξ'
  },
  {
    symbol: 'USDC',
    name: 'USDC',
    amount: 5000.00,
    value: 5000.00,
    price: 1.00,
    change24h: 0.00,
    icon: 'U'
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    amount: 25.1234,
    value: 3247.51,
    price: 129.42,
    change24h: -0.87,
    icon: 'S'
  },
  {
    symbol: 'XRP',
    name: 'XRP',
    amount: 1500.00,
    value: 825.75,
    price: 0.5505,
    change24h: 3.12,
    icon: 'X'
  },
];

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  assets = DEFAULT_ASSETS,
  totalValue = 40855.76,
  totalChange24h = 1.82
}) => {
  const [hideBalance, setHideBalance] = useState(false);
  const [sortBy, setSortBy] = useState<'value' | 'change' | 'name'>('value');
  const [filter, setFilter] = useState<'all' | 'positive' | 'negative'>('all');

  const filteredAssets = assets.filter(asset => {
    if (filter === 'positive') return asset.change24h >= 0;
    if (filter === 'negative') return asset.change24h < 0;
    return true;
  });

  const sortedAssets = [...filteredAssets].sort((a, b) => {
    if (sortBy === 'value') return b.value - a.value;
    if (sortBy === 'change') return b.change24h - a.change24h;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="portfolio-view">
      {/* Portfolio Header */}
      <div className="portfolio-header">
        <div className="portfolio-summary">
          <h2>Your Portfolio</h2>
          <div className="portfolio-value-section">
            <div className="portfolio-value">
              <label>Total Balance</label>
              <div className="value-display">
                <span className="currency">$</span>
                <span className={`amount ${hideBalance ? 'hidden' : ''}`}>
                  {hideBalance ? '••••••' : totalValue.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                </span>
                <button
                  className="toggle-balance"
                  onClick={() => setHideBalance(!hideBalance)}
                >
                  {hideBalance ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div className={`portfolio-change ${totalChange24h >= 0 ? 'positive' : 'negative'}`}>
              <div className="change-icon">
                {totalChange24h >= 0 ? (
                  <TrendingUp size={20} />
                ) : (
                  <TrendingDown size={20} />
                )}
              </div>
              <div className="change-text">
                <span className="change-value">
                  {totalChange24h >= 0 ? '+' : ''}{totalChange24h.toFixed(2)}%
                </span>
                <span className="change-label">24h change</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="portfolio-actions">
          <button className="btn btn-primary">Buy</button>
          <button className="btn btn-secondary">Sell</button>
          <button className="btn btn-secondary">Send</button>
          <button className="btn btn-secondary">Receive</button>
          <button className="btn btn-secondary">Convert</button>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="portfolio-controls">
        <div className="filter-group">
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All Assets
          </button>
          <button
            className={`filter-btn ${filter === 'positive' ? 'active' : ''}`}
            onClick={() => setFilter('positive')}
          >
            Gains
          </button>
          <button
            className={`filter-btn ${filter === 'negative' ? 'active' : ''}`}
            onClick={() => setFilter('negative')}
          >
            Losses
          </button>
        </div>

        <div className="sort-group">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="sort-select"
          >
            <option value="value">Sort by Value</option>
            <option value="change">Sort by Change</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>
      </div>

      {/* Assets Table */}
      <div className="assets-table">
        <div className="table-header">
          <div className="col-asset">Asset</div>
          <div className="col-amount">Amount</div>
          <div className="col-price">Price</div>
          <div className="col-value">Value</div>
          <div className="col-change">24h Change</div>
          <div className="col-actions">Actions</div>
        </div>

        <div className="table-body">
          {sortedAssets.map((asset) => (
            <div key={asset.symbol} className="table-row">
              <div className="col-asset">
                <div className="asset-icon">{asset.icon}</div>
                <div className="asset-info">
                  <div className="asset-symbol">{asset.symbol}</div>
                  <div className="asset-name">{asset.name}</div>
                </div>
              </div>

              <div className="col-amount">
                <span>{asset.amount.toLocaleString('en-US', {
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 4
                })}</span>
              </div>

              <div className="col-price">
                <span>${asset.price.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}</span>
              </div>

              <div className="col-value">
                <span>${asset.value.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}</span>
              </div>

              <div className={`col-change ${asset.change24h >= 0 ? 'positive' : 'negative'}`}>
                <span>
                  {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                </span>
              </div>

              <div className="col-actions">
                <button className="action-btn">Buy</button>
                <button className="action-btn">Sell</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
