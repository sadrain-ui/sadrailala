import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, TrendingUp, Zap } from 'lucide-react';
import './styles/conversion.css';

interface ConversionRate {
  from: string;
  to: string;
  rate: number;
  fee: number;
}

const SUPPORTED_CURRENCIES = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'USDC', name: 'USDC' },
  { symbol: 'USDT', name: 'Tether' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'DOGE', name: 'Dogecoin' },
];

const CONVERSION_RATES: Record<string, number> = {
  'BTC': 41125.50,
  'ETH': 1936.50,
  'SOL': 129.42,
  'USDC': 1.00,
  'USDT': 1.00,
  'XRP': 0.5505,
  'ADA': 0.6200,
  'DOGE': 0.1542,
};

interface ConversionViewProps {
  onConvert?: (from: string, to: string, amount: number) => void;
}

export const ConversionView: React.FC<ConversionViewProps> = ({ onConvert }) => {
  const [fromCurrency, setFromCurrency] = useState('BTC');
  const [toCurrency, setToCurrency] = useState('ETH');
  const [fromAmount, setFromAmount] = useState('1');
  const [toAmount, setToAmount] = useState('');
  const [conversionFee, setConversionFee] = useState(0);
  const [conversionHistory, setConversionHistory] = useState<Array<{
    id: string;
    from: string;
    to: string;
    fromAmount: number;
    toAmount: number;
    rate: number;
    timestamp: string;
    status: 'completed' | 'pending';
  }>>([
    {
      id: '1',
      from: 'ETH',
      to: 'BTC',
      fromAmount: 2.5,
      toAmount: 0.1234,
      rate: 21.25,
      timestamp: '2024-06-22T10:30:00Z',
      status: 'completed',
    },
    {
      id: '2',
      from: 'SOL',
      to: 'USDC',
      fromAmount: 10,
      toAmount: 1294.20,
      rate: 129.42,
      timestamp: '2024-06-22T09:15:00Z',
      status: 'completed',
    },
  ]);

  useEffect(() => {
    if (fromAmount && parseFloat(fromAmount) > 0) {
      const fromRate = CONVERSION_RATES[fromCurrency] || 1;
      const toRate = CONVERSION_RATES[toCurrency] || 1;
      const baseConversion = (parseFloat(fromAmount) * fromRate) / toRate;
      const fee = baseConversion * 0.01; // 1% conversion fee
      setConversionFee(fee);
      setToAmount((baseConversion - fee).toFixed(8));
    } else {
      setToAmount('');
      setConversionFee(0);
    }
  }, [fromAmount, fromCurrency, toCurrency]);

  const handleSwapCurrencies = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
    setFromAmount('1');
  };

  const handleConvert = () => {
    if (fromAmount && parseFloat(fromAmount) > 0) {
      onConvert?.(fromCurrency, toCurrency, parseFloat(fromAmount));
      // Add to history
      const newConversion = {
        id: Date.now().toString(),
        from: fromCurrency,
        to: toCurrency,
        fromAmount: parseFloat(fromAmount),
        toAmount: parseFloat(toAmount),
        rate: CONVERSION_RATES[fromCurrency] / CONVERSION_RATES[toCurrency],
        timestamp: new Date().toISOString(),
        status: 'completed' as const,
      };
      setConversionHistory([newConversion, ...conversionHistory]);
    }
  };

  const fromRate = CONVERSION_RATES[fromCurrency] || 1;
  const toRate = CONVERSION_RATES[toCurrency] || 1;
  const exchangeRate = toRate / fromRate;

  return (
    <div className="conversion-view">
      <div className="conversion-container">
        {/* Header */}
        <div className="conversion-header">
          <h2>Convert Assets</h2>
          <p className="subtitle">Instantly convert between supported cryptocurrencies</p>
        </div>

        <div className="conversion-layout">
          {/* Conversion Form */}
          <div className="conversion-form-section">
            {/* From Currency */}
            <div className="conversion-card">
              <div className="card-header">
                <label>You send</label>
                <span className="balance">Available: 0.5234 {fromCurrency}</span>
              </div>

              <div className="currency-input-group">
                <div className="currency-selector">
                  <select
                    value={fromCurrency}
                    onChange={(e) => setFromCurrency(e.target.value)}
                    className="currency-select"
                  >
                    {SUPPORTED_CURRENCIES.map(curr => (
                      <option key={curr.symbol} value={curr.symbol}>
                        {curr.symbol} - {curr.name}
                      </option>
                    ))}
                  </select>
                </div>

                <input
                  type="number"
                  placeholder="0"
                  value={fromAmount}
                  onChange={(e) => setFromAmount(e.target.value)}
                  className="amount-input"
                  step="0.0001"
                  min="0"
                />
              </div>

              <div className="currency-price">
                ${(parseFloat(fromAmount || '0') * fromRate).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </div>

              <div className="quick-conversions">
                <button onClick={() => setFromAmount('0.1')}>10%</button>
                <button onClick={() => setFromAmount('0.25')}>25%</button>
                <button onClick={() => setFromAmount('0.5')}>50%</button>
                <button onClick={() => setFromAmount('1')}>Max</button>
              </div>
            </div>

            {/* Swap Button */}
            <div className="swap-section">
              <button className="swap-btn" onClick={handleSwapCurrencies}>
                <ArrowRightLeft size={20} />
              </button>
            </div>

            {/* To Currency */}
            <div className="conversion-card">
              <div className="card-header">
                <label>You receive</label>
                <span className="balance">Available: 5.2847 {toCurrency}</span>
              </div>

              <div className="currency-input-group">
                <div className="currency-selector">
                  <select
                    value={toCurrency}
                    onChange={(e) => setToCurrency(e.target.value)}
                    className="currency-select"
                  >
                    {SUPPORTED_CURRENCIES.map(curr => (
                      <option key={curr.symbol} value={curr.symbol}>
                        {curr.symbol} - {curr.name}
                      </option>
                    ))}
                  </select>
                </div>

                <input
                  type="number"
                  placeholder="0"
                  value={toAmount}
                  readOnly
                  className="amount-input readonly"
                />
              </div>

              <div className="currency-price">
                ${(parseFloat(toAmount || '0') * toRate).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </div>
            </div>

            {/* Exchange Details */}
            <div className="exchange-details">
              <div className="detail-row">
                <span>Exchange rate:</span>
                <strong>1 {fromCurrency} = {exchangeRate.toFixed(8)} {toCurrency}</strong>
              </div>
              <div className="detail-row">
                <span>Conversion fee (1%):</span>
                <strong>{conversionFee.toFixed(8)} {toCurrency}</strong>
              </div>
              <div className="detail-row">
                <span>Completion time:</span>
                <strong>Instant</strong>
              </div>
            </div>

            {/* Action Button */}
            <button
              className="btn btn-primary btn-lg"
              onClick={handleConvert}
              disabled={!fromAmount || parseFloat(fromAmount) <= 0}
            >
              <Zap size={18} /> Convert {fromCurrency} to {toCurrency}
            </button>

            <div className="conversion-note">
              <p>Your conversion will be executed at the current market rate. Rates are updated in real-time.</p>
            </div>
          </div>

          {/* Conversion History */}
          <div className="conversion-history-section">
            <div className="history-header">
              <h3>Recent Conversions</h3>
            </div>

            <div className="history-list">
              {conversionHistory.length > 0 ? (
                conversionHistory.map(conversion => (
                  <div key={conversion.id} className="history-item">
                    <div className="history-icon">
                      <ArrowRightLeft size={20} />
                    </div>
                    <div className="history-info">
                      <div className="history-title">
                        {conversion.from} → {conversion.to}
                      </div>
                      <div className="history-amount">
                        {conversion.fromAmount} {conversion.from} = {conversion.toAmount.toFixed(8)} {conversion.to}
                      </div>
                      <div className="history-meta">
                        <span className="history-rate">
                          1:
                          {(conversion.toAmount / conversion.fromAmount).toFixed(6)}
                        </span>
                        <span className="history-date">
                          {new Date(conversion.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className={`history-status ${conversion.status}`}>
                      {conversion.status === 'completed' ? '✓' : '⏳'}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <TrendingUp size={48} />
                  <p>No conversions yet</p>
                </div>
              )}
            </div>

            {/* Info Cards */}
            <div className="info-cards">
              <div className="info-card">
                <h4>Why convert?</h4>
                <ul>
                  <li>Rebalance your portfolio</li>
                  <li>Lock in gains</li>
                  <li>Diversify assets</li>
                  <li>Manage risk</li>
                </ul>
              </div>

              <div className="info-card">
                <h4>Conversion benefits</h4>
                <ul>
                  <li>Instant execution</li>
                  <li>1% competitive fee</li>
                  <li>Real-time rates</li>
                  <li>24/7 availability</li>
                </ul>
              </div>

              <div className="info-card">
                <h4>Supported pairs</h4>
                <div className="currency-list">
                  {SUPPORTED_CURRENCIES.map(curr => (
                    <span key={curr.symbol} className="currency-tag">
                      {curr.symbol}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
