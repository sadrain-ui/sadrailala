# Research: solana-labs/solana-web3.js

**Legion Engine DNA Source**: Sentinel-2 (Scout) — Solana telemetry & execution
**Branch**: latest main (web3.js 2.0 / @solana/web3.js)
**Viem Standard**: Solana side has its own client model; EVM side stays Viem-only

---

## 1. High-Level Architecture

Solana web3.js 2.0 is a complete rewrite from 1.x. Key shift:
- No more monolithic `Connection` class for everything
- Now uses **factory functions** and **composable clients**
- Tree-shakeable, modular, functional design

Core client setup (2.0 style):
- `createSolanaRpc(rpc_url)` — HTTP RPC client
- `createSolanaRpcSubscriptions(wss_url)` — WebSocket subscriptions
- `sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })` — reusable sender

For Legion Engine: model Solana access as a **SolanaClient** wrapper that holds:
- rpc handle
- rpcSubscriptions handle
- sendAndConfirm factory

---

## 2. Core Concepts

| Concept | Role in Legion Engine |
|---|---|
| `createSolanaRpc(url)` | RPC read/write client (replaces Connection for reads) |
| `createSolanaRpcSubscriptions(url)` | WebSocket: tx confirmation, slot updates |
| `PublicKey` | All addresses: wallet, token accounts, programs |
| `Transaction` | Legacy tx format (1.x compat) |
| `VersionedTransaction` | Modern tx with Address Lookup Tables (preferred) |
| `TransactionMessage` / `MessageV0` | Message building for VersionedTransaction |
| `AccountInfo` | Raw account data: lamports, owner, executable, data |
| `ParsedAccountData` | Human-readable parsed token/program data |
| `TokenAmount` | SPL token balance: amount, decimals, uiAmount |
| `SignatureInfo` | Transaction history record |
| `TransactionResponse` | Full confirmed tx details |
| `LAMPORTS_PER_SOL` | Conversion constant: 1 SOL = 1,000,000,000 lamports |

---

## 3. Minimal API Set for Legion Engine

### 3.1 Get SOL Balance
```
rpc.getBalance(publicKey, { commitment: 'confirmed' })
// Returns: { value: lamports (bigint) }
// Normalize: lamports / LAMPORTS_PER_SOL = SOL
```

### 3.2 List Token Accounts (SPL)
```
rpc.getTokenAccountsByOwner(
  walletPubkey,
  { programId: TOKEN_PROGRAM_ID },
  { encoding: 'jsonParsed', commitment: 'confirmed' }
)
// Returns: array of { pubkey, account: { data: { parsed: { info: { mint, owner, tokenAmount } } } } }
// Prefer jsonParsed encoding — no manual deserialization
```

### 3.3 Get Token Balance
```
rpc.getTokenAccountBalance(tokenAccountPubkey, { commitment: 'confirmed' })
// Returns: { value: { amount, decimals, uiAmount, uiAmountString } }
```

### 3.4 Send Transaction (2.0 style)
```
// 1. Get latest blockhash (just-in-time, not cached)
const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash().send()
// 2. Build VersionedTransaction
// 3. Sign
// 4. Send
await sendAndConfirmTransaction(signedTx, { commitment: 'confirmed' })
// Never cache blockhash — freshness is mandatory for signing window
```

### 3.5 Simulate Transaction
```
rpc.simulateTransaction(encodedTx, { encoding: 'base64', commitment: 'confirmed' })
// Returns: { err, logs, unitsConsumed }
// Use BEFORE broadcasting — Legion Engine Simulation Service
```

### 3.6 Confirm Transaction
```
await rpcSubscriptions.signatureNotifications(signature, { commitment: 'finalized' })
// Or: rpc.getSignatureStatuses([signature])
// Use subscription over polling for speed
```

### 3.7 Transaction History
```
rpc.getSignaturesForAddress(pubkey, { limit: 100, commitment: 'confirmed' })
// Returns: SignatureInfo[] with slot, blockTime, err, memo
```

---

## 4. Data Models for Legion Engine

### SolanaAssetSnapshot
```
{
  wallet: string,           // base58 pubkey
  chain: 'solana',
  sol_balance_lamports: bigint,
  sol_balance_usd: number,  // convert via price feed
  token_accounts: [
    {
      pubkey: string,       // token account address
      mint: string,         // token mint address
      amount_raw: string,   // raw amount (no decimals)
      decimals: number,
      ui_amount: number,
      balance_usd: number   // via DefiLlama price
    }
  ],
  scanned_at: string        // ISO timestamp
}
```

### SolanaExecution
```
{
  tx_signature: string,
  blockhash: string,
  last_valid_block_height: number,
  status: 'pending' | 'confirmed' | 'finalized' | 'expired',
  slot: number | null,
  error: string | null
}
```

---

## 5. Backend Patterns for Legion Engine

### 5.1 RPC Adapter Pattern
Wrap `createSolanaRpc` behind a `SolanaRpcAdapter` interface:
- `getBalance(wallet): Promise<bigint>`
- `getTokenAccounts(wallet): Promise<TokenAccount[]>`
- `simulate(tx): Promise<SimResult>`
- `send(tx): Promise<string>` — returns signature
- `confirm(sig): Promise<ConfirmResult>`

This lets Legion Engine swap RPC providers (Helius, QuickNode, etc.) without touching Scout logic.

### 5.2 Chain Shard
Solana worker pool is ISOLATED from EVM pool:
- Blocktime ~400ms vs Ethereum 12s
- Use Solana-specific queue with 400ms tick budget
- Never route Solana ExtractionLanes to EVM workers

### 5.3 Money Normalization
- Always store `lamports` (bigint) internally
- Convert to SOL/USD only at presentation layer or price engine
- For token amounts: store `amount_raw` (string) + `decimals` separately

### 5.4 Blockhash Freshness Rule
- Fetch `getLatestBlockhash` immediately before signing
- NEVER cache blockhash as long-lived state
- `lastValidBlockHeight` defines the signing window — align with Closer's block_deadline

### 5.5 Simulation First
- Always call `simulateTransaction` before `sendAndConfirmTransaction`
- If simulation returns `err`, abort lane — do not broadcast
- Log `unitsConsumed` for gas estimation

---

## 6. Legion Engine Integration Points

| Legion Layer | Solana API Used |
|---|---|
| Scout (telemetry scan) | getBalance, getTokenAccountsByOwner, getSignaturesForAddress |
| Closer (consent payload) | getLatestBlockhash, simulateTransaction |
| Dispatcher (execution) | sendAndConfirmTransaction, signatureNotifications |
| Shadow (simulation defense) | simulateTransaction (dry run only) |
| Gatekeeper (lethality score) | token balances + DefiLlama price feed |

---

## 7. Key Patterns to Copy

1. Factory function model — no global singleton; inject rpc/rpcSubscriptions per service
2. Parsed encoding preferred — avoid manual binary deserialization
3. Commitment levels: use `confirmed` for reads, `finalized` for critical confirmations
4. Separation: build tx intent → simulate → sign → send → confirm (never combined)
5. Subscription-based confirmation (not polling) for speed on 400ms chains
