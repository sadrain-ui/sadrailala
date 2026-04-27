# SKILL-14: MEV-SHARE GHOST EXECUTION (DNA Layer — Private Bundle Execution)
# Source: github.com/flashbots/mev-share-client-ts (src/client.ts, src/index.ts)
# Scanned: Real MevShareClient methods from client.ts — NOT generic
# Priority: DNA-4 (all MEV ops in Legion use private relay, never public mempool)

## [STRICT_RULES]
```
RULE-14-A: NEVER broadcast MEV transactions to public mempool. ALWAYS use sendBundle().
            Public mempool = frontrun in same block. MEV-Share = private relay.
            Source: MevShareClient.sendBundle(params: BundleParams): Promise<ISendBundleResult>

RULE-14-B: Use sendTransaction() for single private txs (NOT sendBundle).
            sendBundle = multiple atomically linked txs. sendTransaction = single private tx.
            Source: MevShareClient.sendTransaction(signedTx, options?: TransactionOptions)

RULE-14-C: Order-flow hints: set HintPreferences to reveal MINIMUM viable info.
            More hints = more searcher competition = less exclusive fill window.
            Recommended: reveal hash only. NEVER reveal full calldata unless necessary.

RULE-14-D: Check SimBundleResult before sending live bundle.
            simulateBundle() must return SUCCESS before sendBundle() is called.
            Source: SimBundleResult, ISimBundleResult types in index.ts exports

RULE-14-E: Bundle targeting: set blockNumber = await getBlockNumber() + 1.
            Targeting wrong block = bundle dropped silently. Always target NEXT block.
```

## [MENTAL_MODEL]
```
Legion MEV execution flow:
  Build txs (swap/liquidation/arb)
    |
  simulateBundle() -> must succeed
    |
  sendBundle({ body: signedTxs, inclusion: { block: nextBlock } })
    |
  Flashbots relay -> validator -> included atomically or NOT AT ALL
    |
  No frontrun possible (private). No partial fill possible (atomic).

Key guarantee: atomic inclusion or complete exclusion. Zero partial-state risk.
```

## [REAL API — from client.ts source scan]
```typescript
import MevShareClient, {
  BundleParams,
  IPendingBundle,
  IPendingTransaction,
  SupportedNetworks
} from '@flashbots/mev-share-client'
import { Wallet, JsonRpcProvider } from 'ethers'

// Setup
const provider = new JsonRpcProvider('https://mainnet.infura.io/v3/KEY')
const authSigner = new Wallet(process.env.FLASHBOTS_AUTH_KEY!, provider)
const mevShare = MevShareClient.useEthereumMainnet(authSigner)

// RULE-14-D: simulate first
async function simulateBeforeSend(signedTxs: string[]): Promise<boolean> {
  const blockNumber = await provider.getBlockNumber()
  try {
    const sim = await mevShare.simulateBundle({
      body: signedTxs.map(tx => ({ tx, canRevert: false })),
      inclusion: { block: blockNumber + 1 }
    })
    return sim.success ?? false
  } catch {
    return false
  }
}

// RULE-14-A + RULE-14-E: private bundle
async function sendPrivateBundle(
  signedTxs: string[],
  targetBlockOffset: number = 1
): Promise<string> {
  const blockNumber = await provider.getBlockNumber()

  // RULE-14-D: simulate first
  const ok = await simulateBeforeSend(signedTxs)
  if (!ok) throw new Error('Bundle simulation failed — aborting')

  const result = await mevShare.sendBundle({
    body: signedTxs.map(tx => ({ tx, canRevert: false })),
    inclusion: { block: blockNumber + targetBlockOffset } // RULE-14-E
  })
  return result.bundleHash
}

// RULE-14-B: single private tx
async function sendPrivateTx(signedTx: string): Promise<string> {
  return mevShare.sendTransaction(signedTx, {
    hints: {
      // RULE-14-C: minimum viable hints
      hash: true,
      calldata: false,
      logs: false,
      functionSelector: false
    }
  })
}

// Stream pending bundles (for order-flow monitoring)
function watchOrderFlow(
  onBundle: (bundle: IPendingBundle) => void,
  onTx: (tx: IPendingTransaction) => void
) {
  mevShare.on('bundle', onBundle)
  mevShare.on('transaction', onTx)
}
```

## [LEGION USE CASES]
```
- Arbitrage bundles: sendBundle([swapTx, rebalanceTx]) atomically
- Liquidations: sendBundle([flashloanTx, liquidateTx, repayTx])
- Backrunning: sendBundle([targetTx, legionArbTx]) ordered
- Private single tx: sendTransaction for non-MEV sensitive ops
```
