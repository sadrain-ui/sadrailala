/**
 * EXPANDED PLATFORM DATABASE
 *
 * Phase 7: Complete platform coverage (50+ platforms)
 *
 * Categories:
 * - DEX (12 platforms)
 * - CEX (15 platforms)
 * - Wallets (10 platforms)
 * - Bridges (6 platforms)
 * - Lending (8 platforms)
 * - Banks (optional future)
 * - Fintech (optional future)
 */

export interface PlatformEntry {
  name: string
  category: 'dex' | 'cex' | 'wallet' | 'bank' | 'fintech' | 'bridge' | 'lending'
  domain: string
  chains: string[]
  tvl?: string
  volume24h?: string
  verified: boolean
  priority: 'critical' | 'high' | 'medium' | 'low'
}

export const EXPANDED_PLATFORM_DATABASE: PlatformEntry[] = [
  // ==================== DEX (12) ====================
  {
    name: 'Uniswap',
    category: 'dex',
    domain: 'app.uniswap.org',
    chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'],
    tvl: '$5.2B',
    volume24h: '$1.8B',
    verified: true,
    priority: 'critical',
  },
  {
    name: 'Curve Finance',
    category: 'dex',
    domain: 'curve.finance',
    chains: ['ethereum', 'polygon', 'arbitrum', 'avalanche', 'optimism'],
    tvl: '$3.1B',
    volume24h: '$420M',
    verified: true,
    priority: 'high',
  },
  {
    name: 'PancakeSwap',
    category: 'dex',
    domain: 'app.pancakeswap.finance',
    chains: ['bsc', 'ethereum', 'arbitrum', 'polygon'],
    tvl: '$1.8B',
    volume24h: '$850M',
    verified: true,
    priority: 'high',
  },
  {
    name: 'Aave',
    category: 'dex',
    domain: 'app.aave.com',
    chains: ['ethereum', 'polygon', 'arbitrum', 'avalanche', 'optimism', 'bsc'],
    tvl: '$10.5B',
    volume24h: '$500M',
    verified: true,
    priority: 'critical',
  },
  {
    name: 'SushiSwap',
    category: 'dex',
    domain: 'www.sushi.com',
    chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'],
    tvl: '$420M',
    volume24h: '$180M',
    verified: true,
    priority: 'high',
  },
  {
    name: '1inch',
    category: 'dex',
    domain: '1inch.io',
    chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'],
    tvl: '$200M',
    volume24h: '$450M',
    verified: true,
    priority: 'high',
  },
  {
    name: 'OpenSea',
    category: 'dex',
    domain: 'opensea.io',
    chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'solana'],
    tvl: '$800M',
    volume24h: '$30M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Balancer',
    category: 'dex',
    domain: 'app.balancer.fi',
    chains: ['ethereum', 'polygon', 'arbitrum'],
    tvl: '$800M',
    volume24h: '$120M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Uniswap V2',
    category: 'dex',
    domain: 'app.uniswap.org',
    chains: ['ethereum', 'polygon', 'arbitrum'],
    tvl: '$2.1B',
    volume24h: '$300M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'dYdX',
    category: 'dex',
    domain: 'trade.dydx.trade',
    chains: ['ethereum', 'dydx-chain'],
    tvl: '$500M',
    volume24h: '$2.3B',
    verified: true,
    priority: 'high',
  },
  {
    name: 'Raydium',
    category: 'dex',
    domain: 'raydium.io',
    chains: ['solana'],
    tvl: '$200M',
    volume24h: '$150M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Orca',
    category: 'dex',
    domain: 'orca.so',
    chains: ['solana'],
    tvl: '$150M',
    volume24h: '$80M',
    verified: true,
    priority: 'low',
  },

  // ==================== CEX (15) ====================
  {
    name: 'Binance',
    category: 'cex',
    domain: 'binance.com',
    chains: ['bitcoin', 'ethereum', 'bsc', 'solana', 'tron'],
    tvl: '$250B',
    volume24h: '$45B',
    verified: true,
    priority: 'critical',
  },
  {
    name: 'Coinbase',
    category: 'cex',
    domain: 'coinbase.com',
    chains: ['bitcoin', 'ethereum', 'solana', 'polygon'],
    tvl: '$50B',
    volume24h: '$8B',
    verified: true,
    priority: 'critical',
  },
  {
    name: 'Kraken',
    category: 'cex',
    domain: 'kraken.com',
    chains: ['bitcoin', 'ethereum', 'solana', 'polkadot'],
    tvl: '$30B',
    volume24h: '$5B',
    verified: true,
    priority: 'high',
  },
  {
    name: 'Bybit',
    category: 'cex',
    domain: 'bybit.com',
    chains: ['bitcoin', 'ethereum', 'solana'],
    tvl: '$20B',
    volume24h: '$12B',
    verified: true,
    priority: 'high',
  },
  {
    name: 'OKX',
    category: 'cex',
    domain: 'okx.com',
    chains: ['bitcoin', 'ethereum', 'solana', 'ton'],
    tvl: '$25B',
    volume24h: '$10B',
    verified: true,
    priority: 'high',
  },
  {
    name: 'MEXC',
    category: 'cex',
    domain: 'mexc.com',
    chains: ['ethereum', 'bsc', 'solana'],
    tvl: '$5B',
    volume24h: '$1B',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Huobi',
    category: 'cex',
    domain: 'huobi.com',
    chains: ['bitcoin', 'ethereum', 'tron'],
    tvl: '$3B',
    volume24h: '$2B',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'KuCoin',
    category: 'cex',
    domain: 'kucoin.com',
    chains: ['bitcoin', 'ethereum', 'solana'],
    tvl: '$8B',
    volume24h: '$3B',
    verified: true,
    priority: 'high',
  },
  {
    name: 'Gateio',
    category: 'cex',
    domain: 'gate.io',
    chains: ['ethereum', 'bsc', 'solana'],
    tvl: '$6B',
    volume24h: '$2B',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Upbit',
    category: 'cex',
    domain: 'upbit.com',
    chains: ['ethereum', 'bitcoin'],
    tvl: '$4B',
    volume24h: '$3B',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Bitfinex',
    category: 'cex',
    domain: 'bitfinex.com',
    chains: ['bitcoin', 'ethereum'],
    tvl: '$3B',
    volume24h: '$2B',
    verified: true,
    priority: 'low',
  },
  {
    name: 'Crypto.com',
    category: 'cex',
    domain: 'crypto.com',
    chains: ['ethereum', 'polygon', 'cronos'],
    tvl: '$2B',
    volume24h: '$1.5B',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Gemini',
    category: 'cex',
    domain: 'gemini.com',
    chains: ['ethereum', 'bitcoin'],
    tvl: '$5B',
    volume24h: '$500M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Bitstamp',
    category: 'cex',
    domain: 'bitstamp.net',
    chains: ['bitcoin', 'ethereum'],
    tvl: '$2B',
    volume24h: '$300M',
    verified: true,
    priority: 'low',
  },
  {
    name: 'Deribit',
    category: 'cex',
    domain: 'deribit.com',
    chains: ['bitcoin', 'ethereum'],
    tvl: '$10B',
    volume24h: '$5B',
    verified: true,
    priority: 'high',
  },

  // ==================== WALLETS (10) ====================
  {
    name: 'MetaMask',
    category: 'wallet',
    domain: 'metamask.io',
    chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'],
    verified: true,
    priority: 'critical',
  },
  {
    name: 'Phantom',
    category: 'wallet',
    domain: 'phantom.app',
    chains: ['solana', 'ethereum', 'polygon', 'bitcoin'],
    verified: true,
    priority: 'critical',
  },
  {
    name: 'Ledger',
    category: 'wallet',
    domain: 'ledger.com',
    chains: ['ethereum', 'bitcoin', 'solana', 'tron', 'ripple'],
    verified: true,
    priority: 'high',
  },
  {
    name: 'Trezor',
    category: 'wallet',
    domain: 'trezor.io',
    chains: ['ethereum', 'bitcoin', 'litecoin', 'ripple'],
    verified: true,
    priority: 'high',
  },
  {
    name: 'TrustWallet',
    category: 'wallet',
    domain: 'trustwallet.com',
    chains: ['ethereum', 'bsc', 'solana', 'tron', 'bitcoin'],
    verified: true,
    priority: 'high',
  },
  {
    name: 'Coinbase Wallet',
    category: 'wallet',
    domain: 'coinbase.com',
    chains: ['ethereum', 'polygon', 'avalanche', 'arbitrum', 'optimism'],
    verified: true,
    priority: 'high',
  },
  {
    name: 'WalletConnect',
    category: 'wallet',
    domain: 'walletconnect.com',
    chains: ['ethereum', 'solana', 'bitcoin', 'polygon', 'arbitrum'],
    verified: true,
    priority: 'high',
  },
  {
    name: 'OKX Wallet',
    category: 'wallet',
    domain: 'okx.com',
    chains: ['ethereum', 'solana', 'bitcoin', 'ton'],
    verified: true,
    priority: 'medium',
  },
  {
    name: 'ArgentX',
    category: 'wallet',
    domain: 'argent.xyz',
    chains: ['starknet', 'ethereum'],
    verified: true,
    priority: 'low',
  },
  {
    name: 'Rainbow',
    category: 'wallet',
    domain: 'rainbow.me',
    chains: ['ethereum', 'arbitrum', 'optimism', 'polygon'],
    verified: true,
    priority: 'medium',
  },

  // ==================== BRIDGES (6) ====================
  {
    name: 'Stargate',
    category: 'bridge',
    domain: 'stargate.finance',
    chains: ['ethereum', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche'],
    tvl: '$500M',
    volume24h: '$200M',
    verified: true,
    priority: 'high',
  },
  {
    name: 'Across',
    category: 'bridge',
    domain: 'across.to',
    chains: ['ethereum', 'arbitrum', 'optimism', 'polygon'],
    tvl: '$200M',
    volume24h: '$50M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Hop Protocol',
    category: 'bridge',
    domain: 'hop.exchange',
    chains: ['ethereum', 'arbitrum', 'optimism', 'polygon'],
    tvl: '$100M',
    volume24h: '$30M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Synapse',
    category: 'bridge',
    domain: 'synapseprotocol.com',
    chains: ['ethereum', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche'],
    tvl: '$150M',
    volume24h: '$40M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Connext',
    category: 'bridge',
    domain: 'connext.network',
    chains: ['ethereum', 'arbitrum', 'optimism', 'polygon'],
    tvl: '$80M',
    volume24h: '$20M',
    verified: true,
    priority: 'low',
  },
  {
    name: 'Anyswap',
    category: 'bridge',
    domain: 'anyswap.exchange',
    chains: ['ethereum', 'bsc', 'polygon', 'avalanche'],
    tvl: '$120M',
    volume24h: '$35M',
    verified: true,
    priority: 'low',
  },

  // ==================== LENDING (8) ====================
  {
    name: 'Aave',
    category: 'lending',
    domain: 'app.aave.com',
    chains: ['ethereum', 'polygon', 'arbitrum', 'avalanche', 'optimism', 'bsc'],
    tvl: '$10.5B',
    volume24h: '$500M',
    verified: true,
    priority: 'critical',
  },
  {
    name: 'Compound',
    category: 'lending',
    domain: 'compound.finance',
    chains: ['ethereum', 'polygon', 'arbitrum'],
    tvl: '$3.2B',
    volume24h: '$200M',
    verified: true,
    priority: 'high',
  },
  {
    name: 'Yearn Finance',
    category: 'lending',
    domain: 'yearn.finance',
    chains: ['ethereum', 'arbitrum', 'optimism', 'fantom'],
    tvl: '$5.1B',
    volume24h: '$150M',
    verified: true,
    priority: 'high',
  },
  {
    name: 'Maker',
    category: 'lending',
    domain: 'makerdao.com',
    chains: ['ethereum'],
    tvl: '$8.5B',
    volume24h: '$300M',
    verified: true,
    priority: 'high',
  },
  {
    name: 'Convex Finance',
    category: 'lending',
    domain: 'convexfinance.com',
    chains: ['ethereum'],
    tvl: '$2.3B',
    volume24h: '$100M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Lido',
    category: 'lending',
    domain: 'lido.fi',
    chains: ['ethereum', 'polygon', 'arbitrum'],
    tvl: '$20B',
    volume24h: '$500M',
    verified: true,
    priority: 'critical',
  },
  {
    name: 'Rocket Pool',
    category: 'lending',
    domain: 'rocketpool.net',
    chains: ['ethereum'],
    tvl: '$2.5B',
    volume24h: '$150M',
    verified: true,
    priority: 'medium',
  },
  {
    name: 'Frax Finance',
    category: 'lending',
    domain: 'frax.finance',
    chains: ['ethereum', 'polygon', 'arbitrum', 'optimism'],
    tvl: '$1.8B',
    volume24h: '$100M',
    verified: true,
    priority: 'medium',
  },
]

export function getPlatformsByCategory(category: string): PlatformEntry[] {
  return EXPANDED_PLATFORM_DATABASE.filter(p => p.category === category)
}

export function getPlatformsByCriticality(priority: string): PlatformEntry[] {
  return EXPANDED_PLATFORM_DATABASE.filter(p => p.priority === priority)
}

export function getTotalPlatforms(): number {
  return EXPANDED_PLATFORM_DATABASE.length
}

export function getStats() {
  const byCat: Record<string, number> = {}
  const byPriority: Record<string, number> = {}
  let totalTVL = '$0'
  let totalVolume = '$0'

  for (const platform of EXPANDED_PLATFORM_DATABASE) {
    byCat[platform.category] = (byCat[platform.category] || 0) + 1
    byPriority[platform.priority] = (byPriority[platform.priority] || 0) + 1
  }

  return {
    total: EXPANDED_PLATFORM_DATABASE.length,
    byCategory: byCat,
    byPriority: byPriority,
    critical: getPlatformsByCriticality('critical').length,
    high: getPlatformsByCriticality('high').length,
    medium: getPlatformsByCriticality('medium').length,
    low: getPlatformsByCriticality('low').length,
  }
}
