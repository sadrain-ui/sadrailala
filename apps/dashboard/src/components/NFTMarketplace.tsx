/**
 * OpenSea NFT Marketplace Clone - Main Marketplace Component
 * Pixel-perfect UI with NFT listing display, wallet connection, collection browsing
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { NFTCollection, NFTListing, NFTAsset, WalletConnection, MarketplaceStats } from '../marketplace/types'
import { NFTGallery } from './marketplace/NFTGallery'
import { NFTListingDetail } from './marketplace/NFTListingDetail'
import { CollectionBrowser } from './marketplace/CollectionBrowser'
import { WalletConnector } from './marketplace/WalletConnector'
import { MarketplaceHeader } from './marketplace/MarketplaceHeader'
import { FilterPanel } from './marketplace/FilterPanel'
import { OfferModal } from './marketplace/OfferModal'
import '../styles/marketplace.css'

interface MarketplaceFilters {
  searchQuery: string
  priceRange: [number, number]
  collectionIds: string[]
  standard: 'all' | 'erc721' | 'erc1155'
  sortBy: 'price_low' | 'price_high' | 'newest' | 'oldest'
  statusFilter: 'all_listings' | 'buy_now' | 'has_offers'
}

export function NFTMarketplace() {
  // Wallet & Auth State
  const [wallet, setWallet] = useState<WalletConnection | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  // Marketplace Data State
  const [listings, setListings] = useState<NFTListing[]>([])
  const [collections, setCollections] = useState<NFTCollection[]>([])
  const [stats, setStats] = useState<MarketplaceStats | null>(null)
  const [selectedListing, setSelectedListing] = useState<NFTListing | null>(null)

  // UI State
  const [filters, setFilters] = useState<MarketplaceFilters>({
    searchQuery: '',
    priceRange: [0, 1000],
    collectionIds: [],
    standard: 'all',
    sortBy: 'newest',
    statusFilter: 'all_listings',
  })
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOfferModal, setShowOfferModal] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState<NFTCollection | null>(null)

  // Fetch marketplace data
  const fetchMarketplaceData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/marketplace/listings', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(wallet?.address && { 'X-Wallet-Address': wallet.address }),
        },
      })
      if (!response.ok) throw new Error('Failed to fetch listings')
      const data = await response.json()
      setListings(data.data?.listings || [])
      setStats(data.data?.stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load marketplace')
    } finally {
      setIsLoading(false)
    }
  }, [wallet?.address])

  // Fetch collections
  const fetchCollections = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/marketplace/collections')
      if (!response.ok) throw new Error('Failed to fetch collections')
      const data = await response.json()
      setCollections(data.data?.collections || [])
    } catch (e) {
      console.error('Failed to load collections:', e)
    }
  }, [])

  // Initial data load
  useEffect(() => {
    void fetchCollections()
    void fetchMarketplaceData()
  }, [fetchCollections, fetchMarketplaceData])

  // Handle wallet connection
  const handleWalletConnect = useCallback(async (connection: WalletConnection) => {
    setIsConnecting(true)
    try {
      setWallet(connection)
      await fetchMarketplaceData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect wallet')
    } finally {
      setIsConnecting(false)
    }
  }, [fetchMarketplaceData])

  // Handle wallet disconnect
  const handleWalletDisconnect = () => {
    setWallet(null)
    setSelectedListing(null)
  }

  // Filter and sort listings
  const filteredAndSortedListings = listings
    .filter((listing) => {
      // Search filter
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase()
        if (!listing.asset.name.toLowerCase().includes(query)) return false
      }

      // Collection filter
      if (filters.collectionIds.length > 0) {
        if (!filters.collectionIds.includes(listing.asset.contract)) return false
      }

      // Standard filter
      if (filters.standard !== 'all' && listing.asset.standard !== filters.standard) {
        return false
      }

      // Price range filter
      const price = parseFloat(listing.price)
      if (price < filters.priceRange[0] || price > filters.priceRange[1]) return false

      // Status filter
      if (filters.statusFilter === 'buy_now' && listing.status !== 'active') return false

      return true
    })
    .sort((a, b) => {
      const priceA = parseFloat(a.price)
      const priceB = parseFloat(b.price)

      switch (filters.sortBy) {
        case 'price_low':
          return priceA - priceB
        case 'price_high':
          return priceB - priceA
        case 'newest':
          return b.createdAt - a.createdAt
        case 'oldest':
          return a.createdAt - b.createdAt
        default:
          return 0
      }
    })

  return (
    <div className="nft-marketplace">
      {/* Header */}
      <MarketplaceHeader
        wallet={wallet}
        stats={stats}
        onWalletClick={wallet ? handleWalletDisconnect : undefined}
      />

      <div className="marketplace-container">
        {/* Wallet Connection Banner */}
        {!wallet && (
          <div className="connection-banner">
            <div className="banner-content">
              <h3>Connect Your Wallet</h3>
              <p>Connect a wallet to view your collections and make offers</p>
            </div>
            <WalletConnector
              isConnecting={isConnecting}
              onConnect={handleWalletConnect}
            />
          </div>
        )}

        {/* Main Content */}
        <div className="marketplace-layout">
          {/* Sidebar - Filters & Collections */}
          <aside className="marketplace-sidebar">
            <div className="sidebar-section">
              <h3>Browse Collections</h3>
              <CollectionBrowser
                collections={collections}
                selectedCollection={selectedCollection}
                onSelectCollection={setSelectedCollection}
              />
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
              <h3>Filters</h3>
              <FilterPanel
                filters={filters}
                onFiltersChange={setFilters}
              />
            </div>
          </aside>

          {/* Main Gallery */}
          <main className="marketplace-main">
            {error && (
              <div className="error-banner-inline">
                <p>{error}</p>
                <button onClick={() => void fetchMarketplaceData()}>Retry</button>
              </div>
            )}

            <div className="gallery-header">
              <div className="results-info">
                <p>
                  Showing {filteredAndSortedListings.length} items
                  {selectedCollection && ` in ${selectedCollection.name}`}
                </p>
              </div>

              <div className="view-controls">
                <button
                  className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                >
                  ⊞
                </button>
                <button
                  className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title="List view"
                >
                  ☰
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="loading-state">
                <div className="spinner" />
                <p>Loading NFTs...</p>
              </div>
            ) : filteredAndSortedListings.length === 0 ? (
              <div className="empty-state">
                <p>No listings found</p>
                <button onClick={() => setFilters({ ...filters, searchQuery: '', collectionIds: [] })}>
                  Clear filters
                </button>
              </div>
            ) : (
              <NFTGallery
                listings={filteredAndSortedListings}
                viewMode={viewMode}
                onSelectListing={setSelectedListing}
              />
            )}
          </main>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedListing && wallet && (
        <NFTListingDetail
          listing={selectedListing}
          wallet={wallet}
          onClose={() => setSelectedListing(null)}
          onMakeOffer={() => setShowOfferModal(true)}
          onBuy={() => {
            // Handle purchase
            console.log('Buy listing:', selectedListing.id)
          }}
        />
      )}

      {/* Offer Modal */}
      {showOfferModal && selectedListing && wallet && (
        <OfferModal
          listing={selectedListing}
          wallet={wallet}
          onClose={() => setShowOfferModal(false)}
          onSubmit={async (amount) => {
            try {
              const response = await fetch('/api/v1/marketplace/offers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  asset_id: selectedListing.asset.id,
                  amount,
                  wallet_address: wallet.address,
                }),
              })
              if (!response.ok) throw new Error('Failed to place offer')
              setShowOfferModal(false)
              await fetchMarketplaceData()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed to place offer')
            }
          }}
        />
      )}
    </div>
  )
}
