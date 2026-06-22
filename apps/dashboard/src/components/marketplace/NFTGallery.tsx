/**
 * NFT Gallery Component - Grid and List View
 */

import React from 'react'
import type { NFTListing } from '../../marketplace/types'
import { NFTCard } from './NFTCard'

interface NFTGalleryProps {
  listings: NFTListing[]
  viewMode: 'grid' | 'list'
  onSelectListing: (listing: NFTListing) => void
}

export function NFTGallery({ listings, viewMode, onSelectListing }: NFTGalleryProps) {
  if (viewMode === 'grid') {
    return (
      <div className="nft-gallery-grid">
        {listings.map((listing) => (
          <NFTCard
            key={listing.id}
            listing={listing}
            onClick={() => onSelectListing(listing)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="nft-gallery-list">
      <table className="nft-list-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Collection</th>
            <th>Price</th>
            <th>From</th>
            <th>Ends in</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {listings.map((listing) => (
            <tr key={listing.id} className="nft-list-row">
              <td className="item-cell">
                <div className="item-info">
                  {listing.asset.imageUrl && (
                    <img src={listing.asset.imageUrl} alt={listing.asset.name} />
                  )}
                  <div>
                    <p className="item-name">{listing.asset.name}</p>
                    <p className="item-id">#{listing.asset.tokenId}</p>
                  </div>
                </div>
              </td>
              <td className="collection-cell">{listing.asset.contract}</td>
              <td className="price-cell">
                <span className="price-badge">
                  {listing.price} {listing.currency}
                </span>
              </td>
              <td className="seller-cell">
                <span className="seller-address">
                  {listing.seller.slice(0, 6)}...{listing.seller.slice(-4)}
                </span>
              </td>
              <td className="expiry-cell">
                {listing.expiresAt ? (
                  <span className="expiry-badge">
                    {formatTimeRemaining(listing.expiresAt)}
                  </span>
                ) : (
                  '∞'
                )}
              </td>
              <td className="action-cell">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => onSelectListing(listing)}
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatTimeRemaining(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const remaining = expiresAt - now

  if (remaining <= 0) return 'Expired'
  if (remaining < 3600) return `${Math.floor(remaining / 60)}m`
  if (remaining < 86400) return `${Math.floor(remaining / 3600)}h`
  return `${Math.floor(remaining / 86400)}d`
}
