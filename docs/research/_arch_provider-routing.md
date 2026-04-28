---
title: "Architecture - Provider Routing"
chain_family: "MULTICHAIN"
resource_model: "Mixed"
signing_model: "Mixed"
cross_chain_capable: true
cursor_use: "Logic reference for Dispatcher/Archivist (provider routing and failover)"
---

# Architecture — Provider Routing

A chain adapter does not talk to a chain. It talks to a set of RPC
providers that each claim to speak for the chain. The choice of which
provider answers a given request is the most operationally consequential
decision the engine makes that is not visible to the user. This document
records the architecture the Legion Engine uses to make that decision,
informed by patterns popularized in MetaMask's network configuration
surface and Rabby's provider preference model, and adapted for an
unattended, multi-chain, high-throughput service rather than a single
human's wallet.

## Why Routing Is Non-Trivial

Providers differ along many independent axes. Latency varies by region
and by load. Method support is uneven: some providers omit
`debug_traceCall`, some throttle `eth_getLogs` over wide block ranges,
some return paginated history while others return errors past a depth.
Pricing models differ — flat-rate, per-request, per-compute-unit — and
quotas can hit mid-operation. Censorship policies differ: some
providers filter mempool submissions matching certain patterns; some
private-orderflow endpoints rewrite or drop transactions. Liveness
differs over time: a provider that was healthy an hour ago may be
returning stale heads now. A multi-chain engine that hard-codes a
single endpoint per chain will, over a long enough horizon, fail at
each of these axes.

## Architectural Position

The provider router sits inside the chain adapter, below the engine's
generic adapter capabilities (identify, fee-estimate, build, simulate,
sign-prepare, broadcast, watch, finalize) and above the raw HTTP/WS
clients. From the Sentinels' perspective there is one adapter; the
adapter, internally, distributes calls across many providers. The
Archivist instruments every provider call with structured metrics so
the routing layer's decisions become visible and tunable.

## Provider Health Model

Each provider has a health state: latency exponential moving average,
error rate over a sliding window, a per-method support matrix
discovered at registration, and a freshness signal derived from the
gap between its reported head and the consensus head observed across
peers. A provider is "healthy" when its EMA is below a threshold, its
error rate is below a threshold, and its freshness gap is within a
chain-specific tolerance (one block for fast EVM L2s, several blocks
for Bitcoin). A provider that fails any of these moves to "degraded";
a provider that fails all moves to "unhealthy" and is shed from the
pool until a probing heartbeat restores it.

## Routing Strategies by Operation Class

Different operations want different routing strategies; one strategy
per chain is insufficient.

- Read-only state queries (`getBalance`, `getStorageAt`, log scans)
  prefer the lowest-latency healthy provider, with a fallback to the
  next healthiest on transient error. These can also be parallelized
  to multiple providers and reconciled, when the engine wants a high
  confidence read.
- Mempool submission prefers providers with verified pass-through
  semantics — either a public mempool with no rewriting, or a known
  private-orderflow endpoint when the operation specifically requires
  one. Submission MUST NOT silently fail over from a private to a
  public endpoint, because the policy intent of a private submission
  is not satisfied by public broadcast.
- Subscriptions (head, finality, log streams) prefer providers with
  WebSocket support and a track record of stable connections. A
  subscription dropping is qualitatively different from a request
  failing; the routing layer MUST detect drops, reconnect, and
  reconcile missed events on resume.
- Simulation calls prefer providers that support the necessary
  trace/dry-run methods at the necessary depth. Method support is
  not optional here; falling back to a provider that lacks the method
  is a silent loss of safety.

## Failover Discipline

Failover is not retry. Retrying the same provider with the same
request after a transient failure is acceptable for idempotent reads;
failing over to a second provider is a stronger statement, and brings
two risks the routing layer manages explicitly:

- A submission that "failed" on provider A may have been accepted by
  the chain anyway. Replaying on provider B can produce a duplicate
  or a nonce conflict. The routing layer MUST consult the engine's
  idempotency state before issuing a failover submission, and the
  Dispatcher's submission protocol MUST be designed so that a
  duplicate submission of the same signed transaction is harmless
  (same hash, same nonce, no economic ambiguity).
- A read that disagrees between provider A and provider B is a
  signal, not a problem to paper over. The routing layer MUST
  surface the disagreement to the Archivist for investigation, and
  the engine's policy SHOULD treat the more conservative answer
  (lower balance, less optimistic state) as the working answer until
  the disagreement is resolved.

## Provider Diversity for High-Stakes Reads

For reads that gate signing decisions — current nonce, allowance state,
oracle prices, simulated outcomes — the engine prefers concurrent
queries to two or more independent providers and only proceeds when
they agree within a chain-specific tolerance. Disagreement at this
seam is rare, and when it appears it almost always indicates either a
provider bug, a transient fork, or an active attack. None of those
should pass silently into a signed transaction.

## Censorship and Geography

Some providers filter or rate-limit by geography. Some filter by
sanctioned-address patterns, transaction-size patterns, or contract
allowlists. The engine's routing layer MUST allow operators to mark
providers with their known policies and MUST refuse to fall over from
a non-filtering provider to a filtering one for operations the
operator has tagged as policy-sensitive. Geographic distribution of
providers is also a liveness asset: a regional outage that takes down
all local providers is mitigated by routing to a different region's
endpoints with explicit latency budget.

## Configuration and Observability

Provider configuration is data, not code. Adapters consume a
declarative description of their provider pool — endpoints, auth,
declared method support, declared policy posture, declared region —
and the routing layer derives behavior from that description. The
Archivist exports per-provider, per-chain, per-method metrics: success
rate, latency percentiles, freshness gap, agreement rate with peer
providers. These metrics are how operators detect a degrading
provider before it triggers an incident.

## Legion Relevance

The Dispatcher's broadcast guarantees, the Shadow Sentinel's
simulation guarantees, and the Archivist's read consistency
guarantees all bottom out in the routing layer's decisions. A
Sentinel that asks the adapter for a head-of-chain read, expecting a
single authoritative answer, must be served by a routing layer that
has selected a provider whose freshness it has independently
verified. The adapter contract therefore obligates the adapter to
implement provider routing of this shape; without it, the engine's
upper-layer guarantees are fictions resting on whichever provider
happens to be configured as primary.
