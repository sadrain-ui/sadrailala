/**
 * NFT Card Component - Grid view card for marketplace
 */

import React, { useState } from 'react'
import type { NFTListing } from '../../marketplace/types'

interface NFTCardProps {
  listing: NFTListing
  onClick: () => void
}

export function NFTCard({ listing, onClick }: NFTCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  return (
    <div className="nft-card" onClick={onClick} role="button" tabIndex={0}>
      <div className="nft-card-image">
        {!imageLoaded && !imageError && (
          <div className="nft-card-skeleton" />
        )}
        {!imageError && listing.asset.imageUrl && (
          <img
            src={listing.asset.imageUrl}
            alt={listing.asset.name}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        )}
        {imageError && (
          <div className="nft-card-placeholder">
            <span>NFT</span>
          </div>
        )}
        {listing.asset.standard === 'erc1155' && (
          <div className="nft-card-badge">1155</div>
        )}
      </div>

      <div className="nft-card-content">
        <div className="nft-card-header">
          <h4 className="nft-card-name">{listing.asset.name}</h4>
          <p className="nft-card-id">#{listing.asset.tokenId}</p>
        </div>

        <div className="nft-card-collection">
          <span className="collection-label">Collection</span>
          <p className="collection-name">{listing.asset.contract}</p>
        </div>

        <div className="nft-card-footer">
          <div className="nft-card-price">
            <span className="price-label">Price</span>
            <p className="price-value">
              {listing.price}
              <span className="currency">{listing.currency}</span>
            </p>
            {listing.priceUSD && (
              <p className="price-usd">${listing.priceUSD}</p>
            )}
          </div>

          <div className="nft-card-status">
            <span className={`status-badge status-${listing.status}`}>
              {listing.status === 'active' ? 'For Sale' : listing.status}
            </span>
          </div>
        </div>

        {listing.asset.rarity && (
          <div className="nft-card-rarity">
            <span className={`rarity-tag rarity-${listing.asset.rarity.toLowerCase()}`}>
              {listing.asset.rarity}
            </span>
          </div>
        )}
      </div>

      <div className="nft-card-overlay">
        <button className="btn btn-primary">View Item</button>
      </div>
    </div>
  )
}
