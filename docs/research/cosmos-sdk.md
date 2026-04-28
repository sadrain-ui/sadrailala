---
title: "Cosmos SDK"
chain_family: "COSMOS"
resource_model: "Gas"
signing_model: "ECDSA"
cross_chain_capable: true
cursor_use: "Logic reference for Scout/Closer/Dispatcher (Cosmos shard, IBC)"
---

# Cosmos SDK

## Legion Relevance

The Cosmos SDK is the framework underlying every COSMOS-family chain
Legion targets — Cosmos Hub, Osmosis, Neutron, Injective, dYdX v4, Celestia,
Sei, and the broader interchain. From the engine's perspective, all of these
chains share a common transaction envelope, signing scheme, gas model, and
cross-chain protocol (IBC). Per-chain differences (modules, denoms, native
DEX) live above the SDK layer; the Scout / Closer / Dispatcher pipeline
treats them as variations on a single Cosmos shard rather than as separate
chain families.

The interesting axes for Legion:

- **IBC** makes Cosmos genuinely cross-chain capable inside its own family.
  A strike that originates on Osmosis and settles on Neutron is one
  Dispatcher pipeline, not two.
- **Deterministic finality.** Tendermint-family consensus delivers
  single-block finality (~1–6 s depending on chain). The Closer reports
  landed-and-final on the first confirmed block, unlike EVM which requires
  reorg buffer.
- **Gas wanted vs. used.** The transaction declares an upper bound (gas
  wanted) and is charged for its actual consumption (gas used) at the
  declared gas price. Dispatcher's gas oracle differs structurally from
  EIP-1559.
- **Sequence-based replay protection.** Per-account monotonic counter, like
  EVM nonces but with stricter ordering semantics.

## Account / Sequence

A Cosmos account has:

- **Address** — bech32-encoded, prefix per chain (`cosmos1...`, `osmo1...`,
  `neutron1...`). The same Ed25519 or secp256k1 public key produces a
  different bech32 string per chain — the address is not portable, but the
  underlying key is.
- **Account number** — assigned at first on-chain interaction; immutable.
- **Sequence** — monotonically incremented on every successful tx from
  this account.
- **Pubkey** — populated on first outbound tx; before that, the account
  exists implicitly (received funds) but has no on-chain pubkey record.

Replay protection binds to `(chain_id, account_number, sequence)`. A signed
tx is valid for exactly one chain at one sequence; the chain ID is included
in the signing payload to prevent cross-chain replay even if account
numbers happen to align.

The Dispatcher's sequence management:

- **Authoritative read** from the chain's auth module
  (`/cosmos/auth/v1beta1/accounts/{address}` or via gRPC) immediately
  before signing. Cached sequences go stale within a single block under
  any concurrent tx pressure.
- **Single-flight per account.** The Closer serialises strikes per signing
  account; out-of-order broadcast produces a deterministic
  `account sequence mismatch` error and the later tx is rejected, not
  queued.
- **Per-chain isolation.** Sequence on `cosmoshub-4` is independent of
  `osmosis-1`; the engine's strike wallets track sequence per chain.

## SIGN_MODE_DIRECT

Cosmos SDK supports several signing modes; Legion uses `SIGN_MODE_DIRECT`
exclusively for engine-controlled wallets. Direct mode signs over the
**protobuf-serialised** `SignDoc`:

```
SignDoc {
  body_bytes:      bytes  // serialized TxBody
  auth_info_bytes: bytes  // serialized AuthInfo
  chain_id:        string
  account_number:  uint64
}
```

The signer hashes (sha256) the serialized `SignDoc` and signs the hash with
secp256k1 (or, on chains that opted into Ed25519 for accounts, Ed25519).
The signature is placed back into `AuthInfo.signer_infos[i].signature`
(actually carried in the parallel `signatures` slice on `TxRaw`).

Other modes the Closer will encounter but does not produce:

- `SIGN_MODE_LEGACY_AMINO_JSON` — used by hardware wallets that don't yet
  support DIRECT. Legion's hot-path strike wallets are software wallets
  signing DIRECT.
- `SIGN_MODE_TEXTUAL` — human-readable multisignature on Ledger;
  irrelevant to the strike pipeline.
- `SIGN_MODE_DIRECT_AUX` — multi-signer flows; Legion does not run
  multisig strike wallets.

The signing payload is *byte-for-byte* deterministic — protobuf must be
serialized canonically (each field in tag order, no unknown fields). A
client that re-serializes after signing produces a different
`body_bytes`, breaking signature verification. The Closer signs over the
exact bytes it broadcasts.

## Protobuf TxRaw

The wire format is `TxRaw`:

```
TxRaw {
  body_bytes:      bytes
  auth_info_bytes: bytes
  signatures:      repeated bytes
}
```

`body_bytes` is a serialized `TxBody { messages, memo, timeout_height, ... }`.
`auth_info_bytes` is a serialized `AuthInfo { signer_infos, fee }`. Both
are kept as raw bytes in `TxRaw` (rather than re-decoded structures) so
that signing and verification work on the exact bytes the chain will see.

Broadcast modes:

- **`BROADCAST_MODE_SYNC`** — submit and wait for `CheckTx` only
  (mempool admission). Returns immediately with the tx hash. The Closer
  uses SYNC and then polls `tx` query for inclusion.
- **`BROADCAST_MODE_ASYNC`** — fire-and-forget; no `CheckTx` result.
  Risky — a malformed tx is silently dropped.
- **`BROADCAST_MODE_BLOCK`** — deprecated; blocks on inclusion. Avoid.

The Closer's standard pattern is SYNC + WS subscription on
`tm.event='Tx' AND tx.hash='<hex>'` for landed notification.

## Gas Wanted / Gas Used

Every Cosmos tx declares `fee.gas_limit` (sometimes called gas wanted) and
`fee.amount` (the fee in the chain's gas-payment denom, e.g. `uatom`,
`uosmo`). The fee in micro-units must satisfy:

```
fee.amount >= fee.gas_limit * min_gas_price
```

`min_gas_price` is set per validator and per chain; the network's effective
floor is the highest validator's minimum. The Dispatcher's gas oracle:

1. **Simulate** via `/cosmos/tx/v1beta1/simulate` (or gRPC equivalent).
   Returns `gas_used` for the proposed messages.
2. **Apply headroom** — multiply `gas_used` by 1.3 to absorb intra-block
   state drift. This is `gas_limit`.
3. **Look up gas price** per chain (config + on-chain `min_gas_price` for
   chains that publish it, e.g. via the Osmosis fee market module).
4. **Compute fee** = `gas_limit * gas_price`, rounded up to the integer
   micro-denom.
5. **Cap** absolute fee against the strike's profit envelope.

Unlike EVM, **unused gas is not refunded.** Overestimating gas_limit costs
real money up to the limit (Cosmos charges based on `gas_used` against the
declared gas_price, but `gas_limit` is the prepayment cap and any
auction-style fee market on the chain may use the limit as the bid). The
Dispatcher tunes the headroom multiplier per chain based on observed
simulate-vs-actual divergence.

## Tendermint RPC / gRPC / LCD

A Cosmos node exposes three query surfaces:

- **Tendermint RPC** (port 26657, JSON-RPC over HTTP and WebSocket).
  Lower-level: blocks, txs, mempool, consensus state, event subscriptions.
  Scout's WS event subscriptions live here
  (`subscribe { query: "tm.event='NewBlock'" }`).
- **gRPC** (port 9090). Strongly-typed access to every SDK module's queries
  and the tx service for simulate / broadcast. The Closer prefers gRPC for
  signing-path interactions because the protobuf types are exact.
- **LCD / REST gateway** (port 1317). RESTful proxy in front of gRPC.
  Convenient for ad-hoc tooling; the Closer does not use LCD on the hot
  path because JSON re-encoding loses determinism.

The Dispatcher rotates across multiple endpoints per chain, treating each
of (RPC, gRPC, LCD) as a separate capability. Failover policy mirrors the
EVM/SVM model — same payload, next endpoint on timeout or stale-height.

## IBC: Timeout Height / Timestamp

Inter-Blockchain Communication is the Cosmos-native cross-chain protocol.
A relayer carries packets between chains; light clients on each side
verify the other's headers. From Legion's perspective, IBC is just another
message type (`MsgTransfer` for ICS-20 token transfers, channel-specific
messages for ICS-27 / ICA host-controller flows).

Every IBC packet carries two timeouts:

- **`timeout_height`** — `(revision_number, revision_height)` on the
  destination chain. Packet is rejected if the destination chain's height
  reaches this without the packet being relayed.
- **`timeout_timestamp`** — nanoseconds since Unix epoch on the destination
  chain.

A packet is valid until **both** timeouts are unmet. Setting one to zero
disables it; setting both to zero produces a packet that never times out
and can hang forever — Legion always sets at least one. The Closer's
defaults:

- `timeout_timestamp = now + 10 minutes` for token transfers — long enough
  for a relayer to deliver under congestion, short enough that a strike's
  funds aren't trapped.
- `timeout_height` is left zero unless the destination chain has a known
  reorg/halt risk, in which case a height bound on top of the timestamp
  is set as belt-and-braces.

If a packet times out, the source chain's funds are returned via a
timeout proof. Until that proof lands, the funds are **escrowed and
unspendable**. The Archivist tracks every outbound IBC packet's
`(channel, sequence)` and reconciles against the destination chain's
`MsgRecvPacket` events; unmatched packets after timeout become Scout
tasks to submit `MsgTimeout` and unlock the funds.

## Finality

Tendermint BFT delivers deterministic finality at block commit (the block
is signed by 2/3+ stake). There is **no reorg under honest-majority
assumption**, so the Closer reports a strike final at the block of
inclusion, not after N confirmations. Two practical caveats:

- **Light-client lag.** A light client (the Dispatcher's view of the
  chain) updates from headers; until a block's header has been fetched
  and verified, the Closer hasn't *observed* finality even though the
  chain has *achieved* it. Confirmation latency is dominated by header
  delivery, not block production.
- **Halt scenarios.** A chain that loses 1/3+ stake stops producing
  blocks. The chain doesn't reorg, but no new blocks land. The Dispatcher
  treats stalled height (no new block in N×block_time) as a critical
  signal and stops queuing strikes for that chain.

## Pitfalls

- **Sequence mismatch under concurrency.** Two strikes signed against the
  same cached sequence will have one rejected. Closer must serialise per
  account or carry a sequence-aware retry that re-signs with a fresh
  sequence rather than re-broadcasting.
- **Re-serializing protobuf after signing.** Any non-canonical
  re-encoding breaks the signature. Always sign and broadcast the same
  bytes.
- **Bech32 prefix per chain.** A `cosmos1...` address pasted into an
  Osmosis tx is a different account; tooling must convert via the
  underlying bytes, not by prefix substitution alone.
- **Gas underestimate on stateful txs.** Simulate-based gas estimates can
  be too low if the tx's state-dependent path is shorter under simulation
  than at execution. 1.3× headroom is a default; volatile contracts on
  Osmosis or Neutron may need more.
- **Wrong fee denom.** Each chain accepts a specific set of fee denoms
  (often only the native staking token). Paying fees in a non-accepted
  denom is rejected at `CheckTx`.
- **Stale `min_gas_price`.** Chains with EIP-1559-style fee market
  modules (Osmosis fee market) move the floor block-by-block; cached
  values cause underpaid txs to be ejected.
- **IBC packet with both timeouts zero.** Hangs forever. Always set at
  least `timeout_timestamp`.
- **Forgetting to claim timed-out IBC funds.** Funds remain escrowed until
  `MsgTimeout` is submitted to the source chain. Archivist must reconcile.
- **Treating a halted chain like a slow one.** Tendermint halts are
  step-function failures, not latency degradations. Health-probe on
  block-height delta vs wall-clock, not on RPC latency alone.
- **Legacy amino JSON signing on hot path.** Slower, less canonical, and
  prone to encoding drift. Use `SIGN_MODE_DIRECT`.
- **Ignoring `account_number` on first-use accounts.** A freshly-funded
  account has no on-chain auth record until its first outbound tx; the
  signing payload still requires the (allocated) `account_number`, which
  must be fetched after first inbound activity confirms.
