import { useState } from 'react'
import { WalletConnect } from './components/WalletConnect'
import { Swap } from './components/Swap'
import { Liquidity } from './components/Liquidity'
import { Farming } from './components/Farming'
import { Staking } from './components/Staking'
import './styles/App.css'

type Tab = 'swap' | 'liquidity' | 'farming' | 'staking'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('swap')

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <h1>🥞 PancakeSwap Clone</h1>
            <p>BSC DEX Interface</p>
          </div>
          <WalletConnect />
        </div>
      </header>

      <nav className="navbar">
        <div className="nav-container">
          <button
            className={`nav-link ${activeTab === 'swap' ? 'active' : ''}`}
            onClick={() => setActiveTab('swap')}
          >
            Swap
          </button>
          <button
            className={`nav-link ${activeTab === 'liquidity' ? 'active' : ''}`}
            onClick={() => setActiveTab('liquidity')}
          >
            Liquidity
          </button>
          <button
            className={`nav-link ${activeTab === 'farming' ? 'active' : ''}`}
            onClick={() => setActiveTab('farming')}
          >
            Farm
          </button>
          <button
            className={`nav-link ${activeTab === 'staking' ? 'active' : ''}`}
            onClick={() => setActiveTab('staking')}
          >
            Staking
          </button>
        </div>
      </nav>

      <main className="main-content">
        {activeTab === 'swap' && <Swap />}
        {activeTab === 'liquidity' && <Liquidity />}
        {activeTab === 'farming' && <Farming />}
        {activeTab === 'staking' && <Staking />}
      </main>

      <footer className="footer">
        <p>PancakeSwap Clone for BSC • Built with React & Viem</p>
        <div className="footer-links">
          <a href="#">Docs</a>
          <a href="#">GitHub</a>
          <a href="#">Twitter</a>
        </div>
      </footer>
    </div>
  )
}
