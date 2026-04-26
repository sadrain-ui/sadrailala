# Flashbots Logic-Map — Legion Engine Integration

## 1. Role in Legion Engine
- **Primary Sentinel**: Ghost (private tx routing) + Dispatcher (MEV-protected execution)
- **Function**: Private transaction relay that bypasses public mempool; prevents frontrunning and sandwich attacks
- **Legion Use-Case**: Dispatcher uses Flashbots Protect RPC or Bundle API to submit extraction transactions privately; Ghost Lane = Flashbots-routed tx; MEV-Share for order flow revenue

---

## 2. Core Architecture

### 2.1 Three Flashbots Services
```
1. Flashbots Protect RPC
   ├── Endpoint: https://rpc.flashbots.net
   ├── Drop-in replacement for public RPC
   ├── Private mempool, MEV refund, frontrun protection
   └── Ethereum mainnet only

2. Flashbots Bundle API (eth_sendBundle)
   ├── Endpoint: https://relay.flashbots.net
   ├── Atomic tx bundles — all succeed or all revert
   ├── Target specific block numbers
   └── Requires X-Flashbots-Signature header (signed by EOA)

3. MEV-Share (already documented in mev-share.md)
   └── Orderflow auction for partial MEV refund
```

### 2.2 Ghost Lane: Protect RPC Pattern
```
Dispatcher → walletClient (Protect RPC transport)
  └── sendTransaction → routes through Flashbots relay
        └── never enters public mempool
        └── included in next available block or dropped
        └── Shadow monitors tx hash for inclusion
```

---

## 3. Key Data Models

### 3.1 Bundle Request
```typescript
type FlashbotsBundle = {
  txs: Hex[]             // signed raw transactions (RLP encoded)
  blockNumber: Hex       // target block '0x...' in hex
  minTimestamp?: number  // Unix timestamp window start
  maxTimestamp?: number  // Unix timestamp window end
  revertingTxHashes?: Hex[] // allow specific txs to revert
}

type BundleResponse = {
  bundleHash: Hex        // unique bundle identifier
  // OR error if relay rejected
}
```

### 3.2 Simulation Request
```typescript
type SimulateRequest = {
  txs: Hex[]             // signed txs to simulate
  blockNumber: Hex       // block context for simulation
  stateBlockNumber?: string // 'latest' or specific block
  timestamp?: number
}

type SimulateResult = {
  bundleGasPrice: string
  bundleHash: Hex
  coinbaseDiff: string   // miner payment
  ethSentToCoinbase: string
  gasFees: string
  results: TxResult[]    // per-tx simulation results
  totalGasUsed: number
  firstRevert?: TxResult // first reverting tx if any
}
```

---

## 4. Critical Integration Patterns

### 4.1 Protect RPC — Simplest Ghost Lane
```typescript
import { createPublicClient, createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'

// Ghost Lane: swap public RPC for Flashbots Protect
const ghostTransport = http('https://rpc.flashbots.net', {
  fetchOptions: {
    headers: {
      // Optional: identify for MEV refund tracking
      'X-Flashbots-Builder': 'legion-engine'
    }
  }
})

const ghostWalletClient = createWalletClient({
  chain: mainnet,
  transport: ghostTransport,
  account: signerAccount
})

// Dispatcher: same sendTransaction call, private routing
const txHash = await ghostWalletClient.sendTransaction({
  to: targetContract,
  data: calldata,
  value: 0n
})
```

### 4.2 Bundle API — Atomic Multi-Tx Extraction
```typescript
const FLASHBOTS_RELAY = 'https://relay.flashbots.net'

async function sendBundle(
  signedTxs: Hex[],
  targetBlock: bigint,
  authSigner: LocalAccount
): Promise<string> {
  const bundle = {
    jsonrpc: '2.0',
    method: 'eth_sendBundle',
    params: [{
      txs: signedTxs,
      blockNumber: `0x${targetBlock.toString(16)}`,
    }],
    id: 1
  }

  const body = JSON.stringify(bundle)
  
  // Flashbots requires request signed by auth signer (any EOA)
  const signature = await authSigner.signMessage({ message: keccak256(toBytes(body)) })

  const res = await fetch(FLASHBOTS_RELAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Flashbots-Signature': `${authSigner.address}:${signature}`
    },
    body
  })

  const data = await res.json()
  return data.result.bundleHash
}
```

### 4.3 Pre-Bundle Simulation (Shadow Pattern)
```typescript
async function simulateBundle(
  signedTxs: Hex[],
  blockNumber: bigint,
  authSigner: LocalAccount
): Promise<SimulateResult> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_callBundle',
    params: [{
      txs: signedTxs,
      blockNumber: `0x${blockNumber.toString(16)}`,
      stateBlockNumber: 'latest'
    }],
    id: 1
  })

  const signature = await authSigner.signMessage({ message: keccak256(toBytes(body)) })
  
  const res = await fetch(FLASHBOTS_RELAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Flashbots-Signature': `${authSigner.address}:${signature}`
    },
    body
  })

  return (await res.json()).result
}

// Shadow: always simulate before bundle submission
async function safeBundleSend(txs: Hex[], targetBlock: bigint, authSigner: LocalAccount) {
  const sim = await simulateBundle(txs, targetBlock, authSigner)
  if (sim.firstRevert) throw new Error(`Bundle would revert: ${sim.firstRevert.revert}`)
  if (BigInt(sim.bundleGasPrice) < MIN_GAS_PRICE) throw new Error('Bundle not profitable')
  return sendBundle(txs, targetBlock, authSigner)
}
```

### 4.4 Bundle Inclusion Monitoring
```typescript
// Shadow monitors bundle status — retry if not included
async function monitorBundle(
  bundleHash: Hex,
  targetBlock: bigint,
  publicClient: PublicClient,
  maxBlocks = 5
): Promise<'included' | 'dropped'> {
  for (let i = 0; i < maxBlocks; i++) {
    await publicClient.waitForBlock({ blockNumber: targetBlock + BigInt(i) })
    
    const receipt = await checkBundleStatus(bundleHash)
    if (receipt.isIncluded) return 'included'
  }
  return 'dropped'  // re-submit or abort Ghost Lane
}
```

---

## 5. Legion Sentinel Matrix

| Sentinel | Flashbots Usage |
|---|---|
| Ghost/Dispatcher | Protect RPC as Viem transport OR Bundle API for atomic multi-tx |
| Shadow | `eth_callBundle` simulation before any bundle submission |
| Gatekeeper | check `bundleGasPrice` ≥ profitability threshold before approving submission |
| Scout | no Flashbots — Scout is read-only, no tx submission |
| Mask | sign raw tx for bundle via `walletClient.signTransaction()` |
| Closer | include approval tx as first tx in bundle (atomic approve+swap) |

---

## 6. Signing Architecture

```typescript
// TWO separate signers in Legion:
// 1. Auth Signer — signs Flashbots API requests (can be any EOA, no funds needed)
// 2. Execution Signer — signs the actual txs inside the bundle

const authSigner = privateKeyToAccount(process.env.FB_AUTH_PRIVATE_KEY as Hex)
const executionSigner = getConnectedWalletClient()  // from Mask/WalletConnect

// Auth signer never holds funds, just authenticates with relay
// Execution signer holds assets being extracted
```

---

## 7. Key Patterns to Copy

1. Use Protect RPC for simple single-tx extractions — zero code change from normal sendTransaction
2. Use Bundle API for multi-step atomic extractions (approve + swap in one bundle)
3. Always `eth_callBundle` simulate before `eth_sendBundle` — never blindly submit
4. Target `currentBlock + 1` as bundle target; retry for next 3-5 blocks if not included
5. Auth signer is NOT execution signer — separate key with zero funds
6. `revertingTxHashes` allows partial-success bundles (e.g., secondary tx can fail)
7. Monitor bundle via block polling, not relay API — relay doesn't guarantee status updates

---

## 8. Chain Support

```
Service              | Ethereum | Other chains
Flashbots Protect    | ✅        | ❌ (ETH only)
Bundle API           | ✅        | ❌ (ETH only)
MEV-Share            | ✅        | ❌ (ETH only)

For L2s: use chain-specific private mempools
  Arbitrum → no private mempool needed (sequencer handles ordering)
  Optimism → mev-blocker.io as alternative
  Polygon  → Polygon private RPC or Bor direct submission
```

---

## 9. Error Handling

```typescript
const FB_ERRORS: Record<string, string> = {
  '-32602': 'Invalid bundle params — check tx encoding',
  '-32603': 'Bundle failed simulation on relay side',
  'nonce too low': 'Nonce conflict — re-fetch nonce before retry',
  'intrinsic gas too low': 'Gas limit too low for tx',
}

// Bundle dropped (not included) is NOT an error — retry logic:
async function bundleWithRetry(txs: Hex[], authSigner: LocalAccount, maxRetries = 5) {
  const currentBlock = await publicClient.getBlockNumber()
  for (let i = 1; i <= maxRetries; i++) {
    const hash = await sendBundle(txs, currentBlock + BigInt(i), authSigner)
    const result = await monitorBundle(hash, currentBlock + BigInt(i), publicClient, 2)
    if (result === 'included') return hash
    // Re-sign txs with updated nonce if needed before next attempt
  }
  throw new Error('Bundle not included after max retries — aborting Ghost Lane')
}
```
