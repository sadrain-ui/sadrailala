# Chain Adapter Contract

This document specifies the conceptual interface that every Legion chain adapter must satisfy. It is normative for design and review; it is deliberately *not* an implementation. No app code lives here. The contract is family-agnostic: it must hold for UTXO chains (Bitcoin, Litecoin), account chains (EVM-class, Solana, Cosmos SDK), and exotic substrates (Move-based, zk-rollup, app-chain). Where families diverge, the contract exposes capability flags rather than branching the interface.

## 1. Purpose

Legion plans, signs, broadcasts, and tracks intents across heterogeneous chains. The adapter is the seam between Legion's chain-agnostic intent model (Scout, Closer, Dispatcher) and a specific chain's mechanics. The contract exists to:

- Make chain capabilities *enumerable* rather than tribal knowledge.
- Make pre-broadcast validation a first-class step, not an afterthought.
- Make signing a typed envelope, not a raw byte handoff.
- Make settlement a *current, live property* rather than a one-shot "did it confirm" boolean.
- Make telemetry, errors, and idempotency uniform so the engine can reason across chains without bespoke shims.

If a behavior is not in this contract, the adapter cannot rely on the engine providing it; the engine cannot rely on the adapter providing it. Surprises are bugs.

## 2. Non-Goals

- **Not a wallet.** Adapters do not hold keys. Signing is delegated to a signer service via a typed envelope.
- **Not a router.** Cross-chain routing, atomic-swap orchestration, and bridge selection are out of scope. An adapter implements one chain.
- **Not a node.** Adapters consume RPC/indexer endpoints; they do not run consensus.
- **Not a UI.** Human-readable rendering of intents/receipts belongs upstream of the adapter.
- **Not a price oracle.** Fiat valuation, slippage tolerance, and execution policy are upstream concerns.
- **Not a generic compute platform.** Adapters expose chain-native capabilities; they do not synthesize capabilities the chain does not have.

## 3. Chain Identity

Every adapter declares an immutable identity tuple. This tuple is the primary key for routing intents, attaching telemetry, and enforcing replay safety.

- `chain_family` — `utxo` | `evm` | `solana` | `cosmos` | `move` | `substrate` | `other`. Drives default capability assumptions.
- `chain_id` — the chain-native identifier in its canonical form (e.g., EVM uint, Cosmos string, Bitcoin network magic). Adapters MUST refuse to operate against a node whose advertised chain id mismatches.
- `network` — `mainnet` | `testnet` | `signet` | `devnet` | `regtest` | named-testnet. Mismatch is a fatal error, never a warning.
- `genesis_hash` — where applicable, recorded for tamper detection on long-lived sessions.
- `protocol_version` / `runtime_version` — adapter records the version it was built/tested against and the version currently observed; divergence triggers a degradation flag, not silent failure.
- `address_format_set` — enumerated address formats the adapter accepts and emits.
- `fee_model` — `single_dim_byte_market` | `gas_legacy` | `gas_eip1559` | `compute_units` | `multidim` | `fixed`.
- `time_model` — `block_time_avg_seconds` (advisory) and `slot_or_block` semantics.

The identity tuple is immutable for the life of an adapter instance. A "switch network" operation is a new instance, not a mutation.

## 4. Capability Matrix

Capabilities are declarative booleans (or small enums) the engine queries to decide what is legal. Adapters MUST NOT silently degrade past a capability boundary; they raise a typed `CapabilityNotSupported` error.

Required capability flags:

- `account_model` — bool. False for UTXO families.
- `nonce_based` — bool. True if replay protection requires monotonic per-account nonces.
- `psbt_or_equivalent_signing_artifact` — bool. True if the chain has a canonical pre-sign envelope (PSBT, SignDoc, MessageV0). When false, the adapter must synthesize one.
- `rbf_or_replacement` — bool. True if pending txs can be replaced by paying more fee.
- `cpfp_or_package` — bool. True if package/ancestor fee-bumping is supported.
- `cross_chain_capable` — bool. True only if native chain logic can read external chain state.
- `deterministic_finality` — bool. True for chains with a finality gadget (CometBFT, Casper FFG, etc.). False for probabilistic-finality chains.
- `simulation_supported` — bool. True if the chain exposes a side-effect-free pre-execution endpoint (`eth_call`, `simulateTransaction`, `testmempoolaccept`, `simulate` for Cosmos).
- `mempool_visible` — bool. False for chains where pending state is not first-class (e.g., proposer-only mempools).
- `eip1559_style_fees` — bool. True if fees are split into base + priority components.
- `compute_metering` — bool. True for chains with explicit compute units distinct from byte size.
- `event_log_supported` — bool. True if structured logs/events are emitted on settlement.
- `reorg_possible` — bool. True for probabilistic-finality chains; drives confirmation-tracking semantics.
- `coinbase_or_maturity_rules` — bool. True if some outputs are time-locked at the protocol level.
- `multisig_native` — bool.
- `threshold_sig_friendly` — bool. True if the signing algorithm permits FROST/MPC without protocol-level coordination changes.

Adapters MAY expose additional capability flags namespaced under `family_specific.*`. Generic engine code must not depend on family-specific flags.

## 5. Adapter Lifecycle

An adapter has four lifecycle states. Transitions are explicit; the engine never infers state.

1. **Initialized** — instantiated with config; no network I/O performed.
2. **Bound** — connected to RPC/indexer endpoints; identity tuple cross-checked against the live node. Refuses to leave this state if `chain_id`, `network`, or `genesis_hash` mismatch.
3. **Ready** — preflight, sign, broadcast, and tracking surfaces are usable. Health is monitored continuously; degradation is reported, not hidden.
4. **Draining** — refuses new intents; allows in-flight intents to settle or time out. After drain, transitions to **Closed**.

Adapters MUST be idempotent across re-binds: a restart that observes an already-broadcast tx must reconstruct its tracking state from chain/indexer data, not from a local journal alone.

Operational invariants:

- **No silent reconnects across chain identity changes.** If the underlying node's chain id flips (operator misconfiguration, fork), the adapter transitions to **Draining** and surfaces a fatal error.
- **Health checks are continuous.** Latency, reorg depth, mempool floor, peer count, and indexer lag are sampled and exported; thresholds breached degrade the `Ready` state to a warning sub-state.
- **No global mutable state.** All per-intent state is keyed by the engine-provided idempotency key.

## 6. Account / Address Validation

Every adapter exposes a pure function `validate_address(s: str) -> AddressDecision`. The decision is one of:

- `Valid { canonical_form, script_type, network }` — address parses, network matches, script type is recognized and supported.
- `ValidButUnsupported { reason }` — parses on this chain but the adapter does not support sending to this script type (e.g., novel witness version).
- `WrongNetwork { observed_network }` — parses on the family but for a different network. Hard error.
- `Invalid { reason }` — does not parse.

Requirements:

- **Canonicalization is mandatory.** Display-form and internal-form are tracked separately; the canonical form is what flows through the rest of the pipeline.
- **Mixed-case and ambiguous-encoding inputs are rejected**, even if the underlying spec is permissive.
- **Checksum mismatches are rejected without "did you mean."** No silent autocorrect.
- **Address reuse is not the adapter's concern**, but the adapter MUST expose `script_type` and any privacy-relevant flags so upstream policy can decide.
- **Account existence vs. address validity are distinct.** On account-model chains, `address_exists(addr) -> bool` is a separate, network-bound query. Validation must not require existence.

## 7. Transaction Normalization

Legion expresses an intent in a chain-agnostic form. The adapter is responsible for *normalizing* an intent into a chain-native draft. The contract surface:

- `plan(intent, policy) -> DraftTx`
- `DraftTx` carries: chain identity, inputs/outputs (in chain-native form), fee strategy, locktime/timeouts, and a `preflight_report`.
- `DraftTx` is deterministic given `(intent, policy, observed_chain_state_snapshot)`. Two planners with the same inputs produce the same draft up to chain-side nondeterminism (e.g., mempool fee jitter); the adapter records the snapshot it planned against.

Normalization rules:

- **Amounts are integers in the smallest chain-native unit.** Floating-point appears only at display boundaries.
- **Fee strategy is a typed enum**, not a number. The adapter resolves the enum against live chain state at preflight time.
- **Recipient lists are ordered and stable.** The adapter does not silently reorder.
- **Change/refund outputs are explicit.** Implicit fee = "whatever's left" is allowed only on chains where the chain itself enforces conservation (UTXO); on account chains, change is a non-concept and the adapter MUST reject any intent that supplies one.
- **Memos / data fields are typed.** Free-form bytes are accepted only when the adapter capability set declares it.

## 8. Resource Preflight

Preflight is mandatory before signing. It produces a `PreflightReport` that is opaque to the engine but typed at the boundary.

The report MUST include:

- `fee_estimate` — typed by `fee_model`. For `single_dim_byte_market`: `(rate_native_per_vbyte, vsize, total_fee)`. For `gas_eip1559`: `(base_fee, priority_fee, gas_limit, max_total_fee)`. For `compute_units`: `(units, unit_price, total_fee)`.
- `fee_floors` — minimum acceptable values from current chain state (`mempoolminfee`, `baseFee`, `minComputeUnitPrice`). Below floor → adapter refuses to broadcast.
- `fee_ceilings` — operator-configured maxima. Above ceiling → adapter refuses to broadcast.
- `resource_balance_check` — for account chains: does the sender have enough native asset to pay value + fee? For UTXO: do selected coins cover value + fee + dust constraints?
- `expiry` — locktime, sequence, blockhash recency, or chain-native equivalent. Includes the wall-clock window during which the draft remains valid.
- `policy_warnings` — non-fatal flags (dust output, unusual sighash, large data field, address reuse hint). The engine decides whether to escalate.
- `simulation_result` — if `simulation_supported`, a structured result of side-effect-free execution: success/failure, projected logs/events, projected state diffs, projected fee actuals.

Preflight MUST be re-runnable. Engine policy may require a fresh preflight after signing if the signing latency exceeds a configured drift threshold.

## 9. Simulation

Where supported, simulation is the strongest pre-broadcast guarantee available, but it is not a settlement guarantee. Contract:

- Simulation is **side-effect-free**: it must not mutate chain state nor consume mempool slots.
- Simulation is **state-pinned**: the adapter records the chain tip / slot / block height it simulated against. The engine uses this pin to detect drift before broadcast.
- Simulation **may differ from execution** on chains with non-deterministic ordering (account-model with priority gas auctions, MEV reorderings). The adapter exposes a `simulation_confidence` enum: `deterministic` | `ordering_sensitive` | `advisory`.
- A failed simulation is a **hard refusal** unless the intent explicitly opts in to "broadcast despite simulation failure" with a recorded reason. Adapters MUST log such overrides at audit level.

When simulation is unsupported, the adapter exposes that via the capability flag, and the engine adjusts policy accordingly (e.g., requires more conservative fee bidding, requires explicit human consent for novel intents).

## 10. Consent / Signing Envelopes

Signing is delegated. The adapter never holds private keys. The contract surface:

- `build_envelope(draft) -> SigningEnvelope`
- `SigningEnvelope` carries: chain identity, the canonical pre-sign artifact (PSBT for UTXO; typed-tx-with-domain-separator for EVM; `SignDoc` for Cosmos; `MessageV0` for Solana; etc.), the per-signer policy (which signers, threshold), the sighash/signing modes permitted, and the `consent_summary`.
- `consent_summary` is a **human-auditable** projection of the envelope: recipients, amounts, fee, expiry, network, capability flags exercised. The summary is signed alongside the chain-native artifact so an attacker cannot present one form to the human and another to the chain.
- `accept_signed(envelope, partials[]) -> SignedTx` — the adapter combines/finalizes partial signatures and produces a network-broadcastable artifact. It does NOT broadcast.

Requirements:

- **Default sighash/signing mode is the safest available.** Non-default modes (BIP-143 variants, EVM `SIGN_TYPED_DATA` outside EIP-712 envelope, Cosmos `SIGN_MODE_LEGACY_AMINO_JSON` on a chain that prefers `SIGN_MODE_DIRECT`) require explicit declaration in the envelope and explicit upstream consent.
- **The envelope is signer-agnostic.** Hardware wallets, HSMs, MPC services, and hot signers all consume the same envelope form for a given chain.
- **The envelope binds the chain identity.** A signer cannot mistakenly apply a mainnet envelope's signature to a testnet replay.
- **The envelope binds the consent summary.** A signed envelope whose chain-native artifact does not match its consent summary MUST be rejected at finalization.

## 11. Broadcast and Tracking

Broadcast is separated from finalization to allow retry, RBF/replacement, and out-of-band rebroadcast.

- `broadcast(signed_tx) -> BroadcastReceipt` — submits to the chain. Idempotent on the engine-supplied idempotency key (which, for UTXO, is the input-outpoint set; for account-model, is `(sender, nonce)` or chain-native equivalent; for Solana, the recent-blockhash + signature).
- `track(receipt) -> AsyncStream<TrackingEvent>` — emits events as the tx progresses.

`TrackingEvent` variants:

- `Submitted { node_seen, time }`
- `Mempool { since, replacement_of? }`
- `Replaced { by, reason }` — RBF or chain-native replacement.
- `Included { block, height_or_slot, index, time }`
- `Confirmed { depth, on_active_chain: true|false }` — emitted on every depth change up to the configured target.
- `Reorged { from_block, to_block, depth_lost }` — settlement is rolled back; downstream must react.
- `Settled { final_depth, settlement_data }` — only emitted when depth target is met **and currently on the active chain**.
- `Failed { reason, retryable: bool, terminal: bool }`.

Broadcast errors are classified into:

- `Retryable` — transient connectivity, transient mempool full, transient feerate floor.
- `Conflicting` — `txn-mempool-conflict`, nonce already used, blockhash too old. Adapter consults policy: was this our replacement, or external?
- `AlreadyDone` — already in mempool / already in chain. Engine treats as success.
- `Fatal` — invalid signature, malformed tx, capability violation. No retry.

## 12. Settlement and Finality

Settlement is a *currently true* property, not a historical event.

- The adapter exposes `settlement_policy(intent) -> SettlementTarget`. Targets are chain-native:
  - Probabilistic-finality chains: `confirmations: N` plus an optional `wall_clock_min`.
  - Deterministic-finality chains: `finalized_height_observed` or `finality_certificate_seen`.
- Settlement is reported via `Settled` events. Settlement MUST be re-evaluated on every reorg/reordering signal; if the target is no longer met, the adapter emits `Reorged` and the intent re-enters the tracked-but-not-settled state.
- Adapters MUST NOT collapse "ever observed at depth N" into "settled forever." That is the canonical settlement bug across families.

For deterministic-finality chains, the adapter tracks the finality gadget directly (e.g., CometBFT `last_commit`, Casper FFG checkpoint, Solana `finalized` commitment). Confirmation counting is meaningless on those chains and the adapter exposes no confirmations field.

## 13. Retry and Idempotency

The engine supplies an idempotency key with every operation. The adapter binds intent to a chain-native conflict set:

- **UTXO family:** the set of input outpoints. Two intents sharing any outpoint are conflicting; the adapter reports the conflict deterministically.
- **Account / nonce-based families:** `(sender, nonce, chain_id)`. Changing fee with the same nonce is a replacement, not a new intent.
- **Solana-style:** `(signer, recent_blockhash, message_hash)`; expiry is bounded by blockhash validity.
- **Cosmos:** `(signer, account_number, sequence, chain_id)`.

Requirements:

- **Idempotent broadcast.** Re-broadcasting the same signed tx is a no-op.
- **Idempotent replacement.** RBF or fee-bump targets the same idempotency key, not a new one.
- **Stateful resumability.** After a crash, the adapter reconstructs tracking state from chain + indexer data keyed by the idempotency key. Local journals are an optimization, never the source of truth.
- **Bounded retries.** Each retry classification has a configured cap; exceeding it transitions to a typed `Failed { terminal: true }`.

## 14. Telemetry

Adapters export a uniform telemetry surface so the engine can observe heterogeneous chains identically.

Required metrics (per adapter instance, tagged with chain identity):

- Lifecycle: state transitions, time in each state.
- RPC/indexer: request rate, latency histogram, error rate by endpoint.
- Mempool/floor signals: current `min_relay_fee` / `base_fee` / equivalent; histogram of last N samples.
- Reorg signals: observed reorg depth distribution, reorg rate.
- Intent flow: counts by stage (planned, signed, broadcast, mempool, included, settled, reorged, failed).
- Fee accuracy: planned-fee vs. actual-fee histograms.
- Simulation accuracy: simulated-failure-vs-actual-failure agreement rate (where supported).
- Capability degradations: count of `CapabilityNotSupported` raises by capability.

Telemetry contracts:

- **No PII in metric labels.** Address-level labels are forbidden; aggregate by script type, intent class, and outcome only.
- **Cardinality bounds enforced.** Labels are enumerated; free-form labels are rejected.
- **Tracing span discipline.** Every intent has a single root span; broadcast and tracking are child spans. The trace ID is part of the engine→adapter context, never minted by the adapter.

## 15. Errors

Errors are typed, never stringly. The adapter exposes a closed enum per category:

- `ConfigError` — bad endpoint, bad chain identity, missing capability config.
- `IdentityMismatch` — node disagrees with declared identity. Always fatal.
- `CapabilityNotSupported { capability }` — the requested operation needs a capability the chain or adapter does not have.
- `ValidationError { field, reason }` — pre-broadcast validation failed.
- `PreflightError { reason }` — fee floor breached, insufficient balance, expired blockhash, etc.
- `SimulationError { kind, detail }` — simulation rejected the tx; kind enumerates chain-native categories.
- `SigningEnvelopeError { reason }` — envelope/consent mismatch, missing partials, threshold not met.
- `BroadcastError { class, detail }` — class ∈ `Retryable | Conflicting | AlreadyDone | Fatal`.
- `TrackingError { reason }` — endpoint unavailable, indexer lag exceeds threshold.
- `ReorgError { depth_lost }` — settlement rolled back. Not always an error; sometimes a notice. Carries severity.
- `InternalError` — last-resort bucket; MUST include enough context to file a bug. Adapters that resolve issues by coercing them into `InternalError` violate the contract.

Errors carry a stable `code` (string), a typed `class`, a `retryable: bool`, a `terminal: bool`, and an opaque `detail` payload. The engine routes on `class` and `code`; humans read `detail`.

## 16. Migration Contract

Adapters evolve. Chains hard-fork. The contract bounds change:

- **Schema versioning.** Capability matrix and identity tuple are versioned. The engine refuses to bind to an adapter whose schema version is unknown.
- **Capability additions are minor versions.** Adding a capability flag is non-breaking. Engines that don't know the flag treat it as `false`.
- **Capability removals are major versions.** Removing or repurposing a flag is breaking.
- **Hard-fork awareness.** Adapters declare a `min_runtime_version` and `max_runtime_version`. Operating outside the band degrades the `Ready` state.
- **Replay-safety across forks.** When a chain forks into two surviving networks, the adapter MUST be configured against exactly one (`chain_id` + `genesis_hash`). Cross-fork replay is the operator's risk to accept; the adapter does not silently support both.
- **Deprecation windows.** A capability or method marked deprecated MUST continue to function for at least one major version with telemetry warnings before removal.
- **State migration.** When an adapter's persisted shape changes, it ships a one-shot, idempotent migration. Migrations that are not idempotent are rejected at review.

## 17. Cursor Guardrails

For any agent (Cursor or otherwise) reasoning about adapter code:

- **Capability flags are the only branching surface.** Do not write `if chain == "bitcoin"` in engine code; query the capability. Do not extend the engine with chain-specific shortcuts.
- **No raw signing paths.** Every signing flow goes through `build_envelope` → external signer → `accept_signed`. Proposals to "skip the envelope for performance" are rejected.
- **No untyped fees.** A numeric literal in a fee path is a code smell. Fees are resolved from preflight.
- **No untyped errors.** A `raise Exception("…")` in adapter code is a contract violation. Use the typed enum.
- **Settlement is a live property.** Code that caches "settled = true" without reorg awareness is wrong; reject in review.
- **Idempotency keys are the chain-native conflict set.** Code that keys on the response txid/hash instead of the input-side conflict set will mis-handle replacements; reject.
- **Indexers are advisory.** Decisioning code paths (sign, broadcast, settle) cross-validate against the consensus RPC. Pure-indexer decisioning is an audited exception, never a default.
- **No silent capability degradation.** If a chain doesn't support simulation, the adapter raises `CapabilityNotSupported`; it does not "estimate" by guessing.
- **Address validation is total.** Every address that crosses an adapter boundary has been through `validate_address`. No "trust the upstream" exceptions.
- **Telemetry labels are bounded.** Adding an unbounded label (raw address, raw memo) is rejected at review.
- **Migrations are idempotent.** A migration that is not safe to re-run must be rewritten before merge.
- **Out-of-scope work is named, not done.** If a PR drifts into routing, wallets, oracles, or UI, split it. The adapter contract does not absorb adjacent concerns.

The contract is the contract. Adapter code does not get to disagree with it. Engine code does not get to bypass it. When reality forces a change, this document is updated first; code follows.
