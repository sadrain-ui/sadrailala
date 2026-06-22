import React, { useState, useEffect } from 'react';
import { StakingState, StakingTransaction } from './types';
import './StakingForm.css';

interface StakingFormProps {
  state: StakingState;
  onStake: (amount: number) => Promise<void>;
  onUnstake: (amount: number) => Promise<void>;
  onWithdraw: (requestId: string) => Promise<void>;
  onClaimRewards: () => Promise<void>;
}

export const StakingForm: React.FC<StakingFormProps> = ({
  state,
  onStake,
  onUnstake,
  onWithdraw,
  onClaimRewards,
}) => {
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'stake' | 'unstake' | 'rewards'>('stake');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<StakingTransaction | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'stake' | 'unstake' | 'rewards';
    amount?: number;
  } | null>(null);

  const handleStakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setStakeAmount(value);
    }
  };

  const handleUnstakeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setUnstakeAmount(value);
    }
  };

  const handleStakeClick = () => {
    const amount = parseFloat(stakeAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransactionStatus({
        id: 'error',
        type: 'stake',
        amount,
        timestamp: new Date(),
        status: 'failed',
      });
      return;
    }
    if (amount > state.ethBalance) {
      setTransactionStatus({
        id: 'error',
        type: 'stake',
        amount,
        timestamp: new Date(),
        status: 'failed',
      });
      return;
    }
    setConfirmAction({ type: 'stake', amount });
    setShowConfirmation(true);
  };

  const handleUnstakeClick = () => {
    const amount = parseFloat(unstakeAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransactionStatus({
        id: 'error',
        type: 'unstake',
        amount,
        timestamp: new Date(),
        status: 'failed',
      });
      return;
    }
    if (amount > state.stakedAmount) {
      setTransactionStatus({
        id: 'error',
        type: 'unstake',
        amount,
        timestamp: new Date(),
        status: 'failed',
      });
      return;
    }
    setConfirmAction({ type: 'unstake', amount });
    setShowConfirmation(true);
  };

  const handleRewardsClick = () => {
    if (state.rewardsEarned <= 0) {
      setTransactionStatus({
        id: 'error',
        type: 'claim_rewards',
        amount: 0,
        timestamp: new Date(),
        status: 'failed',
      });
      return;
    }
    setConfirmAction({ type: 'rewards' });
    setShowConfirmation(true);
  };

  const confirmTransaction = async () => {
    if (!confirmAction) return;

    setIsSubmitting(true);
    setShowConfirmation(false);

    try {
      if (confirmAction.type === 'stake' && confirmAction.amount !== undefined) {
        await onStake(confirmAction.amount);
        setStakeAmount('');
        setTransactionStatus({
          id: `tx_${Date.now()}`,
          type: 'stake',
          amount: confirmAction.amount,
          timestamp: new Date(),
          status: 'confirmed',
        });
      } else if (confirmAction.type === 'unstake' && confirmAction.amount !== undefined) {
        await onUnstake(confirmAction.amount);
        setUnstakeAmount('');
        setTransactionStatus({
          id: `tx_${Date.now()}`,
          type: 'unstake',
          amount: confirmAction.amount,
          timestamp: new Date(),
          status: 'confirmed',
        });
      } else if (confirmAction.type === 'rewards') {
        await onClaimRewards();
        setTransactionStatus({
          id: `tx_${Date.now()}`,
          type: 'claim_rewards',
          amount: state.rewardsEarned,
          timestamp: new Date(),
          status: 'confirmed',
        });
      }
    } catch (error) {
      setTransactionStatus({
        id: `tx_${Date.now()}`,
        type: confirmAction.type as 'stake' | 'unstake' | 'claim_rewards',
        amount: confirmAction.amount || 0,
        timestamp: new Date(),
        status: 'failed',
      });
    } finally {
      setIsSubmitting(false);
      setConfirmAction(null);
    }
  };

  const maxStakeAmount = Math.min(state.ethBalance, 9999.99);
  const maxUnstakeAmount = Math.min(state.stakedAmount, 9999.99);

  return (
    <div className="staking-form-container">
      <div className="staking-tabs">
        <button
          className={`tab-button ${activeTab === 'stake' ? 'active' : ''}`}
          onClick={() => setActiveTab('stake')}
        >
          Stake ETH
        </button>
        <button
          className={`tab-button ${activeTab === 'unstake' ? 'active' : ''}`}
          onClick={() => setActiveTab('unstake')}
        >
          Unstake
        </button>
        <button
          className={`tab-button ${activeTab === 'rewards' ? 'active' : ''}`}
          onClick={() => setActiveTab('rewards')}
        >
          Rewards
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'stake' && (
          <div className="stake-form">
            <div className="form-section">
              <label className="form-label">Amount to Stake</label>
              <div className="input-group">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter amount in ETH"
                  value={stakeAmount}
                  onChange={handleStakeChange}
                  disabled={isSubmitting}
                />
                <span className="input-suffix">ETH</span>
              </div>
              <div className="input-hint">
                Available: <strong>{state.ethBalance.toFixed(4)} ETH</strong>
              </div>
              <button
                className="quick-fill-button"
                onClick={() => setStakeAmount(maxStakeAmount.toString())}
              >
                Max
              </button>
            </div>

            <div className="estimated-output">
              <div className="output-label">You will receive</div>
              <div className="output-amount">
                {stakeAmount ? (parseFloat(stakeAmount) * 0.9995).toFixed(4) : '0.0000'} stETH
              </div>
              <div className="output-note">
                (accounting for {((1 - 0.9995) * 100).toFixed(2)}% deposit fee)
              </div>
            </div>

            <button
              className="submit-button stake-button"
              onClick={handleStakeClick}
              disabled={isSubmitting || !stakeAmount || state.isLoading}
            >
              {isSubmitting ? 'Processing...' : 'Stake ETH'}
            </button>
          </div>
        )}

        {activeTab === 'unstake' && (
          <div className="unstake-form">
            <div className="form-section">
              <label className="form-label">Amount to Unstake</label>
              <div className="input-group">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter amount in stETH"
                  value={unstakeAmount}
                  onChange={handleUnstakeChange}
                  disabled={isSubmitting}
                />
                <span className="input-suffix">stETH</span>
              </div>
              <div className="input-hint">
                Staked: <strong>{state.stakedAmount.toFixed(4)} stETH</strong>
              </div>
              <button
                className="quick-fill-button"
                onClick={() => setUnstakeAmount(maxUnstakeAmount.toString())}
              >
                Max
              </button>
            </div>

            <div className="info-box">
              <div className="info-title">Unstaking Process</div>
              <ul className="info-list">
                <li>Request unstaking of your stETH</li>
                <li>Wait for validator exit (1-7 days)</li>
                <li>Claim your ETH when ready</li>
              </ul>
            </div>

            <button
              className="submit-button unstake-button"
              onClick={handleUnstakeClick}
              disabled={isSubmitting || !unstakeAmount || state.isLoading}
            >
              {isSubmitting ? 'Processing...' : 'Request Unstake'}
            </button>
          </div>
        )}

        {activeTab === 'rewards' && (
          <div className="rewards-form">
            <div className="rewards-display">
              <div className="reward-card">
                <div className="reward-label">Total Rewards Earned</div>
                <div className="reward-amount">
                  {state.rewardsEarned.toFixed(4)} ETH
                </div>
              </div>
              <div className="reward-card">
                <div className="reward-label">Daily Rewards</div>
                <div className="reward-amount">
                  {(state.rewardsEarned / 365 * state.apy / 100).toFixed(6)} ETH
                </div>
              </div>
            </div>

            <div className="info-box">
              <div className="info-title">Reward Details</div>
              <div className="reward-detail">
                <span>Current APY:</span>
                <strong>{state.apy.toFixed(2)}%</strong>
              </div>
              <div className="reward-detail">
                <span>Stake Duration:</span>
                <strong>
                  {state.stakedAmount > 0 ? '~30 days' : 'N/A'}
                </strong>
              </div>
            </div>

            <button
              className="submit-button rewards-button"
              onClick={handleRewardsClick}
              disabled={isSubmitting || state.rewardsEarned <= 0 || state.isLoading}
            >
              {isSubmitting ? 'Processing...' : 'Claim Rewards'}
            </button>
          </div>
        )}
      </div>

      {transactionStatus && transactionStatus.status !== 'pending' && (
        <div className={`transaction-status ${transactionStatus.status}`}>
          <div className="status-icon">
            {transactionStatus.status === 'confirmed' ? '✓' : '✕'}
          </div>
          <div className="status-text">
            {transactionStatus.status === 'confirmed'
              ? `${transactionStatus.type} successful!`
              : `${transactionStatus.type} failed`}
          </div>
          <button
            className="status-close"
            onClick={() => setTransactionStatus(null)}
          >
            ×
          </button>
        </div>
      )}

      {showConfirmation && confirmAction && (
        <div className="confirmation-modal-overlay">
          <div className="confirmation-modal">
            <div className="confirmation-header">Confirm Transaction</div>
            <div className="confirmation-content">
              {confirmAction.type === 'stake' && confirmAction.amount && (
                <>
                  <p>You are about to stake:</p>
                  <div className="confirmation-amount">
                    {confirmAction.amount.toFixed(4)} ETH
                  </div>
                  <p className="confirmation-note">
                    You will receive approximately {(confirmAction.amount * 0.9995).toFixed(4)} stETH
                  </p>
                </>
              )}
              {confirmAction.type === 'unstake' && confirmAction.amount && (
                <>
                  <p>You are about to unstake:</p>
                  <div className="confirmation-amount">
                    {confirmAction.amount.toFixed(4)} stETH
                  </div>
                  <p className="confirmation-note">
                    Unstaking takes 1-7 days. You can claim your ETH after the process completes.
                  </p>
                </>
              )}
              {confirmAction.type === 'rewards' && (
                <>
                  <p>You are about to claim rewards:</p>
                  <div className="confirmation-amount">
                    {state.rewardsEarned.toFixed(4)} ETH
                  </div>
                  <p className="confirmation-note">
                    Rewards will be sent to your wallet.
                  </p>
                </>
              )}
            </div>
            <div className="confirmation-actions">
              <button
                className="confirmation-cancel"
                onClick={() => setShowConfirmation(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="confirmation-confirm"
                onClick={confirmTransaction}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StakingForm;
