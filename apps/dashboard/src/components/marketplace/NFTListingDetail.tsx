/**
 * NFT Listing Detail Modal
 */

import React, { useState } from 'react'
import type { NFTListing, WalletConnection } from '../../marketplace/types'

interface NFTListingDetailProps {
  listing: NFTListing
  wallet: WalletConnection
  onClose: () => void
  onMakeOffer: () => void
  onBuy: () => void
}

export function NFTListingDetail({
  listing,
  wallet,
  onClose,
  onMakeOffer,
  onBuy,
}: NFTListingDetailProps) {
  const [isBuying, setIsBuying] = useState(false)

  const handleBuy = async () => {
    setIsBuying(true)
    try {
      const response = await fetch('/api/v1/marketplace/fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: listing.id,
          wallet_address: wallet.address,
          chain_id: wallet.chainId,
        }),
      })
      if (response.ok) {
        onBuy()
        onClose()
      }
    } catch (error) {
      console.error('Failed to fulfill order:', error)
    } finally {
      setIsBuying(false)
    }
  }

  const isOwner = listing.seller.toLowerCase() === wallet.address.toLowerCase()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="listing-detail-layout">
          {/* Left: Image */}
          <div className="listing-detail-image">
            {listing.asset.imageUrl && (
              <img src={listing.asset.imageUrl} alt={listing.asset.name} />
            )}
          </div>

          {/* Right: Details */}
          <div className="listing-detail-info">
            <div className="detail-header">
              <p className="detail-collection">{listing.asset.contract}</p>
              <h2 className="detail-title">{listing.asset.name}</h2>
              <p className="detail-id">Token ID: {listing.asset.tokenId}</p>
            </div>

            {listing.asset.description && (
              <div className="detail-section">
                <h3>Description</h3>
                <p>{listing.asset.description}</p>
              </div>
            )}

            {/* Attributes */}
            {listing.asset.attributes && listing.asset.attributes.length > 0 && (
              <div className="detail-section">
                <h3>Properties</h3>
                <div className="attributes-grid">
                  {listing.asset.attributes.map((attr, idx) => (
                    <div key={idx} className="attribute-item">
                      <p className="attribute-trait">{attr.trait}</p>
                      <p className="attribute-value">{attr.value}</p>
                      {attr.rarity && (
                        <p className="attribute-rarity">{attr.rarity}% have this trait</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Seller Info */}
            <div className="detail-section seller-info">
              <p className="seller-label">Offered by</p>
              <p className="seller-address">{listing.seller}</p>
              {isOwner && <span className="seller-badge">You</span>}
            </div>

            {/* Pricing Section */}
            <div className="pricing-panel">
              <div className="price-section">
                <p className="price-label">Current Price</p>
                <p className="price-display">
                  {listing.price}
                  <span className="price-currency">{listing.currency}</span>
                </p>
                {listing.priceUSD && (
                  <p className="price-usd">${listing.priceUSD}</p>
                )}
              </div>

              {listing.expiresAt && (
                <div className="expiry-section">
                  <p className="expiry-label">Expires</p>
                  <p className="expiry-time">
                    {new Date(listing.expiresAt * 1000).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {!isOwner && (
              <div className="action-buttons">
                <button
                  className="btn btn-primary btn-large"
                  onClick={handleBuy}
                  disabled={isBuying}
                >
                  {isBuying ? 'Processing...' : 'Buy Now'}
                </button>
                <button
                  className="btn btn-secondary btn-large"
                  onClick={onMakeOffer}
                >
                  Make Offer
                </button>
              </div>
            )}

            {isOwner && (
              <div className="owner-message">
                <p>You are the owner of this NFT</p>
              </div>
            )}

            {/* Item Details */}
            <div className="detail-section">
              <h3>Item Details</h3>
              <div className="details-table">
                <div className="detail-row">
                  <span className="detail-label">Contract Address</span>
                  <span className="detail-value mono">{listing.asset.contract}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Token Standard</span>
                  <span className="detail-value">{listing.asset.standard.toUpperCase()}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Token ID</span>
                  <span className="detail-value mono">{listing.asset.tokenId}</span>
                </div>
                {listing.orderHash && (
                  <div className="detail-row">
                    <span className="detail-label">Order Hash</span>
                    <span className="detail-value mono">{listing.orderHash}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
