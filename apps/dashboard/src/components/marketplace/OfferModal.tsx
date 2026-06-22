/**
 * Offer Modal - Make Offers on NFTs
 */

import React, { useState } from 'react'
import type { NFTListing, WalletConnection } from '../../marketplace/types'

interface OfferModalProps {
  listing: NFTListing
  wallet: WalletConnection
  onClose: () => void
  onSubmit: (amount: string) => Promise<void>
}

export function OfferModal({
  listing,
  wallet,
  onClose,
  onSubmit,
}: OfferModalProps) {
  const [offerAmount, setOfferAmount] = useState('')
  const [currency, setCurrency] = useState('ETH')
  const [expiryDays, setExpiryDays] = useState('7')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentPrice = parseFloat(listing.price)
  const offerPrice = parseFloat(offerAmount) || 0
  const pricePercentage = currentPrice > 0 ? ((offerPrice / currentPrice) * 100).toFixed(1) : '0'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!offerAmount || offerPrice <= 0) {
      setError('Please enter a valid offer amount')
      return
    }

    if (offerPrice >= currentPrice) {
      setError('Offer amount must be less than asking price')
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit(offerAmount)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to place offer')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-medium" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <div className="modal-header">
          <h2>Make an Offer</h2>
          <p className="modal-subtitle">{listing.asset.name}</p>
        </div>

        <form onSubmit={handleSubmit} className="offer-form">
          {/* Item Preview */}
          <div className="offer-item-preview">
            {listing.asset.imageUrl && (
              <img src={listing.asset.imageUrl} alt={listing.asset.name} />
            )}
            <div className="preview-info">
              <p className="preview-name">{listing.asset.name}</p>
              <p className="preview-price">
                Asking: {listing.price} {listing.currency}
              </p>
            </div>
          </div>

          {/* Offer Amount */}
          <div className="form-group">
            <label htmlFor="offer-amount">Offer Amount</label>
            <div className="amount-input-group">
              <input
                id="offer-amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
                disabled={isSubmitting}
              />
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={isSubmitting}
              >
                <option>ETH</option>
                <option>USDC</option>
                <option>USDT</option>
              </select>
            </div>
          </div>

          {/* Price Comparison */}
          {offerPrice > 0 && (
            <div className="price-comparison">
              <p>
                <span className="comparison-label">
                  {offerPrice < currentPrice ? '↓' : '↑'} {pricePercentage}% of asking price
                </span>
              </p>
            </div>
          )}

          {/* Expiry */}
          <div className="form-group">
            <label htmlFor="expiry">Offer Expires In</label>
            <select
              id="expiry"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              disabled={isSubmitting}
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">6 months</option>
            </select>
          </div>

          {/* Terms */}
          <div className="offer-terms">
            <label className="checkbox-label">
              <input type="checkbox" required disabled={isSubmitting} />
              <span>I agree to the terms of service</span>
            </label>
          </div>

          {/* Error Message */}
          {error && <div className="error-message">{error}</div>}

          {/* Actions */}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || !offerAmount}
            >
              {isSubmitting ? 'Placing Offer...' : 'Place Offer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
