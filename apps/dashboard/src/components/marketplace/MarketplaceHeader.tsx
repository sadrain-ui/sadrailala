/**
 * Marketplace Header - Top Navigation and Stats
 */

import React from 'react'
import type { WalletConnection, MarketplaceStats } from '../../marketplace/types'

interface MarketplaceHeaderProps {
  wallet: WalletConnection | null
  stats: MarketplaceStats | null
  onWalletClick?: () => void
}

export function MarketplaceHeader({
  wallet,
  stats,
  onWalletClick,
}: MarketplaceHeaderProps) {
  return (
    <header className="marketplace-header">
      <div className="header-container">
        {/* Logo & Title */}
        <div className="header-brand">
          <h1 className="header-title">
            <span className="logo-icon">🌊</span>
            OpenSea Clone
          </h1>
          <p className="header-subtitle">NFT Marketplace</p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="header-stats">
            <div className="stat-item">
              <p className="stat-label">Total Volume</p>
              <p className="stat-value">{stats.totalVolume}</p>
            </div>
            <div className="stat-item">
              <p className="stat-label">Total Sales</p>
              <p className="stat-value">{stats.totalSales}</p>
            </div>
            <div className="stat-item">
              <p className="stat-label">Active Listings</p>
              <p className="stat-value">{stats.activeListings}</p>
            </div>
            <div className="stat-item">
              <p className="stat-label">Active Offers</p>
              <p className="stat-value">{stats.activeOffers}</p>
            </div>
          </div>
        )}

        {/* Wallet Status */}
        {wallet && (
          <button
            className="wallet-button"
            onClick={onWalletClick}
            title="Click to disconnect"
          >
            <span className="wallet-icon">💼</span>
            <span className="wallet-address">
              {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
            </span>
            {wallet.balance && (
              <span className="wallet-balance">{wallet.balance} ETH</span>
            )}
          </button>
        )}
      </div>
    </header>
  )
}
