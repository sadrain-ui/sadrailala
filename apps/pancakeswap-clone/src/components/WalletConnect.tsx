import { useWalletStore } from '../stores/walletStore'
import '../styles/WalletConnect.css'

export function WalletConnect() {
  const { wallet, connectWallet, disconnectWallet } = useWalletStore()

  const handleConnect = async () => {
    // Simulate wallet connection (MetaMask, TrustWallet, etc.)
    const mockAddress = '0x' + Math.random().toString(16).slice(2, 42)
    await connectWallet(mockAddress)
  }

  if (wallet?.connected) {
    return (
      <div className="wallet-connect-btn">
        <span className="wallet-address">
          {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
        </span>
        <span className="network-badge">BSC</span>
        <button className="disconnect-btn" onClick={disconnectWallet}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <button className="connect-btn" onClick={handleConnect}>
      Connect Wallet
    </button>
  )
}
