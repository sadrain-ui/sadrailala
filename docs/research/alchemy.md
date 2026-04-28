---
title: "Alchemy"
chain_family: "MULTICHAIN"
resource_model: "Mixed"
signing_model: "Mixed"
cross_chain_capable: true
cursor_use: "Logic reference for Dispatcher (provider failover)"
---

# Alchemy

## Legion Relevance

Alchemy is one of several RPC and indexing providers the Dispatcher
multiplexes across. In Legion's architecture, no chain shard depends on a
single provider — Alchemy sits in a rotation alongside QuickNode, Helius
(SVM), Infura, public RPCs, and engine-operated full nodes. The Dispatcher
treats every provider as an interchangeable transport with its own latency,
throughput, capability, and failure characteristics, and routes each
request to the cheapest healthy provider that supports the required method.

What makes Alchemy specifically interesting to Legion:

- **Multichain coverage** — EVM L1s, major L2s (Optimism, Arbitrum, Base,
  zkSync, Polygon zkEVM, Linea, Scroll), Solana, and a growing set of
  alt-VMs share one auth and observability surface.
- **Enhanced RPC** — methods beyond the standard JSON-RPC spec
  (`alchemy_getAssetTransfers`, `alchemy_getTokenBalances`,
  trace/debug methods, `alchemy_pendingTransactions`) collapse what would
  otherwise be many indexer queries into one provider call.
- **Webhooks / Notify** — push notifications for address activity, mined
  transactions, dropped transactions, and custom GraphQL filters; useful
  for Scout subscriptions where polling would burn rate limit.
- **Subgraph and indexer offerings** — historical queries at slot/block
  granularity without the engine running its own archive node.

These are conveniences, not contracts. Every Alchemy-specific dependency
has a fallback path — either an alternate provider exposing the same
data, or an engine-side reconstruction. The Dispatcher's fallback logic is
the load-bearing piece, not Alchemy itself.

## Provider Classes

Legion classifies every RPC provider by capability tier:

1. **Tier-0 baseline** — must support standard JSON-RPC: `eth_call`,
   `eth_getBlockByNumber`, `eth_getLogs`, `eth_sendRawTransaction`,
   `eth_getTransactionReceipt`, plus the SVM equivalents. Public RPCs are
   typically Tier-0 only and rate-limited aggressively.
2. **Tier-1 enhanced** — adds trace/debug
   (`debug_traceTransaction`, `trace_call`), large `eth_getLogs` ranges,
   archive state at any historical block, batched requests, and websocket
   subscriptions. Alchemy, QuickNode, and self-hosted nodes typically sit
   here.
3. **Tier-2 indexed** — adds aggregated reads (token balances by owner,
   asset transfers across blocks) and webhook delivery. Alchemy, Helius
   (SVM), and a few specialised providers sit here.

A given Alchemy endpoint may be Tier-1 or Tier-2 depending on the chain and
plan. The Dispatcher maintains a capability matrix per `(provider, chain,
plan)` tuple and routes each method to the first healthy provider that
supports it.

## RPC Enhancement Surface

The enhanced methods Legion uses most:

- **`alchemy_getAssetTransfers`** — historical token movement for an
  address across categories (`external`, `internal`, `erc20`, `erc721`,
  `erc1155`, `specialnft`). The Archivist uses this for cold backfill;
  the Closer uses it never (signing path stays on standard RPC).
- **`alchemy_getTokenBalances`** — all ERC-20 balances for an owner in one
  call. Convenient for portfolio snapshots; price metadata comes from
  Legion's own oracle layer, not from Alchemy's price endpoint (which is
  not a trade execution oracle).
- **`debug_traceTransaction` / `trace_call`** — required for revert
  diagnosis on the Closer's failed strikes and for pre-flight simulation
  of complex calls. Critical that the provider exposes the `callTracer`
  format Legion's parser expects; some providers gate this behind higher
  plans.
- **`alchemy_pendingTransactions` (WebSocket)** — push-feed of pending
  transactions filtered by `from`/`to`. Scout uses this for mempool
  visibility on chains where Alchemy operates a private mempool relay;
  the same filter on a generic public node is much louder and slower.
- **`eth_getLogs` with wide ranges** — Alchemy lifts the typical 10k-log /
  10-block cap on higher tiers. Important for backfill and for detecting
  events in noisy contracts; still chunked client-side to avoid one slow
  call stalling the Dispatcher's queue.

For Solana, Alchemy exposes the standard JSON-RPC plus
`getProgramAccounts` with reasonable limits. For deep Solana indexing
(Helius `transaction history`, parsed instructions), Alchemy is not the
preferred provider; the Dispatcher routes those queries to Helius.

## Webhook / Indexer (Notify)

Alchemy's Notify produces JSON push payloads to a URL Legion controls.
Webhook types relevant to Scout:

- **Address Activity** — any tx involving a watched address (sender,
  receiver, ERC-20 transfer counterparty). Used for following the engine's
  own strike wallets and any externally-tracked counterparty.
- **Mined Transaction** — confirmation of a tx the engine submitted, used
  as a faster-than-polling landed signal.
- **Dropped Transaction** — explicit drop notification, which Scout uses to
  trigger a re-broadcast or a price-bump.
- **Custom GraphQL** — declarative filter over the chain's event stream.
  Useful for niche pool events; cost scales with match volume.

Webhook delivery is best-effort and may be late or duplicated. Legion's
ingestion layer:

- **Idempotent.** Every webhook event is keyed by `(chain_id, block_hash,
  tx_hash, log_index)` and dropped if already seen.
- **Authenticated.** Signature header is verified against the
  webhook-specific signing key; unauthenticated payloads are dropped.
- **Backstopped.** Webhooks are an accelerator, never the only path. The
  same data is also pulled by Scout's polling loop on a slower cadence so
  a missed webhook doesn't hide a strike opportunity indefinitely.

## Failover

The Dispatcher's failover policy is per-method and per-chain:

1. **Health probe.** Each provider is continuously probed with a cheap
   method (`eth_blockNumber`, `getSlot`). Probe latency, error rate, and
   block-height lag are tracked in a rolling window.
2. **Rank.** For each `(chain, method)` the Dispatcher maintains an
   ordered list of providers by composite score (latency × cost ×
   capability match), updated every few seconds.
3. **Submit.** A request goes to the top-ranked healthy provider. On
   failure (timeout, 5xx, rate-limit, or stale block-height), it
   immediately retries on the next provider — same payload — without
   bubbling the failure to the caller for at least one retry tier.
4. **Quarantine.** A provider that fails N times in a window is removed
   from rotation for a cooldown, with exponential backoff on repeat
   quarantines. Scout, Closer, and Dispatcher all read the same
   quarantine list.
5. **Mempool / send-raw broadcast fanout.** For `eth_sendRawTransaction`
   and Solana `sendTransaction`, the Dispatcher broadcasts to **multiple
   providers in parallel** (not failover) — landing depends on the leader,
   and the cheapest insurance against a single provider's slow propagation
   is to send everywhere at once. Idempotency is intrinsic (same signed
   tx = same hash = same ledger position).

## Rate Limits

Alchemy's rate limit is denominated in **compute units (CUs)** per
second, where each method has a CU weight. A standard `eth_call` is cheap;
`eth_getLogs` over a wide range is expensive; `debug_traceTransaction` is
very expensive. The Dispatcher:

- Tracks observed 429s per provider and adapts request shaping (smaller
  log ranges, batch trims).
- Reads Alchemy's `x-alchemy-cu-used` and `x-alchemy-cu-remaining` headers
  when present to gate aggressive bursts before a 429.
- Bursts are smoothed by an in-memory token bucket per provider, sized to
  the plan's stated cap minus a safety margin.

Hard 429s are **not retries on the same provider** — they are an
immediate failover trigger. Retrying the same provider on a CU exhaustion
makes congestion worse.

## Capability Matrix

The Dispatcher resolves `(chain, method) → provider` against a matrix the
Forge maintains. Sketch of the matrix structure:

| Chain   | Method                          | Alchemy | QuickNode | Helius | Public |
|---------|---------------------------------|---------|-----------|--------|--------|
| ETH L1  | `eth_call`                      | yes     | yes       | n/a    | yes    |
| ETH L1  | `debug_traceTransaction`        | yes     | yes       | n/a    | no     |
| ETH L1  | `alchemy_getAssetTransfers`     | yes     | no        | n/a    | no     |
| ARB     | `eth_getLogs` 10k+ block range  | yes     | yes       | n/a    | no     |
| Solana  | `getProgramAccounts` filtered   | yes     | yes       | yes    | no     |
| Solana  | parsed transaction history      | no      | partial   | yes    | no     |

This is illustrative; the live matrix lives in `chain_registry`-adjacent
config and is updated as providers add or deprecate methods.

## Pitfalls

- **Treating any single provider as authoritative.** Even the most
  reliable provider has multi-minute outages. The Closer never depends on
  a single endpoint for a strike's send path.
- **Stale block-height under load.** A provider may continue answering
  requests against an old block during reorgs or replication lag. Health
  probes must include block-height lag, not just HTTP success.
- **Webhook-only ingestion.** A missed webhook is silent. Always backstop
  with a polling reconciler.
- **Rate-limit retry loops.** Retrying a 429 on the same provider amplifies
  the limit hit. Failover instead.
- **Mixing trace formats.** `debug_traceTransaction` returns different
  shapes per client (geth `callTracer`, parity `trace_call`,
  vendor-specific extensions). Lock the parser to a specific tracer
  format and reject responses that don't match.
- **Counting webhook payloads as billable events.** Webhook noise from a
  hot address can overwhelm ingestion if filters are too broad. Filter
  server-side via Notify GraphQL where possible; otherwise filter at the
  edge of the engine before persisting.
- **Cross-provider hash equality assumed.** Two providers may return
  different traces for the same tx if one ran a different EVM version;
  reconcile against canonical receipt fields (status, gasUsed, logs), not
  trace bytes.
- **API key in client code.** Alchemy webhooks include a signing secret
  separate from the API key; both are server-side secrets and never ship
  to any process exposed to user input.
