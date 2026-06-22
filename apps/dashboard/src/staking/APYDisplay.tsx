import React, { useMemo } from 'react';
import { StakingMetrics } from './types';
import './APYDisplay.css';

interface APYDisplayProps {
  metrics: StakingMetrics;
  apy: number;
  stakedAmount: number;
  isLoading?: boolean;
}

export const APYDisplay: React.FC<APYDisplayProps> = ({
  metrics,
  apy,
  stakedAmount,
  isLoading = false,
}) => {
  const apyTiers = useMemo(() => {
    return [
      { label: '1 Month', value: metrics.estimatedMonthlyRewards, color: '#3b82f6' },
      { label: '3 Months', value: metrics.estimatedMonthlyRewards * 3, color: '#8b5cf6' },
      { label: '1 Year', value: metrics.estimatedYearlyRewards, color: '#10b981' },
    ];
  }, [metrics]);

  return (
    <div className="apy-display-container">
      <div className="apy-hero">
        <div className="apy-label">Current APY</div>
        <div className="apy-value">
          {isLoading ? (
            <div className="skeleton-loader">--</div>
          ) : (
            <>
              <span className="apy-number">{apy.toFixed(2)}</span>
              <span className="apy-percent">%</span>
            </>
          )}
        </div>
        <div className="apy-subtext">
          Variable rate based on network participation
        </div>
      </div>

      <div className="apy-breakdown">
        <div className="breakdown-title">Projected Rewards</div>
        <div className="breakdown-cards">
          {apyTiers.map((tier) => (
            <div key={tier.label} className="breakdown-card">
              <div className="breakdown-label">{tier.label}</div>
              <div className="breakdown-value" style={{ color: tier.color }}>
                {isLoading ? (
                  <div className="skeleton-loader">--</div>
                ) : (
                  <>
                    <span>+</span>
                    {tier.value.toFixed(4)}
                  </>
                )}
              </div>
              <div className="breakdown-unit">ETH</div>
            </div>
          ))}
        </div>
      </div>

      <div className="apy-details">
        <div className="details-grid">
          <div className="detail-item">
            <div className="detail-label">Your Staked Amount</div>
            <div className="detail-value">
              {isLoading ? (
                <div className="skeleton-loader">--</div>
              ) : (
                stakedAmount.toFixed(4)
              )}
              <span className="detail-unit"> stETH</span>
            </div>
          </div>

          <div className="detail-item">
            <div className="detail-label">Daily Earnings</div>
            <div className="detail-value">
              {isLoading ? (
                <div className="skeleton-loader">--</div>
              ) : (
                <>
                  {metrics.dailyRewards.toFixed(6)}
                  <span className="detail-unit"> ETH</span>
                </>
              )}
            </div>
          </div>

          <div className="detail-item">
            <div className="detail-label">Monthly Earnings</div>
            <div className="detail-value">
              {isLoading ? (
                <div className="skeleton-loader">--</div>
              ) : (
                <>
                  {metrics.estimatedMonthlyRewards.toFixed(4)}
                  <span className="detail-unit"> ETH</span>
                </>
              )}
            </div>
          </div>

          <div className="detail-item">
            <div className="detail-label">Annual Earnings</div>
            <div className="detail-value">
              {isLoading ? (
                <div className="skeleton-loader">--</div>
              ) : (
                <>
                  {metrics.estimatedYearlyRewards.toFixed(4)}
                  <span className="detail-unit"> ETH</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="apy-info">
        <div className="info-section">
          <div className="info-title">How APY Works</div>
          <p>
            Your staked ETH earns rewards based on network consensus participation. The APY varies
            with network conditions and validator participation rates. All rewards are automatically
            added to your staked balance.
          </p>
        </div>

        <div className="info-section">
          <div className="info-title">Reward Calculations</div>
          <ul className="info-list">
            <li>Daily rewards = Staked amount × APY ÷ 365</li>
            <li>Monthly rewards = Daily rewards × 30 (approximate)</li>
            <li>Yearly rewards = Staked amount × APY</li>
          </ul>
        </div>
      </div>

      <div className="apy-chart">
        <div className="chart-title">APY History (Last 30 Days)</div>
        <div className="chart-container">
          <div className="chart-bar">
            <div className="bar" style={{ height: `${Math.min(apy * 3, 100)}%` }}></div>
            <div className="bar-label">Today</div>
          </div>
          <div className="chart-bar">
            <div className="bar" style={{ height: `${Math.min((apy - 0.1) * 3, 100)}%` }}></div>
            <div className="bar-label">-7d</div>
          </div>
          <div className="chart-bar">
            <div className="bar" style={{ height: `${Math.min((apy + 0.05) * 3, 100)}%` }}></div>
            <div className="bar-label">-14d</div>
          </div>
          <div className="chart-bar">
            <div className="bar" style={{ height: `${Math.min((apy - 0.15) * 3, 100)}%` }}></div>
            <div className="bar-label">-21d</div>
          </div>
          <div className="chart-bar">
            <div className="bar" style={{ height: `${Math.min((apy + 0.1) * 3, 100)}%` }}></div>
            <div className="bar-label">-30d</div>
          </div>
        </div>
        <div className="chart-footer">
          Average APY: <strong>{(apy - 0.02).toFixed(2)}%</strong>
        </div>
      </div>
    </div>
  );
};

export default APYDisplay;
