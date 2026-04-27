# SKILL-34: WALLETCONNECT V2 + RABBY — MASK SENTINEL WALLET LAYER

SOURCES:
- https://github.com/WalletConnect/walletconnect-monorepo (@walletconnect/ethereum-provider)
- https://github.com/RabbyHub/Rabby (Rabby wallet extension)

CATEGORY: WALLET — Mask Sentinel (wallet abstraction layer)

[STRICT_RULES]
• ALWAYS use `@walletconnect/ethereum-provider` (dApp-side EIP-1193) — NEVER use `@walletconnect/sign-client` directly in Legion
• `EthereumProvider.init()` MUST include `projectId`, `chains`, and `metadata` — missing any will throw at runtime
• NEVER call `provider.connect()` without first setting up `display_uri` event listener — QR code is emitted via event
• Session persistence: check `provider.session` on startup — call `provider.connect()` only if session is null
• Chain switching MUST use `wallet_switchEthereumChain` via `provider.request()` — never assume active chain
• ALWAYS create Viem `WalletClient` with `custom(provider)` transport — this is the ONLY WC→Viem bridge
• `provider.disconnect()` MUST be called on cleanup to avoid stale sessions in WalletConnect relay
• Handle `disconnect` event to clear session state — relay can disconnect independently of user action
• `accountsChanged` event MUST trigger re-fetching of all position data — account may have changed
• Rabby: inject detection via `window.rabby` or `window.ethereum.isRabby` — check before WalletConnect fallback

[MENTAL_MODEL]
• WalletConnect v2 = relay protocol enabling mobile/desktop wallet signing via QR code or deeplink
• Mask Sentinel uses WC to connect user's external wallet → provides Viem WalletClient to Dispatcher + Closer
• Flow: `EthereumProvider.init()` → `provider.connect()` → `display_uri` event → show QR → user scans → session established
• Session object = the live WC connection; persists in localStorage; restore with `provider.session` on page reload
• Viem bridge: `createWalletClient({ transport: custom(provider) })` — EIP-1193 `request()` becomes Viem calls
• Rabby = browser extension wallet with built-in security features (tx simulation, approval alerts)
• Rabby detection: `window.ethereum.isRabby === true` or `window.rabby` — inject as EIP-1193 provider
• Multi-wallet strategy: prefer injected Rabby/MetaMask for desktop, WalletConnect for mobile

[REAL_API]
=== WalletConnect + Viem (TypeScript) ===
import EthereumProvider from '@walletconnect/ethereum-provider'
import { createWalletClient, createPublicClient, custom, http } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'

export async function createMaskSentinel(projectId: string) {
  // Init WalletConnect provider
  const provider = await EthereumProvider.init({
    projectId,
    chains: [1],                          // Ethereum mainnet
    optionalChains: [42161, 10, 137],     // Arbitrum, Optimism, Polygon
    showQrModal: true,                    // Built-in QR modal
    metadata: {
      name: 'Legion Engine',
      description: 'Asset Extraction Engine',
      url: 'https://legion.app',
      icons: ['https://legion.app/icon.png']
    }
  })

  // Restore existing session or connect fresh
  async function connect() {
    if (!provider.session) {
      await provider.connect()
    }
    const [address] = await provider.request({ method: 'eth_accounts' }) as string[]
    return address as `0x${string}`
  }

  // Create Viem WalletClient from WC provider (EIP-1193 bridge)
  function getWalletClient(chainId = 1) {
    return createWalletClient({
      chain: chainId === 42161 ? arbitrum : mainnet,
      transport: custom(provider)
    })
  }

  // Chain switching
  async function switchChain(chainId: number) {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }]
    })
  }

  // Event handlers
  provider.on('accountsChanged', (accounts: string[]) => {
    console.log('Accounts changed:', accounts)
    // Re-fetch all position data for new account
  })
  provider.on('chainChanged', (chainId: string) => {
    console.log('Chain changed:', parseInt(chainId, 16))
  })
  provider.on('disconnect', () => {
    console.log('WC session disconnected — clear local session state')
  })

  return { connect, getWalletClient, switchChain, disconnect: () => provider.disconnect() }
}

=== Rabby Detection (Browser) ===
export function detectWalletProvider(): EIP1193Provider | null {
  if (typeof window === 'undefined') return null
  // Prefer Rabby for its built-in security simulation
  if (window.ethereum?.isRabby) return window.ethereum
  // Fallback to MetaMask
  if (window.ethereum?.isMetaMask) return window.ethereum
  // Will fall back to WalletConnect
  return null
}

[LEGION USE CASES]
• Mobile trading: user connects Rabby mobile via WC QR code → Legion Dispatcher submits signed MEV txs
• Multi-device signing: auth wallet on desktop, execution wallet on mobile — separate WC sessions
• Session recovery: on app reload, check `provider.session` and restore silently — no re-scan needed
• Chain-aware routing: `chainChanged` event triggers Dispatcher re-routing to correct network sentinel
• Rabby simulation gate: Rabby shows tx simulation to user before signing — catches malicious txs before Legion submits
