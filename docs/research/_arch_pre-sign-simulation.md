---
title: "Architecture - Pre-Sign Simulation"
chain_family: "MULTICHAIN"
resource_model: "Mixed"
signing_model: "Mixed"
cross_chain_capable: true
cursor_use: "Logic reference for Shadow/Mask (pre-sign risk simulation)"
---

# Architecture — Pre-Sign Simulation

Pre-sign simulation is the practice of executing a transaction in a
sandboxed copy of the target chain's state immediately before signing
and broadcasting it, in order to predict the transaction's effects,
detect failures, and surface those effects to a human or automated
policy gate. The technique is well established in the wallet ecosystem
under names like Rabby's pre-execution preview, MetaMask's transaction
insights, and Tenderly's transaction simulator. This document records
how the Legion Engine adopts the pattern, what guarantees it provides
and does not provide, and where it fits in the engine's signing flow.

## Motivation

A transaction is an opaque blob until it is mined. Static analysis of
its calldata can identify the function being called and surface
familiar-looking parameters, but cannot predict the runtime behavior
of contracts whose state, hooks, oracles, or proxy implementations are
not encoded in the calldata itself. Pre-sign simulation closes this
gap by running the transaction against a fork of the chain's current
state and recording every state change, event, balance delta, and
revert reason that occurs.

The cost of skipping simulation is asymmetric. A bad signature is
cheap to produce, often free to broadcast, and may be impossible to
unwind. A simulation cycle costs an RPC round trip and a few hundred
milliseconds, and produces enough information to refuse the signature
when the predicted outcome differs from the requested one. The
Legion Engine's policy is therefore that high-stakes transactions are
simulated by default, and the Closer refuses to sign when simulation
fails or when its predicted effects fall outside a per-operation
envelope.

## Architectural Position

Simulation lives between Build and Sign. The Dispatcher constructs the
transaction; the Shadow Sentinel forks the chain at the latest known
state, replays the transaction, and emits a structured report; the
Mask Sentinel evaluates the report against policy and either releases
the transaction to the Closer for signing or quarantines it. The
forking primitive is provided by the chain adapter, not by the
Sentinels, because forking semantics are family-specific: an EVM
fork is a `debug_traceCall` or a Tenderly-style state override; a
Solana fork is a `simulateTransaction` with `replaceRecentBlockhash`;
a Substrate dry-run is `system_dryRun` against a pinned head. The
adapter normalizes all of these to a single capability the Sentinels
consume.

## What Simulation Catches

Simulation is sound for a defined class of failure modes. It catches
reverts that are deterministic given current state — insufficient
balance, slippage past the supplied bound, a contract paused by
admin, a Uniswap v4 hook that rejects the swap under current
conditions, a permit signature that has expired, an allowance that
was reduced between user intent and submission, a reentrancy guard
that fires because of unrelated state changes. It catches unexpected
recipients of value: token transfers to addresses other than the
intended one, ETH sent to a contract that does not refund, NFT
transfers that swap a high-value token for a low-value one. It
catches gas-estimation surprises that would otherwise produce
out-of-gas reverts mid-execution.

## What Simulation Does Not Catch

Simulation runs against a state that is current at simulation time;
the actual broadcast lands on a later state. Three classes of failure
escape:

- Race-condition failures, where another transaction in the mempool
  lands first and changes the state the simulated transaction
  assumed. Slippage protection is the proper guard here, not
  simulation.
- Adversarial-state failures, where a sandwich-attacker, an MEV
  searcher, or a malicious sequencer reorders the broadcast into a
  state the user did not consent to. Private mempools and intent
  routing address these, not simulation.
- Time-dependent failures, where the simulated state is correct now
  but a delay between simulation and inclusion crosses a deadline,
  oracle update, or epoch boundary. The engine's freshness budget
  for a simulated transaction must be tight, and the Closer must
  refuse to broadcast a signature whose simulation is older than
  that budget.

## State-Override Semantics

Some chains' simulation primitives accept state overrides — a way to
ask "what would happen if this contract's storage looked like that".
Used carefully, overrides are how the Shadow Sentinel models
not-yet-mined preconditions: a permit that the user is about to sign,
an allowance the engine is about to grant, a deposit a multisig is
about to confirm. Used carelessly, overrides drift from reality and
produce simulations that succeed against fictional state. The engine's
policy is that overrides are allowed only when they encode operations
the engine itself will perform atomically with the simulated
transaction (e.g., a permit bundled into the same transaction). Any
other override class is rejected.

## Trust Boundary

The simulation is performed by an RPC provider. That provider could,
in principle, return a fabricated result. Two mitigations:

- Diversify providers. A simulation result that materially affects
  signing policy SHOULD be reproducible across at least two
  independent providers when the operation crosses a value
  threshold. Disagreement is itself a signal.
- Anchor to canonical state. The simulation MUST include the block
  hash and number it ran against, and the engine MUST verify that
  block exists in its own canonical view of the chain before trusting
  the result.

## Output and Policy Integration

The Shadow Sentinel emits a normalized report: predicted balance
deltas per address per asset, predicted state changes, emitted events,
revert status with decoded reason, gas/weight/compute used, and the
provider and block hash the simulation ran on. The Mask Sentinel
evaluates this report against the engine's intent record for the
transaction. Discrepancies — an unexpected recipient, a balance delta
outside tolerance, an emitted event the intent did not authorize —
move the transaction to quarantine and page an operator. Matches
within tolerance release the transaction to the Closer.

## Performance Posture

Simulation adds latency. The engine treats this as a feature, not a
bug, on high-stakes transactions. For low-stakes transactions the
policy may be relaxed: simulate but do not block on the result, and
log the difference between predicted and actual. Over time this
log becomes the dataset against which simulation accuracy and policy
thresholds are tuned.

## Legion Relevance

Pre-sign simulation is the architectural seam at which the Shadow
and Mask Sentinels insert themselves into the signing flow. The
Shadow Sentinel runs the simulation; the Mask Sentinel applies
policy to its output. Without this seam the Closer would be signing
on the basis of static intent alone, and the engine would offer no
better protection than a thin RPC client. With it, the engine's
posture is closer to that of a privileged co-signer that will refuse
to authorize an outcome that disagrees with the user's stated
intent — across all chain families, mediated by the adapter's
normalized fork capability.
