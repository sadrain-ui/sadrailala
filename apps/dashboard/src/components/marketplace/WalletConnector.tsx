/**
 * Wallet Connector Component - Web3 Wallet Connection UI
 */

import React, { useState } from 'react'
import type { WalletConnection, WalletType } from '../../marketplace/types'

interface WalletConnectorProps {
  isConnecting: boolean
  onConnect: (connection: WalletConnection) => void
}

const WALLET_PROVIDERS: Array<{
  type: WalletType
  name: string
  icon: string
}> = [
  { type: 'metamask', name: 'MetaMask', icon: '🦊' },
  { type: 'walletconnect', name: 'WalletConnect', icon: '🔗' },
  { type: 'trezor', name: 'Trezor', icon: '⚙️' },
]

export function WalletConnector({ isConnecting, onConnect }: WalletConnectorProps) {
  const [selectedWallet, setSelectedWallet] = useState<WalletType | null>(null)
  const [showWalletList, setShowWalletList] = useState(false)

  const connectWallet = async (walletType: WalletType) => {
    try {
      // Mock wallet connection - replace with actual Web3 integration
      const address = '0x' + Array(40).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')
      const chainId = 1 // Ethereum mainnet

      onConnect({
        address,
        chainId,
        walletType,
        isConnected: true,
        balance: '2.5',
      })
      setShowWalletList(false)
    } catch (error) {
      console.error('Wallet connection failed:', error)
    }
  }

  if (showWalletList) {
    return (
      <div className="wallet-selector">
        <div className="wallet-list">
          {WALLET_PROVIDERS.map((provider) => (
            <button
              key={provider.type}
              className="wallet-option"
              onClick={() => {
                setSelectedWallet(provider.type)
                void connectWallet(provider.type)
              }}
              disabled={isConnecting}
            >
              <span className="wallet-icon">{provider.icon}</span>
              <span className="wallet-name">{provider.name}</span>
              {isConnecting && selectedWallet === provider.type && (
                <span className="connecting-spinner">⟳</span>
              )}
            </button>
          ))}
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setShowWalletList(false)}
          style={{ marginTop: '1rem' }}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      className="btn btn-primary"
      onClick={() => setShowWalletList(true)}
      disabled={isConnecting}
    >
      {isConnecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  )
}
