---
title: "Solana"
chain_family: "SVM"
resource_model: "Compute"
signing_model: "Ed25519"
cross_chain_capable: false
cursor_use: "Logic reference for Scout/Closer/Dispatcher (Solana shard)"
---

# Solana

## Legion Relevance

Solana is the canonical SVM shard for Legion. Scout subscribes to slot and
account-change feeds to detect opportunities; Dispatcher selects an RPC and a
route (often via Jupiter); Closer assembles, signs, and submits the
versioned transaction; Archivist captures the resulting signature, slot, and
compute consumption. Because Solana's resource model, signing scheme, and
finality semantics are all incompatible with EVM, the Solana shard is a
first-class chain family in `chain_registry`, not an EVM-shaped column
overload.

The performance envelope is also fundamentally different. A Solana strike is
expected to land in 400–800 ms with sub-cent fees in the common case, but
landing under congestion requires correct compute-unit pricing, fresh
blockhashes, and an Address Lookup Table strategy. Mistakes in any of those
silently shift a strike from "lands" to "expires," which the Closer must
distinguish from a true revert.

## Account Model

Solana has no smart-contract storage in the EVM sense. **Every piece of
state lives in an account**, identified by a 32-byte Ed25519 public key
(displayed as base58). An account has:

- `lamports` — balance in lamports (1 SOL = 10^9 lamports).
- `owner` — the program (32-byte pubkey) that may mutate this account's
  data. A user's "wallet" is owned by the System Program; an SPL token
  account is owned by the Token Program.
- `data` — opaque byte array; layout is defined by the owning program.
- `executable` — true if the account is a program.
- `rent_epoch` — legacy; modern accounts are rent-exempt by holding a
  minimum lamport balance.

Programs are stateless. They read and write the accounts passed into each
instruction. This makes transactions explicit about every account they
touch — there is no implicit state lookup mid-execution.

**SPL token accounts** are separate from the wallet that owns them. A user's
USDC balance lives in an *associated token account* derived deterministically
from `(owner_pubkey, mint_pubkey)`. The Closer must derive and (if missing)
create the destination ATA before any token transfer; this is a non-trivial
extra instruction that EVM does not have.

## Versioned Transactions

A Solana transaction is `(signatures, message)`. Legion uses **versioned
transactions** (V0) exclusively; legacy transactions cannot reference Address
Lookup Tables and are unsuitable for any non-trivial DEX route.

A V0 message contains:

- `version` — `0`.
- `header` — counts of (required signers, readonly signers, readonly
  non-signers).
- `staticAccountKeys` — explicit pubkeys, one of which is the fee payer
  (index 0 is always the fee payer).
- `recentBlockhash` — see below.
- `compiledInstructions` — each is `(programIdIndex, accountKeyIndexes,
  data)`. Indexes refer into the combined static + lookup-table key list.
- `addressTableLookups` — references to ALTs and the indexes within them.

Maximum serialized size is **1232 bytes** (the MTU minus headers). This is
the binding constraint on route complexity; ALT usage and account-key reuse
are the primary levers for staying under it.

## Message Structure & Account Indexing

The order in `staticAccountKeys` (and in the merged static+ALT key set) is
load-bearing: every instruction's `accountKeyIndexes` is interpreted against
this combined order. The Closer never hand-rolls the index — Jupiter or the
program SDK emits the instruction with full pubkeys, and the
`MessageV0.compile()` step assigns indexes. Manually rewriting an
instruction's account list after compilation desynchronizes the indexes and
produces a transaction that signs cleanly but executes against the wrong
accounts.

## Blockhash & Replay

`recentBlockhash` is the transaction's freshness anchor and replay guard. A
blockhash is valid for **150 slots** (~60 s on mainnet). After expiry, the
transaction is rejected with `BlockhashNotFound` — it does not land late, it
disappears.

The Dispatcher fetches `getLatestBlockhash` with the `processed` or
`confirmed` commitment immediately before the Closer signs. Strategies the
Closer applies:

- **Pre-flight skip + retry** for low-latency strikes: skip simulation, send
  immediately, re-fetch blockhash + re-sign + re-send if the network drops
  the tx before landing.
- **Durable nonce** for strikes that may sit in a queue longer than 60 s
  (cross-chain settlement, scheduled rebalance). A nonce account decouples
  freshness from wall-clock and is the only way to sign-now-send-later
  safely.

Replay protection is implicit in the (blockhash, signature) pair: a
transaction with the same blockhash and signature is rejected as a
duplicate. There is no nonce-per-account in the EVM sense.

## Compute Units & Priority Fees

Every Solana transaction has two fee components:

1. **Base fee** — 5000 lamports per signature, fixed.
2. **Priority fee** — `compute_unit_price` (microlamports per CU) ×
   `compute_unit_limit` (CUs requested), set via
   `ComputeBudgetProgram.setComputeUnitPrice` and `setComputeUnitLimit`
   instructions.

Default CU limit per transaction is 200k; default per-block per-account
write-lock CU is 12M. Complex Jupiter routes routinely need 600k–1.4M CUs
and **must** call `setComputeUnitLimit` explicitly — without it, the tx
runs out of CUs mid-execution and the strike fails wasting the priority fee.

The Dispatcher's priority fee model:

- Sample `getRecentPrioritizationFees` over the writable accounts the tx
  touches (the *write-lock contention* dimension that matters, not a global
  median).
- Pick a percentile based on Scout's urgency tag (p50 for opportunistic,
  p90+ for time-critical).
- Cap the absolute fee in lamports against the strike's expected profit so
  a runaway congestion event can't burn the trade.

## RPC

Solana RPC is JSON-RPC over HTTP and a parallel WebSocket interface
(`createSolanaRpcSubscriptions`). Operations Scout and Dispatcher rely on:

- `getSlot`, `getLatestBlockhash`, `getEpochInfo` — clock and freshness.
- `getAccountInfo`, `getMultipleAccounts`, `getProgramAccounts` — state.
  `getProgramAccounts` is expensive and must be used with `dataSlice` and
  `filters`; many providers gate it.
- `simulateTransaction` — pre-flight; returns CU consumed, logs, and any
  program error. Closer uses this to set the CU limit and to catch
  "InsufficientFundsForRent" before broadcast.
- `sendTransaction` — submit. With `skipPreflight: true` for hot paths.
- `getSignatureStatuses` and the `signatureSubscribe` WebSocket — landing
  confirmation. Polling without WS adds 100–400 ms of latency.
- `getRecentPrioritizationFees` — priority-fee oracle scoped to a set of
  writable accounts.

Commitment levels: `processed` (single confirmation, fastest, may revert),
`confirmed` (supermajority vote, ~1–2 s, safe for trade decisions),
`finalized` (max lockout, ~13 s, archival). Closer reports at `confirmed`
and re-confirms at `finalized` for the Archivist record.

## Address Lookup Tables (ALT)

ALTs are on-chain accounts holding up to 256 pubkeys each. A V0 transaction
references ALT entries by `(table_pubkey, [indexes])`, costing 1 byte per
index in the message versus 32 bytes per pubkey in `staticAccountKeys`. For
a Jupiter route touching 30+ pools, ALTs are the only way to fit under the
1232-byte limit.

Two ALT sources:

- **Aggregator-provided** — Jupiter's `/swap-instructions` returns a list of
  `addressLookupTableAddresses` to use. The Closer fetches each ALT account,
  decodes it, and passes them to `MessageV0.compile()`. **Always extend ALT
  accounts via `getMultipleAccounts`, not via stale cached deserializations
  — ALTs can have entries appended.**
- **Engine-owned** — Legion may publish its own ALT for hot accounts (e.g.
  the engine's strike wallets, common SPL mints) to shave bytes on every
  internal flow. Owned ALTs must be `extend`-ed and `freeze`-d; a frozen
  ALT cannot be deactivated (deactivation has a 512-slot cooldown).

ALT account state is not instantaneously visible. After `extend`, wait at
least one slot before referencing the new entries, or the tx will fail with
`InvalidLookupIndex`.

## Jito / Jupiter Relevance

- **Jupiter** is the dominant Solana DEX aggregator; for any swap the
  Dispatcher calls Jupiter to get a route plan, then receives ready-to-sign
  instructions. See `docs/research/jupiter.md` for the API contract.
- **Jito** provides the bundle relay (`block-engine.jito.wtf`) and tip
  accounts. A Jito bundle is an atomic group of up to 5 transactions that
  either all land in the same slot or none do. For MEV-sensitive strikes
  (sandwich-resistant exits, cross-DEX arb), the Closer routes through Jito
  with a tip transfer to a Jito tip account. Standard non-bundle sends go
  through the regular RPC. Jito tips are *separate from* compute-unit
  priority fees and stack on top.

## Pitfalls

- **Static blockhash in a long-lived signing pipeline.** If signing takes
  > 60 s the blockhash is stale on send. Always fetch immediately before
  signing or use a durable nonce.
- **Default CU limit on a Jupiter route.** Will exhaust mid-route. Always
  call `setComputeUnitLimit` and set it from the simulation result + 10%
  headroom.
- **Skipping ATA creation.** Sending SPL tokens to an address whose ATA
  doesn't exist fails. The Closer derives the ATA and prepends a
  `createAssociatedTokenAccount` instruction when needed.
- **Mistaking `processed` confirmation for landed.** A `processed` tx can be
  rolled back if the leader is forked out. Trade accounting must use
  `confirmed` minimum.
- **Pre-flight on hot paths.** `simulateTransaction` adds a round trip and
  the simulator may use a different blockhash than the leader.
  `skipPreflight: true` is correct for time-critical strikes; the Closer
  accepts the trade-off of paying the base fee on a doomed tx.
- **Mixing legacy and V0 transactions.** Legacy transactions cannot use
  ALTs, so they cannot fit a Jupiter route. Legion's Closer rejects any
  legacy build path.
- **Treating SOL like an SPL token.** The native SOL balance is on the
  System-Program-owned account, not on an ATA. Wrapped SOL (`So11...112`)
  is its own SPL mint and must be wrapped/unwrapped explicitly.
- **Single-RPC dependency.** Public RPCs throttle aggressively; a strike
  pipeline pinned to one endpoint will drop bursts. Dispatcher rotates
  across at least three independent providers (see `alchemy.md` for the
  failover model).
