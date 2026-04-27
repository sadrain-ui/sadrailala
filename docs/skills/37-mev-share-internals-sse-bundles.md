# SKILL-37: MEV-SHARE INTERNALS — SSE EVENT STREAM + mev_sendBundle FULL SPEC

SOURCE: https://github.com/flashbots/mev-share
SPEC: https://github.com/flashbots/mev-share/blob/main/specs/bundles/v0.1.md
CLIENT: https://github.com/flashbots/mev-share-client-ts

CATEGORY: MEV — Flashbots MEV-Share Searcher (Dispatcher Sentinel)

[STRICT_RULES]
• ALWAYS subscribe to SSE stream BEFORE submitting bundles — you need the `txHash` from `IPendingTransaction` to build your backrun
• `hash` field in SSE events is the DOUBLE-HASH of the real tx hash: `keccak256(keccak256(realTxHash))` — NEVER use it as the real hash
• `mev_sendBundle` body entries MUST use `{ hash: pendingTxHash }` (the outer SSE `txs[n].hash`) NOT the double-hashed `hash` field
• `refund[n].bodyIdx` refers to the INDEX in `body[]` that contains the hash tx — always index 0 for simple backruns
• `refundConfig` is set by the USER not the searcher — searcher sets `refund`, user/OFP sets `refundConfig`
• NEVER set `privacy.hints` yourself in `mev_sendBundle` — hints are for OFPs (orderflow providers) sharing info, not searchers receiving it
• `inclusion.maxBlock` MUST be set — leave it as `targetBlock + 3` max; stale bundles waste relay rate limits
• Builder list in `privacy.builders` MUST include `["flashbots", "beaverbuild.org", "rsync", "Titan", "f1b.io"]` for maximum inclusion
• `mev_simBundle` only works with SIGNED txs in `body` — if your bundle contains `{ hash: ... }`, simulation is unavailable without the matched tx
• ALWAYS gate bundle submission on profitability: `coinbaseDiff >= minProfitWei + estimatedGasCost` before sending

[MENTAL_MODEL]
• MEV-Share = orderflow auction: users share hints about pending txs → searchers backrun them → users get 90% refund of MEV generated
• SSE stream endpoint: `https://mev-share.flashbots.net` — persistent HTTP GET, events are newline-delimited JSON
• `IPendingTransaction.txs[n].hash` = the inner tx hash you USE in bundles; `IPendingTransaction.hash` = double-hash (don't use for bundles)
• Flow: listen SSE → see pending swap → decode `functionSelector` + `logs` → estimate backrun profit → submit `mev_sendBundle` with hash + your backrun tx
• Hints available per-event (depends on user privacy settings): `calldata`, `contract_address`, `function_selector`, `logs`, `hash` — you only see what's disclosed
• `refund.percent` = minimum % of bundle profit that must go back to the user tx — if your bundle is included by another searcher, they pay this %
• Nested bundles: your bundle can contain another bundle object — enables composability and "bundle of bundles"
• `mev_simBundle`: simulates matched state — use AFTER a match is confirmed to check profitability; requires all txs to be signed (no hash entries)
• Builder inheritance: nested bundle's `privacy.builders` is INTERSECTION of outer + inner lists — more nesting = more restricted builder set

[REAL_API]
=== SSE Event Stream ===
// Endpoint
// GET https://mev-share.flashbots.net  (mainnet)
// GET https://mev-share-sepolia.flashbots.net  (Sepolia)
// Auth: Authorization: Bearer <YOUR_API_KEY>  (optional for reading)

// IPendingTransaction schema (every SSE event)
interface IPendingTransaction {
  hash: string          // keccak256(keccak256(realTxHash)) — DOUBLE HASH — DO NOT USE in bundles
  logs?: Array<{
    address: string     // emitting contract address
    topics: string[]    // event topic array
    data: string        // ABI-encoded event data
  }>
  txs: Array<{
    hash?: string            // REAL inner tx hash — USE THIS in your bundle body
    to?: string              // recipient (only if disclosed)
    from?: string            // sender (only if disclosed)
    callData?: string        // full calldata (only if disclosed)
    functionSelector?: string // 4-byte selector (only if disclosed)
    value?: string           // ETH value in hex wei
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
    nonce?: string
    gas?: string
    chainId?: string
    accessList?: Array<{ address: string; storageKeys: string[] }>
  }>
}

=== Subscribe + Backrun Pattern ===
import MevShareClient, { IPendingTransaction, BundleParams } from '@flashbots/mev-share-client'
import { Wallet } from 'ethers'  // auth signer only — zero-fund EOA
import { createWalletClient, http, parseGwei } from 'viem'
import { mainnet } from 'viem/chains'

const authSigner = new Wallet(process.env.AUTH_SIGNER_KEY!)  // NEVER the execution key
const mevShare = MevShareClient.useEthereumMainnet(authSigner)

// Subscribe to pending tx stream
const txHandler = mevShare.on('transaction', async (tx: IPendingTransaction) => {
  const pendingTxHash = tx.txs[0]?.hash
  if (!pendingTxHash) return  // no hash disclosed — can't backrun

  // Decode hint to check if it's a swap we can backrun
  const isSwap = tx.txs[0]?.functionSelector === '0x5c11d795'  // swapExactTokensForTokens
  if (!isSwap) return

  // Build profitability check
  const targetBlock = await viemClient.getBlockNumber() + 1n
  const myBackrunTx = await buildBackrun(pendingTxHash)  // your signed execution tx
  if (!myBackrunTx.profitable) return

  // Submit mev_sendBundle
  const bundleParams: BundleParams = {
    inclusion: {
      block: targetBlock,          // target block (hex string internally)
      maxBlock: targetBlock + 3n,  // expire after 3 blocks
    },
    body: [
      { hash: pendingTxHash },     // user pending tx — MUST be txs[0].hash from SSE event
      { tx: myBackrunTx.signed, canRevert: false }  // your signed backrun
    ],
    validity: {
      refund: [{ bodyIdx: 0, percent: 10 }]  // 10% of bundle profit refunded to user tx at idx 0
      // refundConfig is set by the USER — searcher does NOT set this
    },
    privacy: {
      builders: ['flashbots', 'beaverbuild.org', 'rsync', 'Titan', 'f1b.io']
    }
  }

  const result = await mevShare.sendBundle(bundleParams)
  console.log('Bundle sent:', result.bundleHash)
})

=== mev_sendBundle Raw JSON-RPC (what the SDK wraps) ===
// POST https://relay.flashbots.net
// Headers: Authorization: <addr:sig>  (X-Flashbots-Signature for legacy, Authorization for MEV-Share)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "mev_sendBundle",
  "params": [{
    "version": "beta-1.0",
    "inclusion": { "block": "0x12F5A0", "maxBlock": "0x12F5A3" },
    "body": [
      { "hash": "0xPENDING_TX_HASH" },
      { "tx": "0xSIGNED_RAW_TX_HEX", "canRevert": false }
    ],
    "validity": {
      "refund": [{ "bodyIdx": 0, "percent": 10 }]
    },
    "privacy": {
      "hints": { "txHash": true },
      "builders": ["flashbots", "beaverbuild.org"]
    }
  }]
}

=== mev_simBundle (simulate matched bundle) ===
// Only works when ALL body entries are signed txs (no hash entries)
// Use AFTER match to verify profitability
const simResult = await mevShare.simBundle(bundleParams, {
  parentBlock: targetBlock - 1n
})
// simResult.profit = coinbaseDiff in wei
// simResult.mevGasPrice = effective gas price of bundle

=== Historical Event Stream (for backtesting) ===
// GET https://mev-share.flashbots.net/api/v1/history
// Query params: blockStart, blockEnd, timestampStart, timestampEnd, limit (max 500), offset
// GET /api/v1/history/info  → { count, minBlock, maxBlock, minTimestamp, maxTimestamp }

[LEGION USE CASES]
• Real-time backrun loop: SSE stream → decode functionSelector → match to known Uniswap V2/V3 swap selectors → compute backrun delta → submit bundle
• Profit gating: `simBundle` after seeing functionSelector match → only submit if `simResult.profit > minProfitThreshold`
• Bundle targeting: set `privacy.builders = ["flashbots"]` for reliability; add more builders only if inclusion rate drops below 30%
• OFP integration: Legion registers as Orderflow Provider to share internal trade flow → earns refundConfig rewards from other searchers' bundles
• Historical backtest: pull `/api/v1/history` for past 1000 blocks → replay events → test if strategy would have been profitable
• Double-hash verification: `keccak256(keccak256(tx.hash_from_etherscan))` should equal `IPendingTransaction.hash` — verify your stream parsing
