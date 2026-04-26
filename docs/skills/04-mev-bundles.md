# SKILL-04: ADVANCED MEV LOGIC
# Source Repos: flashbots/simple-eth-bundle, jito-foundation/jito-relayer
# Priority: 5 (applied after ghost-fail, resilience, stealth, token safety)

## [STRICT_RULES]
```
RULE-04-A: Flashbots auth signer MUST be different from execution signer.
           Auth signer = zero-fund EOA that signs API requests.
           Execution signer = wallet holding assets. NEVER merge these two.

RULE-04-B: eth_callBundle simulation MUST run before eth_sendBundle.
           If simulation shows firstRevert → abort, do NOT submit bundle.
           Bundle submission without simulation = wasted gas + dropped tx.

RULE-04-C: Bundle retry loop: max 5 blocks. Re-sign txs with updated nonce
           on each retry. Never reuse a stale signed tx from block N in block N+3.

RULE-04-D: Jito (Solana): MUST include tip account transfer as LAST instruction.
           tip amount = 1000 lamports minimum. Never submit without tip.

RULE-04-E: NEVER use raw sendTransaction for MEV-sensitive Solana txs.
           Use Jito bundle API. Raw tx = visible in mempool = frontrun.
```

---

## 1. Flashbots EVM Bundle Pattern

```typescript
const FLASHBOTS_RELAY = 'https://relay.flashbots.net'

export async function submitFlashbotsBundle(
  signedTxs: Hex[],
  authSigner: LocalAccount,
  publicClient: PublicClient,
  laneId: string
): Promise<{ bundleHash: Hex; includedBlock?: bigint }> {
  const currentBlock = await publicClient.getBlockNumber()
  
  // GATE: Simulate before submit
  const sim = await simulateFlashbotsBundle(signedTxs, currentBlock + 1n, authSigner)
  if (sim.firstRevert) {
    throw createLegionError({
      code: LegionErrorCode.SIMULATION_REVERT,
      sentinel: 'Ghost',
      laneId,
      cause: sim.firstRevert.revert,
      recoverable: true
    })
  }
  
  // Submit with retry loop
  for (let i = 1; i <= 5; i++) {
    const targetBlock = currentBlock + BigInt(i)
    const bundleHash = await sendBundle(signedTxs, targetBlock, authSigner)
    
    // Wait for target block
    await publicClient.waitForBlock({ blockNumber: targetBlock })
    
    // Check inclusion
    const included = await checkBundleInclusion(signedTxs[0], publicClient)
    if (included) return { bundleHash, includedBlock: targetBlock }
  }
  
  throw createLegionError({
    code: LegionErrorCode.BUNDLE_DROPPED,
    sentinel: 'Ghost',
    laneId,
    recoverable: true
  })
}

async function sendBundle(
  txs: Hex[], targetBlock: bigint, authSigner: LocalAccount
): Promise<Hex> {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'eth_sendBundle',
    params: [{ txs, blockNumber: `0x${targetBlock.toString(16)}` }]
  })
  const sig = await authSigner.signMessage({ message: keccak256(toBytes(body)) })
  const res = await fetch(FLASHBOTS_RELAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Flashbots-Signature': `${authSigner.address}:${sig}`
    },
    body
  })
  return (await res.json()).result.bundleHash
}

async function simulateFlashbotsBundle(
  txs: Hex[], blockNumber: bigint, authSigner: LocalAccount
): Promise<any> {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'eth_callBundle',
    params: [{ txs, blockNumber: `0x${blockNumber.toString(16)}`, stateBlockNumber: 'latest' }]
  })
  const sig = await authSigner.signMessage({ message: keccak256(toBytes(body)) })
  const res = await fetch(FLASHBOTS_RELAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Flashbots-Signature': `${authSigner.address}:${sig}`
    },
    body
  })
  return (await res.json()).result
}
```

## 2. Flashbots Protect RPC (Simple Ghost Lane)

```typescript
import { createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'

// Simplest Ghost Lane — single tx, no bundle needed
export function createGhostWalletClient(
  account: LocalAccount
): WalletClient {
  return createWalletClient({
    chain: mainnet,
    account,
    transport: http('https://rpc.flashbots.net', {
      fetchOptions: {
        headers: { 'X-Flashbots-Builder': 'legion-engine' }
      }
    })
  })
}
```

## 3. Jito Solana Bundle Pattern

```typescript
import { Connection, Transaction, SystemProgram } from '@solana/web3.js'

const JITO_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf'
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  // ... rotate between these
]

export async function submitJitoBundle(
  transactions: Transaction[],
  connection: Connection,
  tipLamports = 10_000
): Promise<string> {
  // Jito Rule: tip MUST be last tx in bundle
  const tipAccount = new PublicKey(
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
  )
  
  const tipTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports
    })
  )
  
  const bundle = [...transactions, tipTx]
  const serialized = bundle.map(tx => tx.serialize().toString('base64'))
  
  const res = await fetch(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [serialized] })
  })
  
  const data = await res.json()
  return data.result  // bundle ID
}
```

## 4. Bundle Profitability Check (Gatekeeper)

```typescript
export function isBundleProfitable(
  simResult: { bundleGasPrice: string; coinbaseDiff: string },
  minProfitWei: bigint
): boolean {
  const profit = BigInt(simResult.coinbaseDiff)
  return profit >= minProfitWei  // Gatekeeper lethality floor
}
```
