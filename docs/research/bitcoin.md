---
title: "Bitcoin"
chain_family: "UTXO"
resource_model: "Sat-vB"
signing_model: "PSBT"
cross_chain_capable: false
cursor_use: "Logic reference for Scout/Closer/Dispatcher (UTXO shard)"
---

# Bitcoin — Sovereign Logic Reference (UTXO Shard)

This document is the canonical, original Legion-internal logic reference for the Bitcoin chain family. It is intentionally chain-mechanics-first: it describes Bitcoin as a *settlement substrate* that any Legion adapter (Scout, Closer, Dispatcher) must reason about when planning, signing, broadcasting, and confirming UTXO-bound intents. It deliberately avoids product/runtime code and does not duplicate vendor SDK documentation.

## 1. Legion Relevance

Bitcoin is the reference UTXO chain for Legion. It anchors the engine's understanding of:

- **Stateless value transfer** — outputs are consumed atomically, not balances mutated. Adapter logic that assumes account-style nonces/balances will silently corrupt fee math.
- **Deterministic fee market** — fees are bid in sat/vB against a public mempool. Resource preflight must be vB-accurate, not byte-naive.
- **Pre-broadcast signing** — PSBT (BIP-174) decouples coin selection, signing, and broadcast. Legion's consent envelopes mirror this separation; any chain that lacks a clean pre-sign artifact must be wrapped in a PSBT-shaped abstraction.
- **No replay protection by design** — replay safety is structural (UTXO is consumed) rather than logical (chain-id/nonce). Adapters cannot port EVM replay reasoning.
- **Probabilistic finality** — confirmations decay risk; finality is an SLA the operator picks, not a network primitive.

Bitcoin is **not cross-chain capable** in the Legion sense: native Bitcoin script cannot read external chain state, cannot atomically settle against another chain, and has no general-purpose call semantics. Any "cross-chain" workflow involving Bitcoin is realized by an off-chain or sidechain protocol (HTLC, federated peg, threshold signing) that Legion treats as a *separate* adapter, not as Bitcoin.

## 2. Raw Formats and Byte Structures

Legion adapters must be able to parse and emit these forms without third-party indexer dependence, because indexers lie under load and PSBT signers are byte-sensitive.

### 2.1 Transaction (post-SegWit, BIP-141)

Field order on the wire:

1. `version` — int32, little-endian. Currently 1 or 2 (BIP-68 relative locktime requires v2).
2. `marker` — 0x00 (SegWit only).
3. `flag` — 0x01 (SegWit only). Marker+flag absent in legacy serialization.
4. `tx_in_count` — VarInt.
5. `tx_in[]` — each: 32-byte prev txid (internal byte order), 4-byte prev vout (LE), VarInt scriptSig length, scriptSig bytes, 4-byte sequence (LE).
6. `tx_out_count` — VarInt.
7. `tx_out[]` — each: 8-byte value in sats (LE), VarInt scriptPubKey length, scriptPubKey bytes.
8. `witness[]` — present only when marker+flag set; one stack per input, each stack is VarInt count followed by VarInt-prefixed items.
9. `locktime` — uint32, LE.

### 2.2 Identifier discipline

- **txid** = double-SHA256 of the *non-witness* serialization. Reversed for display ("RPC byte order"). Legion stores both internal and display forms; never let display strings cross trust boundaries unverified.
- **wtxid** = double-SHA256 of the full witness serialization. Required for compact block reconstruction and witness-aware fee math.

### 2.3 Block header (80 bytes)

`version (4) || prev_block (32) || merkle_root (32) || time (4) || bits (4) || nonce (4)`. All little-endian. Block hash is double-SHA256 of header, displayed reversed.

### 2.4 Weight and vsize

- `weight = base_size * 3 + total_size`, where `base_size` is the legacy serialization length and `total_size` is the SegWit-including length.
- `vsize = ceil(weight / 4)`.
- Fee rate is **always** `fee_sats / vsize_vB`. Computing fees against `total_size` overpays on witness-heavy spends; computing against `base_size` underpays and risks rejection.

## 3. Transaction Model

Bitcoin has no accounts. A transaction is a function `(set<UTXO>) -> (set<UTXO>, fee)` constrained by:

- **Conservation:** `sum(input.value) = sum(output.value) + fee`. There is no implicit fee field; the residual is the fee. An adapter that forgets to include change creates a fee equal to the change amount. This has happened. Treat it as a Class-1 invariant in any planner.
- **Script satisfaction:** each input's witness/scriptSig must satisfy the referenced output's scriptPubKey under the active script versioning (legacy, SegWit v0, Taproot v1).
- **Standardness vs. consensus:** mempool policy is stricter than consensus. A consensus-valid transaction may be non-standard (dust outputs, non-standard scripts, low feerate) and never propagate. Legion must validate against *policy*, not just consensus, before broadcasting.
- **Sequence and locktime:** `nSequence < 0xFFFFFFFE` enables locktime; `nSequence` also encodes BIP-68 relative locktimes. RBF (BIP-125) signaling requires at least one input with `nSequence < 0xFFFFFFFE`.

### 3.1 Coin selection

The selector is part of the adapter contract, not a chain property. Practical constraints Legion must encode:

- Avoid creating dust outputs (below the dust relay threshold for the output type — varies by script type, ~294 sats for P2PKH, ~330 for P2WPKH, ~546 historical).
- Avoid mixing UTXOs across privacy domains unless the intent explicitly authorizes it.
- Reserve a fee buffer because change is computed last; if the buffer is wrong the only safe move is to drop an output or pull a larger UTXO.
- Effective value of a UTXO = `value - input_fee_at_target_rate`. Negative-effective-value UTXOs must not be selected at the chosen feerate.

### 3.2 Replace-by-Fee (BIP-125) and CPFP

- RBF: a replacement tx must (a) signal RBF on at least one ancestor, (b) pay strictly more total fee, (c) pay at least the minimum incremental relay fee per vB over the original, (d) not introduce new unconfirmed inputs.
- CPFP (Child-Pays-For-Parent): spend an unconfirmed output with a high-fee child to lift the package feerate. Legion must track package state, not just transaction state, when bumping fees on stuck spends.

## 4. PSBT (BIP-174 / BIP-370)

PSBT is the only signing artifact Legion should accept across heterogeneous signers (HSM, hardware wallet, MPC service, hot signer). It exists precisely because raw transactions cannot carry the metadata (prev outputs, derivation paths, sighash types, scripts) that an offline signer needs.

### 4.1 Structure

A PSBT is a serialized tree of typed key-value maps:

- **Global map** — unsigned transaction (or v2 explicit fields), xpubs, version, fallback locktime.
- **Per-input map** — non-witness UTXO or witness UTXO, partial sigs, sighash type, redeem script, witness script, BIP-32 derivations, finalized scriptSig/witness, Taproot-specific fields (internal key, leaf scripts, key-path/script-path sigs).
- **Per-output map** — redeem/witness scripts, BIP-32 derivations, Taproot internal key and tree.

### 4.2 Roles

BIP-174 defines roles that Legion's adapter pipeline mirrors:

- **Creator** — emits an unsigned PSBT. (Scout/planner.)
- **Updater** — adds prev outputs, scripts, derivation paths. (Adapter pre-sign hydrator.)
- **Signer** — produces partial sigs over the inputs it controls. (Signing service.)
- **Combiner** — merges partial sigs from multiple signers into one PSBT.
- **Finalizer** — converts complete partial sigs into final scriptSigs/witnesses.
- **Extractor** — extracts the network-serializable transaction from a finalized PSBT.

Legion's consent envelope is a Creator+Updater output. Closer is the Finalizer+Extractor. Dispatcher does not touch PSBT internals; it broadcasts the extracted transaction.

### 4.3 Sighash discipline

Default `SIGHASH_ALL`. Any other flag (`NONE`, `SINGLE`, with or without `ANYONECANPAY`) changes which fields are committed and is dangerous for general-purpose signers. Legion adapters must require an explicit, audited reason in the consent envelope to permit non-default sighash, because malleable sighash is a known coin-loss vector when combined with naive multi-sig flows.

### 4.4 Witness UTXO vs. non-witness UTXO

- For SegWit inputs, providing only the witness UTXO is sufficient for signing.
- However, post-2018 hardware-wallet guidance (the "SegWit fee-spoofing attack") requires the *full prev tx* (non-witness UTXO) to authenticate input amounts. Legion's Updater MUST attach non-witness UTXOs for any input signed by a hardware-wallet-class signer, even when SegWit-only would technically suffice.

## 5. Address and Script Formats

Legion adapters must accept and emit each form precisely; mixing them silently is a known cause of "lost" funds.

| Form | Prefix (mainnet) | Encoding | Script | Notes |
|------|------------------|----------|--------|-------|
| P2PKH | `1` | Base58Check, version 0x00 | `OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG` | Legacy. No witness discount. |
| P2SH | `3` | Base58Check, version 0x05 | `OP_HASH160 <sh> OP_EQUAL` | Wraps arbitrary scripts; commonly used for P2SH-P2WPKH/P2SH-P2WSH. |
| P2WPKH | `bc1q…` (20-byte program) | Bech32 (BIP-173), HRP `bc`, witness v0 | `OP_0 <pkh>` | Native SegWit v0. |
| P2WSH | `bc1q…` (32-byte program) | Bech32, witness v0 | `OP_0 <sh256>` | Native SegWit v0 script-hash. |
| P2TR | `bc1p…` | Bech32m (BIP-350), witness v1 | `OP_1 <x-only-pubkey>` | Taproot. Bech32m, NOT bech32. |

Validation invariants:

- Use **Bech32** for witness v0 and **Bech32m** for witness v1+. A v1 program encoded as Bech32 (or v0 as Bech32m) is invalid; some libraries silently accept the wrong checksum. Legion validators must reject mismatches.
- Reject mixed-case Bech32 strings; the BIP forbids them.
- Network-prefix mismatch (mainnet `bc`, testnet `tb`, signet `tb`, regtest `bcrt`) must be a hard error, not a warning. Sending a mainnet PSBT against a testnet address is a class of bug we will not tolerate.
- Witness program length is constrained: v0 must be 20 or 32 bytes; v1 (Taproot) must be 32 bytes. Other lengths are unspendable under current relay policy.

## 6. RPC / Indexer Surface

Legion's Bitcoin adapter must function with a Bitcoin Core-compatible RPC and may *augment* with electrum-protocol or Esplora-style indexers. The RPC is the source of truth for consensus; indexers are convenience layers and must be treated as untrusted caches.

### 6.1 Core RPC methods Legion uses

- `getblockchaininfo` — chain id, current tip, IBD state, network. Required at adapter start to confirm chain identity.
- `getblockhash` / `getblock` / `getblockheader` — header and block retrieval; used for confirmation tracking and reorg detection.
- `getrawtransaction <txid> <verbosity> [<blockhash>]` — without `txindex` the node can only return mempool txs unless a blockhash is supplied. Adapters must not assume `txindex` is on.
- `gettxout <txid> <vout> <include_mempool>` — UTXO existence check. Returns null for spent outputs; this is the canonical "is my output still spendable" probe.
- `sendrawtransaction <hex> [<maxfeerate>]` — broadcast. Returns either txid on accept, or a typed error (`txn-already-known`, `txn-mempool-conflict`, `min-relay-fee-not-met`, `bad-txns-inputs-missingorspent`, `txn-already-in-mempool`, `non-final`, etc.). Legion must classify these into retryable, fatal, and "already done" categories.
- `testmempoolaccept` — pre-broadcast policy validation. Always call this before `sendrawtransaction` when latency allows; it converts a lot of broadcast-time surprises into pre-broadcast errors.
- `getmempoolentry <txid>` / `getmempoolancestors` / `getmempooldescendants` — package and ancestor tracking for RBF/CPFP.
- `estimatesmartfee <conf_target> [<estimate_mode>]` — feerate estimate in BTC/kvB. Must be converted to sat/vB and clamped against a configured floor and ceiling. Treat returned `errors[]` as a signal that the estimate is unsafe.
- `getmempoolinfo` — `mempoolminfee` and `minrelaytxfee` are the hard floors below which broadcasts will not propagate.
- `importdescriptors` / `getdescriptorinfo` — modern wallet-less watch-only tracking. Legion should never use legacy `importaddress`/`importmulti` for new code.
- `scantxoutset` — synchronous UTXO scan against a descriptor; expensive but indexer-free.

### 6.2 Indexer methods (Electrum-style or Esplora-style)

These are *not* consensus and may lag, fork, or omit. Legion uses them only for:

- Address/script-hash → UTXO listings and history.
- Confirmation streaming via subscription (`blockchain.scripthash.subscribe`).
- Mempool feerate histograms for richer fee estimation than `estimatesmartfee` provides.

Every indexer-derived value must be cross-validated against the Core RPC before being used to authorize a state-changing decision.

## 7. Resource Model: Sat-vB

Legion expresses Bitcoin resource cost as a single tuple: `(fee_rate_sat_per_vB, vsize_vB)`. Total fee in sats = `fee_rate * vsize`. There is no compute meter, no storage rent, no per-opcode pricing; the entire economic surface is bytes-of-block-space at the prevailing market clearing rate.

### 7.1 Preflight invariants

- Compute `vsize` from a *fully constructed* draft transaction with realistic witness sizes per input type:
  - P2PKH input: ~148 vB.
  - P2WPKH input: ~68 vB (10.5 vB witness discount).
  - P2SH-P2WPKH input: ~91 vB.
  - P2WSH 2-of-3 input: ~104 vB (depends on witness script).
  - P2TR key-path input: ~57.5 vB.
  - Output sizes: P2PKH ~34 vB, P2WPKH ~31 vB, P2WSH ~43 vB, P2TR ~43 vB.
  - Tx overhead: 10.5 vB (with SegWit marker/flag amortized).
- Pick fee rate via a strategy chosen by the intent: economy / standard / priority / RBF-bump. Each strategy maps to a percentile in the live mempool fee histogram, *floored* by `mempoolminfee` and *ceilinged* by an operator-configured maximum (to prevent cost-runaway on fee spikes).
- Confirm `fee >= dust_relay_fee * vsize` and `fee >= min_relay_fee * vsize`. Below either floor the tx will not propagate.
- Confirm `fee <= maxfeerate` parameter passed to `sendrawtransaction`; otherwise the node rejects locally.
- Confirm no output is below its dust threshold for its script type.

### 7.2 Fee bumping

- RBF requires `replacement_fee >= original_fee + incremental_relay_fee * replacement_vsize`. Legion's bumper computes this against the *replacement's* vsize, not the original's; getting this wrong is a silent rejection.
- CPFP requires recomputing package feerate as `(parent_fee + child_fee) / (parent_vsize + child_vsize)` and ensuring it clears the desired target.

## 8. Settlement and Finality

Bitcoin has no deterministic finality. Legion treats finality as a configurable SLA expressed in confirmations, with these reference points:

- **0 conf (mempool-only):** valid only for adapter-internal pipelining; never an externally observable settlement.
- **1 conf:** sufficient for low-value, RBF-disabled, non-double-spend-incentivized flows.
- **3 conf:** common merchant default for retail-grade flows.
- **6 conf:** historical "deep" confirmation; clears all but pathological reorg scenarios.
- **>=100 conf:** required only for coinbase outputs, which are unspendable until 100 confirmations by consensus.

### 8.1 Reorg handling

The adapter must:

1. Track the chain tip and detect when a previously confirming block is no longer on the active chain (`getblockhash <height>` returning a different hash than was previously cached at that height).
2. On reorg, walk back the affected confirmations for every tracked tx, reset their state to "in mempool" or "missing," and re-evaluate.
3. Never report a tx as "settled" until the configured confirmation depth is *currently* on the active chain — settlement is a property of "now," not "ever."

### 8.2 Replay and double-spend

- A tx is uniquely identified by its inputs (since inputs are consumed atomically). Two txs spending the same input cannot both confirm. Legion's idempotency key on a Bitcoin spend is the *set of input outpoints*, not the txid (because RBF changes the txid while preserving the conflict set).
- "Double-spend" detection is signaled by `sendrawtransaction` errors `txn-mempool-conflict` and `bad-txns-inputs-missingorspent`. The adapter must distinguish "my own RBF replaced it" from "an external party double-spent us."

## 9. Adapter Relevance (Legion-specific)

The Bitcoin adapter is the canonical implementation of the UTXO branch of the Chain Adapter Contract. Other UTXO-family adapters (Litecoin, Dogecoin, BCH) are specializations that change script flavors, address prefixes, and policy thresholds while preserving this skeleton.

Mapping to Legion roles:

- **Scout** — uses `gettxout`, `scantxoutset`, indexer queries, and mempool histograms to plan a draft PSBT (Creator/Updater roles). Performs preflight in vB and sat/vB.
- **Closer** — accepts the consent-signed PSBT, runs Combiner/Finalizer, extracts the network tx, and hands off to Dispatcher. Verifies that the extracted tx still satisfies preflight (feerate may have moved during signing).
- **Dispatcher** — calls `testmempoolaccept` then `sendrawtransaction`, then subscribes to confirmation events (Core ZMQ `rawtx`/`hashblock` or indexer subscription), maintains the package state for RBF/CPFP, and reports settlement at the configured confirmation depth.

### 9.1 Capability flags

- `cross_chain_capable: false` — Bitcoin script cannot read external chain state.
- `account_model: false` — UTXO only.
- `nonce_based: false` — replay safety is structural.
- `eip1559_style_fees: false` — single-dimensional fee market in sat/vB.
- `psbt_signing: true` — PSBT is the canonical signing artifact.
- `rbf_supported: true` — BIP-125 opt-in.
- `cpfp_supported: true`.
- `taproot_supported: true` — adapter must handle Bech32m and witness v1.
- `deterministic_finality: false` — confirmation-based SLA.

## 10. Integration Pitfalls (collected from production-class UTXO bugs)

1. **Reversed txid display vs. internal byte order.** Mixing the two corrupts merkle proofs and ZMQ correlations.
2. **Forgotten change output → fee = change amount.** Always assert `fee <= max_acceptable_fee` after coin selection.
3. **Bech32 vs. Bech32m confusion.** A Taproot send to a v0-checksummed address sends to an unspendable script.
4. **Computing fees against total size, not vsize.** Overpays on witness-heavy spends; users notice.
5. **Trusting indexer balances.** Indexers omit txs during reorgs; cross-check against Core for any decisioning step.
6. **Assuming `txindex` is enabled.** Pass `blockhash` to `getrawtransaction` when querying confirmed txs.
7. **Missing non-witness UTXO in PSBT for hardware signers.** Triggers the SegWit fee-spoofing mitigation; signer rejects.
8. **Using legacy `importaddress` for watch-only.** Modern descriptors are mandatory; legacy paths are deprecated and slow.
9. **Treating txid as the idempotency key.** RBF preserves the spend intent but changes txid; key on the input set.
10. **Reporting "settled" before reorg-depth elapses on the *current* active chain.** Settlement is a live property.
11. **Not honoring `mempoolminfee` dynamically.** During mempool spikes the floor moves; cached floors cause silent rejection.
12. **Dust outputs.** Per-script-type dust thresholds; auto-discard or require explicit override.
13. **RBF replacement fee math against original vsize.** Must use replacement vsize.
14. **Coinbase 100-conf rule.** Spending coinbase before maturity is a consensus error; adapters must filter coinbase UTXOs from selection until mature.
15. **Sighash other than ALL without explicit consent.** Treat as a privileged operation.

## 11. Cursor Guardrails

When Cursor (or any agent) is reasoning about Bitcoin code in Legion, these guardrails are non-negotiable:

- **Do not port EVM mental models.** No `nonce`, no `chainId` replay protection, no per-op gas. If an EVM analogy appears in a Bitcoin adapter PR, it is almost always wrong.
- **Do not introduce a new signing path.** PSBT is the only accepted signing artifact. Proposals to "skip PSBT for speed" must be rejected at review.
- **Do not invent finality.** Confirmations are the finality knob. Proposals that claim sub-1-conf settlement are out of scope for the Bitcoin adapter and belong in a separate L2/sidechain adapter.
- **Do not treat indexers as authoritative.** Any code path that decides on indexer-only data without Core cross-validation must be rewritten or gated behind an explicit "advisory" capability.
- **Do not couple Bitcoin's fee model to a multi-chain abstraction that assumes EIP-1559.** The Chain Adapter Contract intentionally exposes a fee-model enum; Bitcoin is `single_dim_byte_market`.
- **Do not claim cross-chain capability.** Any cross-chain workflow is implemented in a separate adapter (HTLC, peg, threshold-sig service) that *uses* the Bitcoin adapter as a leaf.
- **Reject string-typed amount handling.** All sat amounts are integers (uint64-safe). Floating-point BTC values are display-only and must be parsed at boundary.
- **Reject ad-hoc fee constants.** Fee rates come from preflight, clamped by configured floor/ceiling, never from inline literals.
- **Reject txid-keyed idempotency.** Idempotency keys are the input-outpoint set.
- **Settlement reporting is "currently true on the active chain."** Reorg-aware tracking is mandatory.

This file is the contract. Adapter code does not get to disagree with it; if reality disagrees, this file is updated first, then code follows.
