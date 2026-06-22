/**
 * Filter Panel - Marketplace Filters
 */

import React from 'react'

interface Filters {
  searchQuery: string
  priceRange: [number, number]
  collectionIds: string[]
  standard: 'all' | 'erc721' | 'erc1155'
  sortBy: 'price_low' | 'price_high' | 'newest' | 'oldest'
  statusFilter: 'all_listings' | 'buy_now' | 'has_offers'
}

interface FilterPanelProps {
  filters: Filters
  onFiltersChange: (filters: Filters) => void
}

export function FilterPanel({ filters, onFiltersChange }: FilterPanelProps) {
  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  return (
    <div className="filter-panel">
      {/* Search */}
      <div className="filter-group">
        <label htmlFor="search">Search</label>
        <input
          id="search"
          type="text"
          placeholder="Search by name..."
          value={filters.searchQuery}
          onChange={(e) => updateFilter('searchQuery', e.target.value)}
          className="filter-input"
        />
      </div>

      {/* Price Range */}
      <div className="filter-group">
        <label>Price Range (ETH)</label>
        <div className="price-inputs">
          <input
            type="number"
            placeholder="Min"
            value={filters.priceRange[0]}
            onChange={(e) =>
              updateFilter('priceRange', [
                parseFloat(e.target.value) || 0,
                filters.priceRange[1],
              ])
            }
            className="filter-input"
          />
          <span className="price-separator">to</span>
          <input
            type="number"
            placeholder="Max"
            value={filters.priceRange[1]}
            onChange={(e) =>
              updateFilter('priceRange', [
                filters.priceRange[0],
                parseFloat(e.target.value) || 1000,
              ])
            }
            className="filter-input"
          />
        </div>
      </div>

      {/* Standard Filter */}
      <div className="filter-group">
        <label>Token Standard</label>
        <div className="filter-options">
          {['all', 'erc721', 'erc1155'].map((standard) => (
            <label key={standard} className="checkbox-label">
              <input
                type="radio"
                name="standard"
                value={standard}
                checked={filters.standard === standard}
                onChange={(e) =>
                  updateFilter('standard', e.target.value as typeof filters.standard)
                }
              />
              <span>{standard === 'all' ? 'All Standards' : standard.toUpperCase()}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Status Filter */}
      <div className="filter-group">
        <label>Status</label>
        <div className="filter-options">
          {['all_listings', 'buy_now', 'has_offers'].map((status) => (
            <label key={status} className="checkbox-label">
              <input
                type="radio"
                name="status"
                value={status}
                checked={filters.statusFilter === status}
                onChange={(e) =>
                  updateFilter('statusFilter', e.target.value as typeof filters.statusFilter)
                }
              />
              <span>
                {status === 'all_listings'
                  ? 'All Listings'
                  : status === 'buy_now'
                    ? 'Buy Now'
                    : 'Has Offers'}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Sort By */}
      <div className="filter-group">
        <label htmlFor="sort">Sort By</label>
        <select
          id="sort"
          value={filters.sortBy}
          onChange={(e) => updateFilter('sortBy', e.target.value as typeof filters.sortBy)}
          className="filter-select"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="price_low">Price: Low to High</option>
          <option value="price_high">Price: High to Low</option>
        </select>
      </div>

      {/* Clear Filters Button */}
      <button
        className="btn btn-secondary btn-block"
        onClick={() =>
          onFiltersChange({
            searchQuery: '',
            priceRange: [0, 1000],
            collectionIds: [],
            standard: 'all',
            sortBy: 'newest',
            statusFilter: 'all_listings',
          })
        }
      >
        Clear Filters
      </button>
    </div>
  )
}
