/**
 * Collection Browser - Browse NFT Collections
 */

import React from 'react'
import type { NFTCollection } from '../../marketplace/types'

interface CollectionBrowserProps {
  collections: NFTCollection[]
  selectedCollection: NFTCollection | null
  onSelectCollection: (collection: NFTCollection | null) => void
}

export function CollectionBrowser({
  collections,
  selectedCollection,
  onSelectCollection,
}: CollectionBrowserProps) {
  return (
    <div className="collection-browser">
      <button
        className={`collection-item ${selectedCollection === null ? 'active' : ''}`}
        onClick={() => onSelectCollection(null)}
      >
        <div className="collection-icon">📚</div>
        <div className="collection-meta">
          <p className="collection-name">All Collections</p>
          <p className="collection-count">{collections.length} collections</p>
        </div>
      </button>

      <div className="collection-list">
        {collections.map((collection) => (
          <button
            key={collection.id}
            className={`collection-item ${selectedCollection?.id === collection.id ? 'active' : ''}`}
            onClick={() => onSelectCollection(collection)}
          >
            {collection.imageUrl && (
              <img src={collection.imageUrl} alt={collection.name} className="collection-image" />
            )}
            {!collection.imageUrl && (
              <div className="collection-icon">🖼️</div>
            )}

            <div className="collection-meta">
              <p className="collection-name">{collection.name}</p>
              <div className="collection-stats">
                {collection.itemCount && (
                  <span className="stat">{collection.itemCount} items</span>
                )}
                {collection.floorPrice && (
                  <span className="stat">Floor: {collection.floorPrice} ETH</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
