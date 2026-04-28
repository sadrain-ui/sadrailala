---
title: "Architecture - Batching Multisig"
chain_family: "MULTICHAIN"
resource_model: "Mixed"
signing_model: "Multisig"
cross_chain_capable: true
cursor_use: "Logic reference for Closer/Dispatcher (batching and multisig)"
---

# Architecture — Batching Multisig

Batching and multisig overlap at the architectural level even though
they solve different problems. Batching combines multiple operations
into a single atomic execution to reduce gas, latency, and inclusion
risk. Multisig requires multiple authorizations before an operation
executes, to enforce policy and resist single-point compromise. Both
expand the unit of meaningful state change beyond the single
transaction, and both require the engine's signing pipeline to
reason about partially-completed work, threshold semantics, and
cross-family analogs. This document records the architectural
posture the Legion Engine takes for both.

## Batching: Atomic vs. Sequential

A batch can be atomic (all operations succeed or all revert, in a
single transaction frame) or sequential (operations are submitted
one after another with their own success conditions). Atomic
batching is preferred where the chain supports it, because it
collapses the failure surface to a single yes/no outcome. Sequential
batching expands the failure surface to a Cartesian product of
per-step outcomes and forces the engine to model partial completion
explicitly.

The engine's policy is to prefer atomic batching when the chain
supports it natively (Safe's `MultiSend` on EVM, Cosmos SDK's `MsgExec`
across multiple messages, Substrate's `utility.batchAll`,
Solana's per-transaction multi-instruction model with all-or-nothing
semantics), and to fall back to sequential batching only when the
operation set genuinely requires it (e.g., crossing chain boundaries,
or when a single operation alone would exceed the chain's resource
envelope).

## Family Analogs of Atomic Batching

The engine recognizes that atomic batching is a cross-family pattern
under different names:

- EVM: Multicall contracts (Multicall3 for reads, MultiSend for
  writes via a delegatecall to a trusted contract), Safe's batch
  transaction, EIP-7702 sponsored batches, EIP-5792 wallet-level
  batches.
- Solana: A single transaction may contain many instructions, all of
  which execute atomically. The "batch" is the unit of submission.
- Cosmos: `MsgExec` and the `authz` module allow batched messages
  with per-message authorization. Most Cosmos transactions are
  already multi-message by default.
- Substrate: `utility.batch` (continues on first failure, useful for
  best-effort), `utility.batchAll` (atomic, all-or-revert),
  `utility.forceBatch` (continues regardless of failures, for
  operational housekeeping).
- Bitcoin: Atomic batching is achieved at the transaction level —
  multiple inputs and outputs in one transaction is a "batch" of
  payments. PSBT supports this natively; CoinJoin extends it across
  signers.

The Dispatcher treats these as instances of one capability: "submit
N operations atomically", with the adapter mapping the abstract call
to the chain-native primitive. Sentinels above the adapter line do
not branch on family.

## Batching Risks

A batch is more efficient than its constituents but it is also a
larger blast radius. Two architectural risks the engine guards
against:

- A batch that is too large for the chain's resource envelope reverts
  in full, costing the gas/weight of the failed execution and
  reproducing none of the work. The Dispatcher MUST estimate the
  batch's resource cost before submission and MUST split a batch
  that exceeds a configured fraction of the block envelope.
- A batch that combines an unsafe operation with a safe one degrades
  the safety of the batch to that of its weakest member. Hooks,
  unknown call targets, or untrusted recipients in any leg of a batch
  taint the whole batch. Mask's policy MUST evaluate the batch as a
  unit and reject the batch if any leg fails policy.

## Multisig: Threshold Semantics

A multisig is an account that requires k of n signatures to act.
Variants exist by what the threshold protects (a single transaction,
a session, an off-chain message), what the signing structure looks
like (independent signatures aggregated, or a single signature
produced by a multi-party computation), and how the protocol
enforces the threshold (on-chain verification, validator-set logic,
or an account-abstraction wallet contract).

For the engine, multisig is most often the EVM Safe pattern (an
on-chain wallet contract with owner addresses and a threshold), the
Bitcoin script multisig pattern (an output script that requires k of
n signatures), the Substrate `multisig` pallet (a deterministic
account derived from the set of signers and threshold), or a Cosmos
multisig key (a public key composed of constituent keys with a
threshold).

## Off-Chain vs On-Chain Signature Aggregation

The architectural split that matters most across families:

- Off-chain aggregation. Each signer produces a signature
  independently; the host or coordinator collects them; the
  combined transaction is submitted once it has reached the
  threshold. Bitcoin script multisig and EVM Safe both work this
  way. The engine's role is to manage the signature collection
  state, ensure each signer signs the same canonical transaction,
  and submit only when threshold is reached.
- On-chain aggregation. Each signer submits their approval as its
  own transaction; once the threshold is reached, the multisig
  contract executes the operation. Substrate's `multisig` pallet
  and many DAO governance modules work this way. The engine's role
  is to track the proposal state, ensure each approval references
  the same call hash, and reveal the call data at the moment of
  execution (Substrate requires this; if the call is not available
  when the threshold tips, dispatch fails).

## Coordinator State

A multisig flow has state the engine MUST persist beyond the
lifetime of any one signer's session. The state includes the
proposed operation, the canonical hash signers are signing against,
the set of signatures or approvals received, the deadline by which
the threshold must be reached, and the policy decisions that admit
each signature into the set.

This state is durable and idempotent. A signer that submits the
same approval twice MUST be reflected once in the set. A coordinator
that crashes and restarts MUST resume from the last persisted state,
not retrigger collection. The Sovereign Sync's queue topology is
the natural backbone for this state, with the Archivist preserving
the audit record of who approved what and when.

## Replay and Mutability

A multisig proposal whose call hash can be replayed across networks
is a cross-chain replay vulnerability. The engine MUST construct
proposals whose hash is bound to the target chain (chain id /
genesis hash / domain separator) and MUST reject signatures whose
domain does not match the proposal's target. Substrate
`multisig`'s call-hash includes the runtime; EVM Safe's typed-data
domain includes the chain id; Bitcoin's signature hash binds the
specific transaction; the engine inherits these bindings and MUST
NOT remove them when normalizing across families.

## Batching Inside Multisig

The two patterns compose. A Safe transaction that wraps a MultiSend
delegatecall is a batched multisig operation: many operations,
threshold-authorized, atomic. The engine's Closer treats the wrapped
batch as a single unit for signing purposes and as N units for
audit and policy purposes. Mask's policy MUST evaluate every leg of
the wrapped batch, not merely the outer Safe call, because a Safe
transaction's outer signature does not constrain the inner
operations beyond what the policy explicitly checks.

## Time-Bound Authorization

A multisig signature collected at time T may not be valid at time
T+Δ. EVM Safe nonces are sequential and any earlier-nonce
transaction's execution invalidates a higher-nonce parallel
proposal; Substrate `multisig` allows a deposit-bonded proposal
that times out; Bitcoin scripts can include nLockTime or
CheckSequenceVerify constraints. The engine MUST surface and
honor these time bounds when collecting signatures; a signature
collected against state that has since changed is not the same
authorization the signer believed they were giving.

## Legion Relevance

The Closer's signing pipeline implements both patterns through one
flow: the Sentinel emits an "operation set", the adapter normalizes
it into the chain-native batch primitive (or a sequence when
necessary), the multisig coordinator state in Sovereign Sync collects
the threshold of approvals, and Mask evaluates policy across all
legs of the batch. Cross-family analogs make this a single flow at
the Sentinel layer; family-specific encodings live in adapters. The
result is that the engine can express "the operations team must
co-sign a batch of three operations on three chains" as one
coordinated workflow whose state, policy, and audit are unified,
without the Sentinel layer learning the details of any one family's
multisig pallet, contract, or script.
