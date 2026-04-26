# WalletConnect Logic-Map — Legion Engine Integration

## 1. Role in Legion Engine
- **Primary Sentinel**: Mask (wallet abstraction layer)
- **Function**: Multi-wallet connection protocol via QR/deeplink; EIP-1193 provider bridge
- **Legion Use-Case**: Mask sentinel uses WalletConnect v2 to connect EOA wallets (mobile or desktop) as signers; the WC session provides a Viem-compatible WalletClient for Dispatcher + Closer

---

## 2. Core Architecture

### 2.1 WalletConnect v2 Stack
```
@walletconnect/web3wallet          → wallet-side SDK (not used in Legion)
@walletconnect/ethereum-provider   → dApp-side EIP-1193 provider (Legion uses this)
@walletconnect/sign-client         → low-level session management

Legion uses: @walletconnect/ethereum-provider
  └── wraps sign-client internally
  └── exposes EIP-1193: request(), on(), off()
  └── compatible with Viem custom transport
```

### 2.2 Connection Flow
```
Mask.init()
  └── EthereumProvider.init({ projectId, chains, metadata })
        └── provider.connect()
              └── emit 'display_uri' → show QR code
              └── wallet scans → session established
              └── provider.accounts[] → connected addresses
              └── wrap in Viem custom transport → WalletClient ready
```

---

## 3. Key Data Models

### 3.1 EthereumProvider Config
```typescript
type WCProviderConfig = {
  projectId: string              // WalletConnect Cloud project ID
  chains: number[]               // required chains (EVM chain IDs)
  optionalChains?: number[]      // optional additional chains
  showQrModal: boolean           // true for browser, false for headless
  metadata: {
    name: string
    description: string
    url: string
    icons: string[]
  }
  rpcMap?: Record<number, string> // custom RPC per chain
}
```

### 3.2 Session Object
```typescript
type WCSession = {
  topic: string                  // unique session identifier
  namespaces: {
    eip155: {
      accounts: string[]         // 'eip155:1:0x...' format
      methods: string[]          // allowed methods
      events: string[]           // allowed events
    }
  }
  expiry: number                 // Unix timestamp
  acknowledged: boolean
}
```

---

## 4. Critical Integration Patterns

### 4.1 Provider Init + Viem WalletClient (Mask Pattern)
```typescript
import { EthereumProvider } from '@walletconnect/ethereum-provider'
import { createWalletClient, custom } from 'viem'

async function initMask(config: WCProviderConfig): Promise<WalletClient> {
  const provider = await EthereumProvider.init({
    projectId: config.projectId,
    chains: config.chains,
    showQrModal: config.showQrModal,
    metadata: config.metadata,
  })

  // Listen for URI (display QR code or return URI to frontend)
  provider.on('display_uri', (uri: string) => {
    emitToFrontend('wc:uri', uri)  // frontend-agnostic event
  })

  await provider.connect()

  // Wrap as Viem WalletClient — single standard for Dispatcher/Closer
  const walletClient = createWalletClient({
    transport: custom(provider)   // EIP-1193 → Viem bridge
  })

  return walletClient
}
```

### 4.2 Chain Switching (Multi-chain Extraction)
```typescript
// Switch active chain for cross-chain extraction sequence
async function switchChain(provider: EthereumProvider, chainId: number): Promise<void> {
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: `0x${chainId.toString(16)}` }]
  })
}
// After switch: walletClient.chain auto-updates via provider
```

### 4.3 Session Persistence (Sovereign Sync)
```typescript
// WC sessions survive page reloads via localStorage
async function restoreSession(provider: EthereumProvider): Promise<boolean> {
  const sessions = provider.session  // restored from localStorage automatically
  if (sessions) {
    // Re-connect without re-pairing
    await provider.connect({ pairingTopic: sessions.pairingTopic })
    return true
  }
  return false
}
```

### 4.4 Disconnect + Cleanup
```typescript
async function disconnectMask(provider: EthereumProvider): Promise<void> {
  await provider.disconnect()
  // Clears session from localStorage
  // Mask sentinel: mark session as terminated, abort active Ghost Lanes
}
```

### 4.5 Event Handling
```typescript
provider.on('accountsChanged', (accounts: string[]) => {
  // Mask: update active signer, re-validate Gatekeeper lethality score
})

provider.on('chainChanged', (chainId: string) => {
  // Mask: update active chain, re-route pending Extraction Lane
})

provider.on('disconnect', (error: any) => {
  // Mask: abort all active lanes, trigger failsafe (Shadow)
})

provider.on('session_update', ({ namespaces }) => {
  // Mask: check if approved chains changed, re-init if needed
})
```

---

## 5. Legion Sentinel Matrix

| Sentinel | WalletConnect Usage |
|---|---|
| Mask | `EthereumProvider.init()` → `createWalletClient(custom(provider))` — core wallet abstraction |
| Closer | `walletClient.signTypedData()` via WC provider (EIP-712 permit signing) |
| Dispatcher | `walletClient.sendTransaction()` via WC provider (tx broadcast) |
| Gatekeeper | check `provider.accounts[0]` balance before approving extraction |
| Shadow | on `disconnect` event → abort Extraction Lane, no orphaned signature |
| Scout | no WC usage — Scout uses PublicClient with direct RPC, no wallet needed |

---

## 6. Frontend-Agnostic URI Delivery

```typescript
// Legion backend emits WC URI via SSE or WebSocket — never renders QR itself
app.get('/api/wc/connect', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  
  provider.on('display_uri', (uri: string) => {
    res.write(`data: ${JSON.stringify({ type: 'wc:uri', uri })}\n\n`)
  })
  
  await provider.connect()
  res.write(`data: ${JSON.stringify({ type: 'wc:connected', accounts: provider.accounts })}\n\n`)
  res.end()
})
// Frontend (web/mobile/CLI) renders QR from URI independently
```

---

## 7. Key Patterns to Copy

1. Always use `showQrModal: false` in headless/backend mode — emit URI to frontend via SSE
2. Use `custom(provider)` Viem transport — single WalletClient interface for all sentinels
3. Persist session via `provider.session` — avoid re-pairing on every startup (Sovereign Sync)
4. Listen to `disconnect` event — immediately abort Ghost Lanes to prevent orphaned txs
5. Use `optionalChains` for all target chains — required chains must be pre-approved by wallet
6. `wallet_switchEthereumChain` before each cross-chain extraction step
7. Never store raw private keys — WC is signer-only, Mask delegates signing to user device

---

## 8. Supported Wallets (via WC v2)

```
MetaMask Mobile     ✅
Rainbow             ✅
Coinbase Wallet     ✅
Trust Wallet        ✅
Ledger Live         ✅ (via WC transport)
Safe Mobile         ✅
Argent              ✅
ImToken             ✅
Phantom (EVM)       ✅
```

---

## 9. Error Handling

```typescript
try {
  await provider.connect()
} catch (err: any) {
  if (err.message.includes('User rejected')) {
    // Mask: user denied pairing — emit rejection event to frontend
  }
  if (err.message.includes('Pairing expired')) {
    // Re-init provider, generate new URI
  }
  if (err.message.includes('Session settlement failed')) {
    // WC relay issue — retry with backoff
  }
}
```
