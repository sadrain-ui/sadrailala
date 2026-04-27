# SKILL-36: SOLANA MEV — JITO BUNDLES & EXTRACTION LANE

SOURCE: https://github.com/solana-labs/solana-web3.js (v2.0)

CATEGORY: SOLANA MEV — Dispatcher / Scout / Closer Sentinels

[STRICT_RULES]
• Use `@solana/web3.js` v2.0 factory pattern ONLY — NEVER use legacy v1 `new Connection()` or `new Transaction()`
• `getLatestBlockhash` MUST be fetched immediately before signing — NEVER cache blockhash >30s (it expires in ~150 slots)
• `sendAndConfirmTransaction` MUST include `{ commitment: 'confirmed' }` — `processed` is insufficient for MEV finality
• Jito bundles: NEVER send more than 5 transactions per bundle — Jito enforces max bundle size limit
• Jito tip MUST be included as last tx in bundle: send SOL to a Jito tip account — no tip = bundle rejected
• `simulateTransaction` MUST be called before any real submission — Solana has no gas estimation like EVM
• NEVER use `skipPreflight: true` in production — always simulate; preflight catches invalid programs
• Blockhash validity = `lastValidBlockHeight` field from `getLatestBlockhash` — monitor and resend before expiry
• Priority fee: use `ComputeBudgetProgram.setComputeUnitPrice(microLamports)` instruction in every tx
• SPL token accounts must exist before transfer — use `getOrCreateAssociatedTokenAccount` pattern or check first

[MENTAL_MODEL]
• Solana tx = list of instructions + recent blockhash + signers; all instructions atomic in one tx
• VersionedTransaction (v0) supports Address Lookup Tables (ALTs) — reduces tx size for complex DeFi ops
• Jito = Solana MEV infrastructure; bundles = ordered set of txs submitted atomically to Jito block engine
• Bundle tip = SOL payment to Jito validator tip account; higher tip = better bundle placement in block
• Jito tip accounts (8 random addresses): pick randomly from list each bundle to avoid detection patterns
• `createSolanaRpc(url)` → RPC client; `createSolanaRpcSubscriptions(wss)` → websocket for slot/sig notifications
• Confirmation levels: `processed` → included but may be rolled back; `confirmed` → 2/3 supermajority; `finalized` → irreversible
• Priority fees: `setComputeUnitPrice` + `setComputeUnitLimit` — both needed for predictable inclusion
• Scout uses `getTokenAccountsByOwner`, `getSignaturesForAddress`; Closer uses `simulateTransaction`, `sendAndConfirmTransaction`

[REAL_API]
=== Solana web3.js v2 Factory Setup ===
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getComputeUnitEstimateForTransactionMessageFactory,
  pipe
} from '@solana/web3.js'

const rpc = createSolanaRpc('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY')
const rpcSubscriptions = createSolanaRpcSubscriptions('wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY')
const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })

=== Fetch and Send (v2) ===
export async function createSolanaDispatcher() {
  async function sendTx(instructions: readonly IInstruction[], signer: KeyPairSigner) {
    // Always fresh blockhash — never cache
    const { value: { blockhash, lastValidBlockHeight } } = await rpc.getLatestBlockhash().send()

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayerSigner(signer, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, msg),
      (msg) => appendTransactionMessageInstructions([
        // Priority fee — always include
        getSetComputeUnitPriceInstruction({ microLamports: 100_000n }),
        ...instructions
      ], msg)
    )

    const signedTx = await signTransactionMessageWithSigners(txMessage)
    return sendAndConfirmTransaction(signedTx, { commitment: 'confirmed' })
  }

  async function getBalance(address: Address): Promise<bigint> {
    const { value } = await rpc.getBalance(address).send()
    return value
  }

  return { sendTx, getBalance }
}

=== Jito Bundle Submission ===
// Jito tip accounts (pick one randomly per bundle)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49'
]

async function submitJitoBundle(txs: VersionedTransaction[], tipLamports: bigint) {
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
  // Tip tx must be last in bundle
  // Submit to Jito block engine endpoint
  const bundleId = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'sendBundle',
      params: [txs.map(tx => Buffer.from(tx.serialize()).toString('base64'))]
    })
  }).then(r => r.json())
  return bundleId.result
}

[LEGION USE CASES]
• Solana arbitrage: Scout monitors Raydium/Orca pool price divergence → Closer executes swap via Jito bundle
• Liquidation: scan mango/drift positions for health < threshold → flash loan + liquidate via Jito bundle
• Priority fee Oracle: `getRecentPrioritizationFees` to calibrate `microLamports` — avoid overpaying for inclusion
• Token account scanner: `getTokenAccountsByOwner` all SPL tokens for target wallets — build position map for Scout
• Bundle profitability: simulate all txs in bundle first → calculate net SOL after tip → submit only if profitable
