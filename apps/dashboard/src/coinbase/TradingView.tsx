import React, { useState } from 'react';
import { Plus, Minus, TrendingUp, Settings2 } from 'lucide-react';
import { CoinbaseOrder, CoinbasePrice } from './types';
import './styles/trading.css';

interface TradingViewProps {
  onBuy?: (amount: number, productId: string) => void;
  onSell?: (amount: number, productId: string) => void;
}

const MARKET_DATA: CoinbasePrice[] = [
  {
    currency: 'BTC',
    price: 41125.50,
    change24h: 2.45,
    changePercent24h: 2.45,
    high24h: 42500,
    low24h: 39800,
    volume24h: 28500000000,
  },
  {
    currency: 'ETH',
    price: 1936.50,
    change24h: 1.23,
    changePercent24h: 1.23,
    high24h: 2050,
    low24h: 1890,
    volume24h: 15200000000,
  },
  {
    currency: 'SOL',
    price: 129.42,
    change24h: -0.87,
    changePercent24h: -0.87,
    high24h: 135.20,
    low24h: 127.50,
    volume24h: 2300000000,
  },
];

const RECENT_ORDERS: CoinbaseOrder[] = [
  {
    id: '1',
    side: 'buy',
    productId: 'BTC-USD',
    orderType: 'market',
    amount: 0.5234,
    status: 'done',
    createdAt: '2024-06-22T14:32:00Z',
    filledSize: 0.5234,
    executedValue: 21547.32,
  },
  {
    id: '2',
    side: 'sell',
    productId: 'ETH-USD',
    orderType: 'limit',
    price: 2000,
    amount: 1.5,
    status: 'open',
    createdAt: '2024-06-22T13:15:00Z',
    filledSize: 0,
    executedValue: 0,
  },
];

export const TradingView: React.FC<TradingViewProps> = ({ onBuy, onSell }) => {
  const [activeTab, setActiveTab] = useState<'buy' | 'sell' | 'market'>('market');
  const [selectedCurrency, setSelectedCurrency] = useState('BTC');
  const [amount, setAmount] = useState('1');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState('');

  const selectedPrice = MARKET_DATA.find(d => d.currency === selectedCurrency);
  const estimatedTotal = selectedPrice ? parseFloat(amount || '0') * selectedPrice.price : 0;

  const handleBuy = () => {
    if (amount && parseFloat(amount) > 0) {
      onBuy?.(parseFloat(amount), `${selectedCurrency}-USD`);
    }
  };

  const handleSell = () => {
    if (amount && parseFloat(amount) > 0) {
      onSell?.(parseFloat(amount), `${selectedCurrency}-USD`);
    }
  };

  return (
    <div className="trading-view">
      <div className="trading-container">
        {/* Trading Panel */}
        <div className="trading-panel">
          <div className="trading-tabs">
            <button
              className={`tab ${activeTab === 'buy' ? 'active' : ''}`}
              onClick={() => setActiveTab('buy')}
            >
              <Plus size={18} /> Buy
            </button>
            <button
              className={`tab ${activeTab === 'sell' ? 'active' : ''}`}
              onClick={() => setActiveTab('sell')}
            >
              <Minus size={18} /> Sell
            </button>
            <button
              className={`tab ${activeTab === 'market' ? 'active' : ''}`}
              onClick={() => setActiveTab('market')}
            >
              <TrendingUp size={18} /> Market
            </button>
          </div>

          {/* Buy/Sell Form */}
          {(activeTab === 'buy' || activeTab === 'sell') && (
            <div className="trading-form">
              <div className="form-group">
                <label>Currency</label>
                <select
                  value={selectedCurrency}
                  onChange={(e) => setSelectedCurrency(e.target.value)}
                  className="currency-select"
                >
                  {MARKET_DATA.map(data => (
                    <option key={data.currency} value={data.currency}>
                      {data.currency} - ${data.price.toLocaleString('en-US', {
                        minimumFractionDigits: 2
                      })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Amount</label>
                <div className="amount-input-group">
                  <input
                    type="number"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="amount-input"
                    step="0.0001"
                    min="0"
                  />
                  <span className="currency-label">{selectedCurrency}</span>
                </div>
              </div>

              <div className="form-group">
                <label>Order Type</label>
                <div className="order-type-group">
                  <button
                    className={`order-type-btn ${orderType === 'market' ? 'active' : ''}`}
                    onClick={() => setOrderType('market')}
                  >
                    Market Order
                  </button>
                  <button
                    className={`order-type-btn ${orderType === 'limit' ? 'active' : ''}`}
                    onClick={() => setOrderType('limit')}
                  >
                    Limit Order
                  </button>
                </div>
              </div>

              {orderType === 'limit' && (
                <div className="form-group">
                  <label>Limit Price</label>
                  <div className="price-input-group">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      className="price-input"
                      step="0.01"
                      min="0"
                    />
                    <span className="currency-label">USD</span>
                  </div>
                </div>
              )}

              <div className="order-summary">
                <div className="summary-row">
                  <span>Price per {selectedCurrency}:</span>
                  <strong>${selectedPrice?.price.toLocaleString('en-US', {
                    minimumFractionDigits: 2
                  })}</strong>
                </div>
                <div className="summary-row">
                  <span>Subtotal:</span>
                  <strong>${estimatedTotal.toLocaleString('en-US', {
                    minimumFractionDigits: 2
                  })}</strong>
                </div>
                <div className="summary-row">
                  <span>Coinbase Fee (1%):</span>
                  <strong>${(estimatedTotal * 0.01).toLocaleString('en-US', {
                    minimumFractionDigits: 2
                  })}</strong>
                </div>
                <hr className="summary-divider" />
                <div className="summary-row total">
                  <span>Total:</span>
                  <strong>${(estimatedTotal * 1.01).toLocaleString('en-US', {
                    minimumFractionDigits: 2
                  })}</strong>
                </div>
              </div>

              <button
                className={`btn btn-lg ${activeTab === 'buy' ? 'btn-success' : 'btn-danger'}`}
                onClick={activeTab === 'buy' ? handleBuy : handleSell}
              >
                {activeTab === 'buy' ? 'Buy' : 'Sell'} {selectedCurrency}
              </button>

              <div className="trading-disclaimer">
                <p>By placing an order, you agree to the Terms of Service and Privacy Policy.</p>
              </div>
            </div>
          )}

          {/* Market View */}
          {activeTab === 'market' && (
            <div className="market-view">
              <h3>Market Data</h3>
              <div className="market-grid">
                {MARKET_DATA.map(data => (
                  <div key={data.currency} className="market-card">
                    <div className="market-header">
                      <span className="market-symbol">{data.currency}</span>
                      <span className={`market-change ${data.changePercent24h >= 0 ? 'positive' : 'negative'}`}>
                        {data.changePercent24h >= 0 ? '+' : ''}{data.changePercent24h.toFixed(2)}%
                      </span>
                    </div>
                    <div className="market-price">
                      ${data.price.toLocaleString('en-US', {
                        minimumFractionDigits: 2
                      })}
                    </div>
                    <div className="market-stats">
                      <div className="stat">
                        <span className="stat-label">24h High</span>
                        <span>${data.high24h.toLocaleString('en-US', {
                          minimumFractionDigits: 2
                        })}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">24h Low</span>
                        <span>${data.low24h.toLocaleString('en-US', {
                          minimumFractionDigits: 2
                        })}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Orders Panel */}
        <div className="orders-panel">
          <div className="panel-header">
            <h3>Recent Orders</h3>
            <button className="settings-btn">
              <Settings2 size={18} />
            </button>
          </div>

          <div className="orders-list">
            {RECENT_ORDERS.map(order => (
              <div key={order.id} className="order-item">
                <div className="order-info">
                  <div className="order-title">
                    <span className={`order-type ${order.side}`}>
                      {order.side === 'buy' ? 'Buy' : 'Sell'} {order.productId}
                    </span>
                    <span className={`order-status ${order.status}`}>
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </span>
                  </div>
                  <div className="order-details">
                    <span>{order.amount} {order.productId.split('-')[0]}</span>
                    <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="order-value">
                  ${order.executedValue.toLocaleString('en-US', {
                    minimumFractionDigits: 2
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
