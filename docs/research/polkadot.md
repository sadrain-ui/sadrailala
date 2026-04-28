---
title: "Polkadot"
chain_family: "SUBSTRATE"
resource_model: "Weight"
signing_model: "Sr25519"
cross_chain_capable: true
cursor_use: "Logic reference for Scout/Closer/Dispatcher (Substrate shard, XCM)"
---

# Polkadot

Polkadot is a heterogeneous multi-chain network in which a central Relay
Chain provides shared security and consensus to a set of parachains.
Parachains are themselves Substrate-built blockchains, each potentially
defining its own runtime, transaction format, and economics, while inheriting
finality and validity guarantees from the Relay Chain. For the Legion
Engine, this means a single "Polkadot" surface is in fact a fan-out of
runtimes, and adapters MUST resolve a target by `(chain_id, chain_shard)`
where the shard is the parachain id (or `0` for the Relay Chain itself).

## SCALE Encoding

Substrate transactions, calls, storage values, and runtime metadata are all
SCALE-encoded (Simple Concatenated Aggregate Little-Endian). SCALE is a
non-self-describing binary format: the decoder must know the type definition
ahead of time, typically obtained from the runtime's metadata. Adapters
MUST fetch and pin runtime metadata per spec version and MUST refuse to
encode an extrinsic against metadata older than the head's `specVersion`,
because a runtime upgrade can change the call index of an existing pallet
and silently mis-route the transaction.

## Extrinsic Format

A signed extrinsic is the SCALE-encoded composition of: version byte,
signer (MultiAddress), signature (MultiSignature), signed extensions
(era, nonce, tip, mode, metadata hash, etc.), and the call (pallet index +
call index + arguments). The signed extensions are appended to the call
to form the signing payload, with the runtime spec version, transaction
version, genesis hash, and era's anchor block hash mixed in. Any drift in
these fields between signing and broadcast invalidates the signature, so
the signing flow MUST be atomic with respect to the runtime version it
observed.

## SS58 Addresses

Substrate addresses are SS58-encoded: a one- or two-byte network prefix
identifies the chain, followed by the 32-byte public key, followed by a
truncated Blake2 checksum. The same private key yields different SS58
strings on different networks; address parsing MUST validate the prefix
against the target chain or it will accept addresses meant for a sibling
network. Generic Substrate prefix `42` is acceptable for tooling but MUST
NOT appear in user-facing flows on Polkadot (`0`) or Kusama (`2`).

## Weight as Resource Model

Polkadot does not bill execution by gas. Each call has a `weight`, a
two-dimensional measure (`refTime`, `proofSize`) representing computation
time and the size of the storage proof the call's state reads/writes
generate. Block weight is bounded; fee = base + weight * weight-to-fee
coefficient + length-fee + tip. Adapters MUST expose both dimensions to
the Dispatcher so that fee estimation reflects state-heavy calls correctly,
and MUST treat dispatch class (`Normal`, `Operational`, `Mandatory`) as
distinct lanes with their own weight envelopes.

## Mortality Era

Each extrinsic carries an `era` describing the block-hash range during
which it is valid. An immortal era (`Era::Immortal`) makes the
transaction valid forever and re-broadcastable across forks — usually
undesirable for user transactions, because a long-lived signed extrinsic
can be replayed onto an unintended fork. The Closer SHOULD prefer mortal
eras anchored to a recent finalized block hash, with a window narrow
enough to bound replay risk but wide enough to absorb mempool latency
(typical: 64 blocks).

## GRANDPA Finality

Block production (BABE) and finality (GRANDPA) are decoupled. GRANDPA
finalizes batches of blocks, not single blocks, by voting on the highest
block all honest validators agree on. Once a block is finalized, no fork
beneath it is possible without a slashable safety violation. The Archivist
MUST distinguish "best" head from "finalized" head; user-visible "tx
confirmed" should mean finalized for value transfers and high-value
operations, while "best" is acceptable for low-stakes UI feedback.

## RPC Surface

Polkadot RPC is JSON-RPC over HTTP and WebSocket, with subscription support
on WS for `chain_subscribeFinalizedHeads`, `state_subscribeStorage`, and
`author_submitAndWatchExtrinsic`. The watch subscription is the canonical
way to track an extrinsic's lifecycle (`ready`, `broadcast`, `inBlock`,
`finalized`, `dropped`, `invalid`). Plain `author_submitExtrinsic` returns
only the hash and provides no lifecycle signal; adapters MUST use the
watch variant unless they have an out-of-band finality observer.

## XCM (Cross-Consensus Messaging)

XCM is Polkadot's cross-chain messaging format. It expresses asset and
instruction transfers between the Relay Chain, parachains, and (via
bridges) external networks. XCM is fee-paid in the destination's native
asset by default, requires a derivative sovereign account for the sender
on the destination, and has version negotiation (`xcmVersion`) — sending
v3 instructions to a v2 receiver fails. Adapters integrating XCM MUST
verify the destination's accepted version and MUST estimate the
destination weight envelope, not just the origin's, when sizing fees.

## Pitfalls

- Runtime upgrades can change pallet call indices; pinning metadata to a
  stale `specVersion` causes silently mis-routed extrinsics.
- SS58 prefix confusion between Polkadot, Kusama, and generic Substrate
  is the most common cross-network address-leak bug.
- Immortal extrinsics are replay-capable across forks; default to mortal.
- "Best" head is not finalized; treating block inclusion as final on
  Polkadot loses the GRANDPA guarantee.
- XCM execution can fail at the destination after succeeding at the
  origin (`Trap` instructions, insufficient destination weight); an
  origin-side success is not a delivery success.
- Multi-signature accounts in Substrate use the `multisig` pallet with
  call hashes; the call data itself MUST be available at the moment the
  threshold is reached or the dispatch fails.

## Legion Relevance

Polkadot is the canonical SUBSTRATE family target for the engine. Scout
uses Polkadot's runtime metadata and weight envelope to enumerate
reachable calls and estimate cost. Dispatcher uses the era/nonce/spec
binding rules above to construct extrinsics that survive runtime
upgrades and mempool drift. Closer uses the GRANDPA finality boundary
to decide when an XCM-bearing transaction is safe to mark complete on
the destination. Across all three Sentinels, the `chain_shard` field
holds the parachain id, allowing the same code path to address Relay,
Asset Hub, Bridge Hub, and arbitrary parachains without family-specific
branching above the adapter line.
