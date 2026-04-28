---
title: "BullMQ"
chain_family: "INFRA"
resource_model: "Mixed"
signing_model: "Mixed"
cross_chain_capable: false
cursor_use: "Logic reference for Sovereign Sync (worker queues)"
---

# BullMQ

BullMQ is a Redis-backed job queue used by the Legion Engine as the
execution substrate for Sovereign Sync workers. Each Sentinel that
performs an external side effect — broadcast, provider call, scheduled
recheck, deferred reconciliation — emits a job that a worker pool
consumes. BullMQ is preferred over its predecessor (Bull) and over
Redis Streams alone because it provides typed queues, named jobs,
delayed execution, repeatable cron-like jobs, configurable retry
strategies with backoff, and a stalled-job recovery loop that fits the
engine's at-least-once execution model.

## Redis-Backed Job Queues

A BullMQ queue is a set of Redis keys (a wait list, an active list, a
delayed sorted set, a completed/failed set, and a metadata hash). The
queue's atomicity guarantees come from Lua scripts that move a job
between these structures in a single Redis command. Because the
substrate is Redis, the durability and replication discussion in the
Redis research applies in full: a queue's at-least-once guarantee is
no stronger than the AOF posture of its Redis host. Production queues
MUST run on a Redis instance configured with AOF and `appendfsync
everysec` or stronger.

## Chain-Isolated Workers

The engine partitions queues by `(chain_id, chain_shard)`. Each chain
shard has its own queue, its own worker pool, and its own concurrency
budget. The reasons are operational and correctness-driven:

- A misbehaving chain (RPC outage, fee spike, mempool congestion)
  causes its queue to back up. Isolation prevents that backpressure
  from starving other chains' workers.
- Per-chain rate limits (provider QPS caps, mempool quotas) are simpler
  to enforce on a chain-scoped queue than on a shared one.
- Per-chain pause/drain operations during incidents, runtime upgrades,
  or maintenance windows are local: the operator drains
  `legion:prod:dispatcher:eip155-1:0` without affecting Solana or
  Polkadot workers.

Workers MUST declare which `(chain_id, chain_shard)` they serve at
startup and MUST refuse to consume from queues outside their declared
set, so a misconfigured deployment cannot cross-pollinate chain logic.

## Idempotency

Jobs are submitted with an explicit `jobId` whose value is a
deterministic function of the operation's inputs. BullMQ deduplicates
on `jobId` within the queue: a second `add` with the same id returns
the existing job rather than enqueueing a duplicate. The Sentinel
emitting a job MUST construct the id from the same inputs that
generate the upstream idempotency key in Redis, so retries from
multiple layers (HTTP retry, Sentinel retry, queue retry) collapse to
one external side effect. When jobs perform externally observable
operations, the worker MUST also short-circuit on the upstream
idempotency key inside the handler, because BullMQ's deduplication is
queue-scoped and does not protect against a job that was enqueued,
processed, and then re-emitted after the queue cleaned up its
`completed` record.

## Retries and Backoff

Workers fail. Networks fail. Providers fail. BullMQ exposes
`attempts` and `backoff` per job; the engine standardizes on
exponential backoff with jitter and a per-chain cap. The cap is
chain-aware because the cost of a stale retry differs by family — a
re-broadcast of a stale EVM transaction with the same nonce is
harmless if the original was dropped, but a re-broadcast of a UTXO
transaction with the same inputs but new fee competes with itself
unless RBF semantics are observed. The retry policy MUST therefore
be supplied by the chain adapter, not hard-coded in the worker.

Failed jobs that exceed `attempts` move to the failed set and are not
retried automatically. The Archivist consumes the failed set on a
slow loop, opens an incident record, and either escalates or marks
the operation abandoned. A failed job MUST NOT silently disappear:
the failed set is part of the audit surface.

## Repeatable Jobs

Repeatable jobs schedule themselves at a cron expression or a fixed
interval. The engine uses these for housekeeping: reorg sweeps, fee
oracle refreshes, finality watcher polls, idempotency-key TTL
sweepers. Repeatable jobs are subtle: BullMQ schedules the next
occurrence when the current one starts, not when it completes, so a
long-running occurrence can collide with its successor. Workers
processing repeatable jobs MUST be designed to be safely
re-entrant or MUST acquire a chain-scoped lock at the start of the
job and skip if held.

## Stalled Jobs

A job is "stalled" when its worker has not heartbeated within the
configured stall interval. BullMQ's stalled-check loop moves stalled
jobs back to wait for re-pickup. This is the at-least-once recovery
mechanism for crashed workers, but it has two failure modes the
engine guards against:

- A worker that is alive but slow may be falsely classified as
  stalled, causing duplicate execution. The stall interval MUST be
  comfortably longer than the slowest legitimate job in the queue,
  with a margin for GC pauses and provider tail latency.
- A worker that has crashed mid-side-effect leaves an external side
  effect that the re-picked-up job will repeat. The handler MUST
  check the upstream idempotency key before performing the side
  effect again; the queue alone cannot make a side effect
  exactly-once.

## Queue Topology

The engine's recommended topology, per `(chain_id, chain_shard)`:

- One `dispatch` queue for outbound transaction submission.
- One `watch` queue for finality and reorg observation.
- One `reconcile` queue for slow correctness loops.
- One `incident` queue for human-paged anomalies.

Queues are not nested. Cross-chain workflows are coordinated by the
Sentinel emitting follow-up jobs to the destination chain's queues,
not by sharing a queue across chains. The topology is flat by chain,
deep by stage; this keeps backpressure local and lets operators
reason about each chain's pipeline independently.

## Legion Relevance

Sovereign Sync is the orchestration surface that maps the engine's
abstract operations onto BullMQ's concrete queues. The chain-isolated
worker model above is what allows the Dispatcher to push work into a
shared infrastructure layer without coupling chains' fates. The
idempotency contract — `jobId` derived from operation inputs, plus a
worker-side check against the Redis idempotency key — is what makes
the engine's at-least-once delivery posture compose with external
side effects safely. The stalled-job and repeatable-job semantics
shape Sovereign Sync's restart and housekeeping behavior; ignoring
either invariant produces duplicate transactions or missed reorg
sweeps respectively.
