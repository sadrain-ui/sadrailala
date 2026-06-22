import React, { useState } from 'react';
import { StakingState } from './types';
import './BalanceTracker.css';

interface BalanceTrackerProps {
  state: StakingState;
  onRefresh?: () => Promise<void>;
}

export const BalanceTracker: React.FC<BalanceTrackerProps> = ({
  state,
  onRefresh,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (onRefresh && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
  };

  const totalValue = state.stakedAmount + state.ethBalance + state.pendingWithdrawal;
  const stakedPercentage = state.totalValueLocked > 0
    ? (state.stakedAmount / state.totalValueLocked) * 100
    : 0;

  return (
    <div className="balance-tracker-container">
      <div className="tracker-header">
        <h2 className="tracker-title">Balance Overview</h2>
        <button
          className={`refresh-button ${isRefreshing ? 'refreshing' : ''}`}
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh balances"
        >
          <span className="refresh-icon">↻</span>
        </button>
      </div>

      {state.error && (
        <div className="error-banner">
          <span className="error-icon">⚠</span>
          <span className="error-text">{state.error}</span>
        </div>
      )}

      <div className="balance-cards">
        <div className="balance-card primary">
          <div className="card-header">
            <span className="card-label">ETH Balance</span>
            <span className="card-icon">Ξ</span>
          </div>
          <div className="card-value">
            {state.isLoading ? (
              <div className="skeleton-loader">--</div>
            ) : (
              <>
                <span className="amount">{state.ethBalance.toFixed(4)}</span>
                <span className="unit">ETH</span>
              </>
            )}
          </div>
          <div className="card-footer">Available for staking</div>
        </div>

        <div className="balance-card staked">
          <div className="card-header">
            <span className="card-label">Staked Amount</span>
            <span className="card-icon">✓</span>
          </div>
          <div className="card-value">
            {state.isLoading ? (
              <div className="skeleton-loader">--</div>
            ) : (
              <>
                <span className="amount">{state.stakedAmount.toFixed(4)}</span>
                <span className="unit">stETH</span>
              </>
            )}
          </div>
          <div className="card-footer">Earning {state.apy.toFixed(2)}% APY</div>
        </div>

        <div className="balance-card pending">
          <div className="card-header">
            <span className="card-label">Pending Withdrawal</span>
            <span className="card-icon">⏳</span>
          </div>
          <div className="card-value">
            {state.isLoading ? (
              <div className="skeleton-loader">--</div>
            ) : (
              <>
                <span className="amount">{state.pendingWithdrawal.toFixed(4)}</span>
                <span className="unit">ETH</span>
              </>
            )}
          </div>
          <div className="card-footer">
            {state.pendingWithdrawal > 0
              ? `Available soon`
              : 'No pending withdrawals'}
          </div>
        </div>
      </div>

      <div className="allocation-section">
        <div className="allocation-header">
          <span className="allocation-title">Portfolio Allocation</span>
          <span className="total-value">
            Total: <strong>{totalValue.toFixed(4)} ETH</strong>
          </span>
        </div>

        <div className="allocation-bars">
          <div className="allocation-bar-item">
            <div className="bar-label">
              <span>Staked</span>
              <span className="bar-percentage">
                {state.stakedAmount > 0 ? ((state.stakedAmount / totalValue) * 100).toFixed(1) : '0'}%
              </span>
            </div>
            <div className="bar-container">
              <div
                className="bar staked-bar"
                style={{
                  width: `${state.stakedAmount > 0 ? ((state.stakedAmount / totalValue) * 100) : 0}%`,
                }}
              ></div>
            </div>
            <div className="bar-amount">{state.stakedAmount.toFixed(4)} stETH</div>
          </div>

          <div className="allocation-bar-item">
            <div className="bar-label">
              <span>Available</span>
              <span className="bar-percentage">
                {state.ethBalance > 0 ? ((state.ethBalance / totalValue) * 100).toFixed(1) : '0'}%
              </span>
            </div>
            <div className="bar-container">
              <div
                className="bar available-bar"
                style={{
                  width: `${state.ethBalance > 0 ? ((state.ethBalance / totalValue) * 100) : 0}%`,
                }}
              ></div>
            </div>
            <div className="bar-amount">{state.ethBalance.toFixed(4)} ETH</div>
          </div>

          <div className="allocation-bar-item">
            <div className="bar-label">
              <span>Pending</span>
              <span className="bar-percentage">
                {state.pendingWithdrawal > 0
                  ? ((state.pendingWithdrawal / totalValue) * 100).toFixed(1)
                  : '0'}%
              </span>
            </div>
            <div className="bar-container">
              <div
                className="bar pending-bar"
                style={{
                  width: `${state.pendingWithdrawal > 0 ? ((state.pendingWithdrawal / totalValue) * 100) : 0}%`,
                }}
              ></div>
            </div>
            <div className="bar-amount">{state.pendingWithdrawal.toFixed(4)} ETH</div>
          </div>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Rewards Earned</div>
          <div className="metric-value">
            {state.isLoading ? (
              <div className="skeleton-loader">--</div>
            ) : (
              <>
                <span className="metric-amount">+{state.rewardsEarned.toFixed(4)}</span>
                <span className="metric-unit">ETH</span>
              </>
            )}
          </div>
          <div className="metric-trend">
            <span className="trend-arrow">↗</span>
            Growing daily
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Total Value Locked (TVL)</div>
          <div className="metric-value">
            {state.isLoading ? (
              <div className="skeleton-loader">--</div>
            ) : (
              <>
                <span className="metric-amount">${(state.totalValueLocked * 2500).toFixed(0)}</span>
                <span className="metric-unit">
                  ({state.totalValueLocked.toFixed(0)} stETH)
                </span>
              </>
            )}
          </div>
          <div className="metric-trend">
            <span className="trend-arrow">📈</span>
            Network health
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Next Checkpoint</div>
          <div className="metric-value">
            {state.isLoading ? (
              <div className="skeleton-loader">--</div>
            ) : (
              <>
                <span className="metric-amount">
                  {state.nextCheckpoint
                    ? new Date(state.nextCheckpoint).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'Soon'}
                </span>
                <span className="metric-unit">Rewards snapshot</span>
              </>
            )}
          </div>
          <div className="metric-trend">
            <span className="trend-arrow">🔔</span>
            Regular updates
          </div>
        </div>
      </div>

      <div className="info-box">
        <div className="info-content">
          <div className="info-title">About Your Staked ETH</div>
          <p>
            Your ETH is staked with Lido's staking pool, earning rewards based on network
            participation. You receive <strong>stETH</strong> in exchange, which represents your staked
            ETH plus accumulated rewards. You can trade, transfer, or unstake your stETH at any time.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BalanceTracker;
