# SKILL-19: MEV-SHARE CLIENT (flashbots/mev-share-client-ts)
## SOURCE: https://github.com/flashbots/mev-share-client-ts
## CATEGORY: DNA — MEV Infrastructure

## [STRICT_RULES]
- ALWAYS construct MevShareClient with `new MevShareClient(authSigner, network)` — authSigner is ethers Wallet
- NEVER send raw public transactions — use `sendTransaction(signedTx, options)` for private mempool routing
- ALWAYS set `hints` in TransactionOptions to control what searchers can see (calldata, logs, hash)
- Bundle inclusion MUST specify `inclusion: { block: targetBlock }` — bundles without block target are rejected
- NEVER hardcode network config — use `SupportedNetworks.mainnet` or `SupportedNetworks.goerli`
- SSE stream from `on(eventType, callback)` returns EventSource — ALWAYS call `.close()` to prevent leaks
- `simulateBundle` waits for onchain txs if bundle contains pending tx hashes — add timeout guard
- NEVER re-use bundle params across blocks — stale `inclusion.block` causes silent rejection

## [MENTAL_MODEL]
- MEV-Share = private transaction relay with selective hint disclosure
- Flow: sign tx → sendTransaction (hints) → searchers see hints → searcher backruns → user gets kickback
- Bundle flow: compose BundleParams → sendBundle → get bundleHash → verify inclusion
- EventSource stream: subscribe to pending txs/bundles with `on("transaction", cb)` → filter by hints → build backrun
- SimBundle validates profitability before submission (saves failed bundle gas cost)

## [REAL_API]
```typescript
import MevShareClient, { BundleParams, SupportedNetworks, TransactionOptions } from '@flashbots/mev-share-client'
import { Wallet } from 'ethers'

// Init
const authSigner = new Wallet(process.env.AUTH_PRIVATE_KEY!, provider)
const mevshare = new MevShareClient(authSigner, SupportedNetworks.mainnet)

// Send private tx with hints
const txHash = await mevshare.sendTransaction(signedTx, {
  hints: { calldata: false, logs: true, contractAddress: true, functionSelector: true },
  maxBlockNumber: currentBlock + 25,
})

// Send bundle
const result = await mevshare.sendBundle({
  inclusion: { block: targetBlock, maxBlock: targetBlock + 3 },
  body: [
    { tx: signedTx, canRevert: false },
    { hash: pendingTxHash }, // backrun pending tx
  ],
  privacy: { hints: { logs: true } },
})
// result.bundleHash

// Simulate before sending
const sim = await mevshare.simulateBundle(bundleParams, { parentBlock: currentBlock })
// sim.profit, sim.mevGasPrice

// Subscribe to pending txs
const stream = mevshare.on('transaction', (tx: IPendingTransaction) => {
  // tx.hash, tx.logs, tx.callData, tx.functionSelector
  buildBackrun(tx)
})
// cleanup:
stream.close()

// Event history
const info = await mevshare.getEventHistoryInfo()
const events = await mevshare.getEventHistory({ limit: 50, blockStart: info.minBlock })
```

## [LEGION USE CASES]
- Legion backrun: subscribe stream → detect profitable pending tx → build sandwich/backrun bundle → simulateBundle → sendBundle
- Stealth extraction: sendTransaction with minimal hints (hash only) to hide intent from other searchers
- Bundle profit check: simulateBundle before submission — abort if sim.profit < gasEstimate
- Multi-block retry: sendBundle with maxBlock = targetBlock + 5 for automatic retry on miss
