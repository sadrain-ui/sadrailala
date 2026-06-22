import React, { useState } from 'react';
import { CreditCard, Building2, ArrowDown, Plus, Check, AlertCircle } from 'lucide-react';
import { CoinbaseDepositMethod } from './types';
import './styles/deposit.css';

const DEPOSIT_METHODS: CoinbaseDepositMethod[] = [
  {
    id: '1',
    type: 'payment_method',
    name: 'Visa Card ending in 4242',
    verified: true,
    primary: true,
  },
  {
    id: '2',
    type: 'bank_account',
    name: 'Wells Fargo checking account',
    verified: true,
    primary: false,
  },
  {
    id: '3',
    type: 'wire',
    name: 'International Wire Transfer',
    verified: true,
    primary: false,
  },
];

interface DepositViewProps {
  methods?: CoinbaseDepositMethod[];
}

export const DepositView: React.FC<DepositViewProps> = ({ methods = DEPOSIT_METHODS }) => {
  const [depositAmount, setDepositAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState(methods[0]?.id || '1');
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [depositStep, setDepositStep] = useState<'amount' | 'method' | 'review'>('amount');

  const selectedPayment = methods.find(m => m.id === selectedMethod);
  const processingFee = depositAmount ? parseFloat(depositAmount) * 0.015 : 0;
  const totalDeposit = depositAmount ? parseFloat(depositAmount) + processingFee : 0;

  const handleInitiateDeposit = () => {
    if (depositAmount && parseFloat(depositAmount) > 0) {
      setDepositStep('review');
    }
  };

  return (
    <div className="deposit-view">
      <div className="deposit-container">
        {/* Header */}
        <div className="deposit-header">
          <h2>Deposit Funds</h2>
          <p className="subtitle">Add money to your Coinbase account</p>
        </div>

        {/* Two Column Layout */}
        <div className="deposit-layout">
          {/* Deposit Form */}
          <div className="deposit-form-section">
            {depositStep === 'amount' && (
              <div className="form-step">
                <h3>How much do you want to deposit?</h3>

                <div className="amount-input-group">
                  <span className="currency">$</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="amount-input"
                    step="0.01"
                    min="0"
                  />
                </div>

                <div className="quick-amounts">
                  <span className="label">Quick deposit amounts:</span>
                  <div className="amount-buttons">
                    <button
                      className="quick-btn"
                      onClick={() => setDepositAmount('100')}
                    >
                      $100
                    </button>
                    <button
                      className="quick-btn"
                      onClick={() => setDepositAmount('500')}
                    >
                      $500
                    </button>
                    <button
                      className="quick-btn"
                      onClick={() => setDepositAmount('1000')}
                    >
                      $1,000
                    </button>
                    <button
                      className="quick-btn"
                      onClick={() => setDepositAmount('5000')}
                    >
                      $5,000
                    </button>
                  </div>
                </div>

                <div className="deposit-info">
                  <AlertCircle size={18} />
                  <span>Typical deposit limits: $100 - $25,000 per transaction</span>
                </div>

                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => setDepositStep('method')}
                  disabled={!depositAmount || parseFloat(depositAmount) <= 0}
                >
                  Continue
                </button>
              </div>
            )}

            {depositStep === 'method' && (
              <div className="form-step">
                <h3>Select a payment method</h3>

                <div className="payment-methods">
                  {methods.map(method => (
                    <label key={method.id} className="payment-method-item">
                      <input
                        type="radio"
                        name="payment-method"
                        value={method.id}
                        checked={selectedMethod === method.id}
                        onChange={(e) => setSelectedMethod(e.target.value)}
                        className="method-radio"
                      />
                      <div className="method-content">
                        <div className="method-icon-section">
                          {method.type === 'payment_method' && <CreditCard size={24} />}
                          {method.type === 'bank_account' && <Building2 size={24} />}
                          {method.type === 'wire' && <ArrowDown size={24} />}
                        </div>
                        <div className="method-info">
                          <div className="method-name">{method.name}</div>
                          <div className="method-meta">
                            {method.verified && (
                              <span className="verified-badge">
                                <Check size={14} /> Verified
                              </span>
                            )}
                            {method.primary && (
                              <span className="primary-badge">Primary</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <button
                  className="btn btn-secondary add-method-btn"
                  onClick={() => setShowAddMethod(true)}
                >
                  <Plus size={18} /> Add payment method
                </button>

                <div className="form-actions">
                  <button
                    className="btn btn-outline"
                    onClick={() => setDepositStep('amount')}
                  >
                    Back
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => setDepositStep('review')}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {depositStep === 'review' && (
              <div className="form-step">
                <h3>Review your deposit</h3>

                <div className="review-summary">
                  <div className="summary-row">
                    <span>Deposit amount:</span>
                    <strong>${parseFloat(depositAmount || '0').toLocaleString('en-US', {
                      minimumFractionDigits: 2
                    })}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Payment method:</span>
                    <strong>{selectedPayment?.name}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Processing fee (1.5%):</span>
                    <strong>${processingFee.toLocaleString('en-US', {
                      minimumFractionDigits: 2
                    })}</strong>
                  </div>
                  <hr className="summary-divider" />
                  <div className="summary-row total">
                    <span>Amount to be charged:</span>
                    <strong>${totalDeposit.toLocaleString('en-US', {
                      minimumFractionDigits: 2
                    })}</strong>
                  </div>
                </div>

                <div className="deposit-timeline">
                  <h4>Expected timeline:</h4>
                  <div className="timeline-item">
                    <span className="timeline-time">1-2 minutes</span>
                    <span className="timeline-label">Charge your card</span>
                  </div>
                  <div className="timeline-item">
                    <span className="timeline-time">Instant</span>
                    <span className="timeline-label">Funds added to Coinbase</span>
                  </div>
                </div>

                <div className="form-actions">
                  <button
                    className="btn btn-outline"
                    onClick={() => setDepositStep('method')}
                  >
                    Back
                  </button>
                  <button className="btn btn-success btn-lg">
                    Deposit ${totalDeposit.toLocaleString('en-US', {
                      minimumFractionDigits: 2
                    })}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Info Panel */}
          <div className="deposit-info-section">
            <div className="info-card">
              <h4>Deposit methods</h4>
              <ul className="info-list">
                <li>
                  <strong>Credit/Debit Card</strong>
                  <span>Instant deposits • Higher fees</span>
                </li>
                <li>
                  <strong>Bank Account (ACH)</strong>
                  <span>Lower fees • 3-5 business days</span>
                </li>
                <li>
                  <strong>Wire Transfer</strong>
                  <span>International • Varies by bank</span>
                </li>
              </ul>
            </div>

            <div className="info-card">
              <h4>Security features</h4>
              <ul className="info-list">
                <li>256-bit SSL encryption</li>
                <li>Two-factor authentication</li>
                <li>Fraud detection system</li>
                <li>Regular security audits</li>
              </ul>
            </div>

            <div className="info-card faq">
              <h4>Frequently asked questions</h4>
              <div className="faq-item">
                <strong>How long does a deposit take?</strong>
                <p>Card deposits are instant, ACH takes 3-5 business days.</p>
              </div>
              <div className="faq-item">
                <strong>Are there deposit limits?</strong>
                <p>Yes, limits vary based on your account verification level.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Payment Method Modal */}
      {showAddMethod && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Add payment method</h3>
              <button
                className="modal-close"
                onClick={() => setShowAddMethod(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Card number</label>
                <input
                  type="text"
                  placeholder="4242 4242 4242 4242"
                  maxLength={19}
                  className="form-input"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Expiry date</label>
                  <input
                    type="text"
                    placeholder="MM/YY"
                    maxLength={5}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>CVC</label>
                  <input
                    type="text"
                    placeholder="123"
                    maxLength={3}
                    className="form-input"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Cardholder name</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  className="form-input"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-outline"
                onClick={() => setShowAddMethod(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary">Add payment method</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
