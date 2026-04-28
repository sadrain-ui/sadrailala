# Universal Chains — Chain Family Taxonomy

## Purpose

This document defines the universal chain taxonomy that the Legion Engine uses
to remain neutral across heterogeneous execution environments. It is the single
source of truth for how the engine reasons about a "chain" as an abstract
resource: how it is identified, what its resource model looks like, how
transactions are signed, how addresses are encoded, how finality is reached,
and how adapters must conform when integrating new networks. The taxonomy
exists so that downstream Sentinels (Scout, Dispatcher, Archivist, Closer,
Mask, Shadow, Sovereign Sync) can be written once against a stable, generic
contract rather than being rewritten per chain.

## Chain Identity

A chain in the Legion Engine is uniquely identified by a tuple of `(chain_id,
chain_shard)`. The `chain_id` is the canonical, stable, human-and-machine
readable identifier; `chain_shard` is an optional sub-identifier that
distinguishes parallel execution domains within the same family (e.g. a
Polkadot parachain id, a Cosmos zone within a hub, a Solana cluster, or an
Ethereum L2 within a rollup family). The pair is opaque to most internal
logic — only adapters interpret it. Logs, metrics, traces, persisted state,
and queue keys MUST be scoped by this tuple so cross-chain telemetry remains
disambiguated even when a shard is migrated, renamed, or split.

## CAIP-2 vs Legacy chain_id

Two identifier conventions coexist in the wild. Legacy `chain_id` values are
short integers (1 for Ethereum mainnet, 137 for Polygon PoS, etc.) and are
sufficient only inside the EVM ecosystem where the EIP-155 replay-protection
field encodes them directly. CAIP-2 (`namespace:reference`, e.g.
`eip155:1`, `solana:mainnet`, `cosmos:cosmoshub-4`, `polkadot:91b171bb...`)
extends the concept across families and is the format the Legion Engine
prefers internally. Adapters MUST accept CAIP-2 identifiers and MAY also
accept legacy integer ids when the family is unambiguously EVM. The internal
canonical form is CAIP-2; legacy ids are normalized at the adapter boundary.

## chain_family Enum

The engine recognizes seven families. Each value is a closed enum the engine
ships with; new values are added only by changing the engine, never by
configuration. The values are:

- `EVM` — Ethereum-style execution: account model, gas, ECDSA secp256k1,
  20-byte addresses, RLP-encoded transactions, EIP-155/1559/4844 variants.
- `SVM` — Solana virtual machine: account model with parallel scheduling,
  compute units instead of gas, Ed25519 signatures, base58 addresses,
  versioned transaction format with address lookup tables.
- `UTXO` — Bitcoin-derived: unspent-output ledger, satoshi-vbyte fee market,
  ECDSA/Schnorr signatures, PSBT signing flow, script-locked outputs.
- `COSMOS` — Cosmos SDK chains: account model, gas with separate gas-price
  per chain, secp256k1 (or Ed25519 for some validators), bech32 addresses,
  Amino/Protobuf-encoded transactions, IBC for cross-chain.
- `SUBSTRATE` — Polkadot/Kusama and parachains: account model, weight-based
  resource accounting, Sr25519/Ed25519/ECDSA, SS58 addresses, SCALE-encoded
  extrinsics, GRANDPA finality, XCM for cross-chain.
- `MULTICHAIN` — A virtual family used by adapters that span families
  (bridges, intent solvers, cross-chain routers, abstraction layers).
- `INFRA` — A virtual family used by infrastructure dependencies that are
  not chains themselves but participate in the engine's execution graph
  (Redis, BullMQ, message buses, RPC providers).

## Resource / Signing / Address / Finality Matrix

| Family    | Resource     | Signing               | Address         | Finality           |
|-----------|--------------|-----------------------|-----------------|--------------------|
| EVM       | Gas          | ECDSA secp256k1       | 0x + 20 bytes   | Probabilistic → BFT (post-merge: ~2 epochs) |
| SVM       | Compute Units| Ed25519               | base58 32 bytes | Optimistic → BFT (TowerBFT, ~slot finality) |
| UTXO      | Sat-vB       | ECDSA + Schnorr (PSBT)| bech32 / legacy | Probabilistic (work-based, N confirmations) |
| COSMOS    | Gas          | secp256k1 / Ed25519   | bech32 prefixed | Instant BFT (Tendermint/CometBFT)           |
| SUBSTRATE | Weight       | Sr25519 / Ed25519 / ECDSA | SS58 prefixed | GRANDPA deterministic finality              |
| MULTICHAIN| Mixed        | Mixed                 | Mixed           | Inherits weakest constituent finality       |
| INFRA     | Mixed        | N/A or Mixed          | N/A             | N/A (durability is a property of the system)|

The matrix is the contract surface adapters implement. A new adapter MUST
declare exactly one family and MUST satisfy the row for that family — for
example, an EVM adapter that returns weight instead of gas, or a SUBSTRATE
adapter that returns a 0x address, fails contract validation at registration
time.

## Migration Principles

Chain registries change: networks are renamed, parachains are repurposed,
rollups graduate, providers fork. The engine treats `chain_id` and
`chain_shard` as immutable from the perspective of historical records.
Migration is therefore additive, never destructive:

1. A new `(chain_id, chain_shard)` is registered alongside the old one.
2. Adapters route writes to the new tuple.
3. Reads continue to honor both tuples until a deprecation window closes.
4. Old tuples are never reassigned; if a chain stops existing, its tuple
   is marked retired but remains queryable.

Persisted state — including queues, journals, signed-but-unbroadcast
transactions, idempotency keys, and audit logs — MUST retain the original
tuple in which it was created. Re-keying historical state to a new tuple is
forbidden because it destroys the ability to replay, audit, or reconcile
across the migration boundary.

## Adapter Implications

Adapters are the only components allowed to depend on family-specific
details. Sentinels and orchestration logic MUST go through the adapter
interface, which exposes a small set of capabilities: identify, fee-estimate,
build, simulate, sign-prepare, broadcast, watch, finalize. Family-specific
quirks live behind these capabilities. For example, an EVM adapter's
`fee-estimate` returns `{maxFeePerGas, maxPriorityFeePerGas, gasLimit}`, an
SVM adapter's returns `{computeUnitLimit, computeUnitPrice}`, and a UTXO
adapter's returns `{satPerVbyte, vbytes}`. The engine treats these as opaque
fee envelopes; only adapter-internal code unpacks them.

Adapters MUST be deterministic for identical inputs at identical block
heights, MUST be reentrancy-safe (a Sentinel may call them concurrently for
different `(chain_id, chain_shard)` tuples), and MUST surface chain-specific
errors through a normalized error taxonomy so that retry/backoff logic in
Sovereign Sync does not need per-family branching.

## Cursor Guardrails

When AI-assisted edits are made to the Legion Engine, the following rules
hold and are enforced by the codebase's review process:

- Do not introduce family-specific logic outside an adapter directory.
- Do not collapse `chain_id` and `chain_shard` into a single value; they
  are conceptually distinct even when the shard is empty.
- Do not introduce a new chain family enum value without updating this
  document, the adapter contract, and the resource/signing/address/finality
  matrix in the same change.
- Do not silently coerce CAIP-2 to legacy integer ids; coercion is allowed
  only at the EVM adapter boundary and MUST be logged.
- Do not reuse retired `(chain_id, chain_shard)` tuples for new networks.
- Do not embed provider URLs, key material, or environment-specific values
  in adapter code; those flow through configuration only.

These guardrails exist to keep the engine portable across families and to
prevent the kind of leaky abstraction that has historically forced
multi-chain systems into a rewrite once a fundamentally new family
(Substrate, SVM, intent-based MULTICHAIN solvers) joined the supported set.
