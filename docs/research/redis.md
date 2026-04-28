---
title: "Redis"
chain_family: "INFRA"
resource_model: "Mixed"
signing_model: "Mixed"
cross_chain_capable: false
cursor_use: "Logic reference for Archivist/Sovereign Sync (state persistence)"
---

# Redis

Redis is an in-memory data structure store the Legion Engine uses for
ephemeral but durable-enough state: queue backing, idempotency keys,
short-lived locks, rate limiters, run-time caches of provider responses,
and the live tail of the Archivist's append-only journal. Treating Redis
as a database — rather than as a cache — places hard constraints on
durability configuration, atomicity primitives, and key naming. This
document records those constraints.

## Persistence: AOF and appendfsync

Redis offers two persistence mechanisms: RDB (periodic point-in-time
snapshots) and AOF (append-only file of every write command). For an
engine that must replay queues after a crash, AOF is the only acceptable
primary mechanism; RDB is at most a complement. AOF's durability is
governed by the `appendfsync` setting:

- `always` — fsync after every write. Maximum durability, lowest
  throughput. Acceptable only for low-volume, high-stakes keys; not
  acceptable as a global default for a busy queue host.
- `everysec` — fsync once per second. Bounded data loss to about one
  second of writes on a crash. The pragmatic default for queue and
  journal workloads.
- `no` — let the kernel decide. Unbounded data loss. Unsafe for the
  engine's purposes.

The engine MUST run Redis with AOF enabled and `appendfsync everysec`
at minimum. Hosts that back signed-but-unbroadcast transactions or
the durable side of the Archivist journal SHOULD either run with
`appendfsync always` or fence those keys behind a write-through to a
stronger store before acknowledging the originating job.

## Streams

Redis Streams (`XADD`, `XREAD`, `XGROUP`, `XACK`, `XPENDING`, `XCLAIM`)
are the ordered-log primitive on which the Archivist's chain-of-events
log and BullMQ's queue topology are built. A stream entry has a
monotonically increasing id (`ms-seq`) which is also a coarse-grained
timestamp. Consumer groups give at-least-once delivery with explicit
acknowledgment; an entry remains in the Pending Entries List until
`XACK` is called. The engine MUST treat stream consumers as crash-safe
worker processes that re-read from their last acked id on restart, and
MUST set a maximum stream length (`MAXLEN ~ N`) on streams that are
trimmed by the Archivist's compaction pass to bound memory.

## Atomicity: Lua and MULTI

Redis offers two atomicity primitives. `MULTI/EXEC` queues commands and
executes them atomically against the same shard, but cannot branch on
intermediate values. Lua scripts (`EVAL`/`EVALSHA`) execute server-side
with full read-then-write decision power, also atomically against the
shard. The engine prefers Lua for any atomicity that requires a check —
"set this idempotency key only if absent and add the job", "claim this
lock only if its owner matches the holder token", "atomically move
this entry from the in-flight stream to the failed stream while
incrementing a counter". Both primitives execute on a single shard;
neither is a substitute for a distributed transaction, and adapter
code MUST NOT attempt one across shards.

## Idempotency Keys

Every externally visible side effect the engine performs (broadcast,
provider call, message send) carries an idempotency key. The key is
stored in Redis with a TTL chosen to outlive the side effect's
plausible retry window. The pattern is `SET key value NX PX <ttl>`
in Lua, returning the prior value when present so the caller can
detect a duplicate and short-circuit. Keys MUST be deterministic
functions of the operation's inputs (request id, target, nonce or
equivalent) and MUST NOT include wall-clock time, otherwise legitimate
retries are seen as new operations. TTLs SHOULD be at least 2x the
upstream maximum retry window.

## Key Naming

A consistent naming scheme is non-optional in a system that hosts
seven chain families' worth of state in one keyspace. The engine uses
a colon-separated, hierarchical scheme:

`legion:<env>:<sentinel>:<chain_id>:<chain_shard>:<entity>:<id>`

For example: `legion:prod:dispatcher:eip155-1:0:tx:0xabc...`. Keys
MUST be prefixed by environment so a misconfigured client cannot
collide production with staging. Keys MUST be scoped by `(chain_id,
chain_shard)` so that a chain-wide flush (e.g., reset a misbehaving
shard's queues) is a `SCAN` over a known prefix. Hash-tags
(`{...}`) are used only when a Lua script must operate on multiple
keys atomically and the deployment is clustered, in which case the
hash tag MUST be the `(chain_id, chain_shard)` pair so co-location
is by chain rather than by entity.

## Replication Pitfalls

Redis replication is asynchronous by default. A successful write to
the primary is not yet a durable, replicated write; a failover that
follows immediately can lose acknowledged data. Three concrete
pitfalls follow:

- A `SET` followed by a fast failover may be visible only on the old
  primary, which is then demoted. The engine MUST either use
  `WAIT numreplicas timeout` after writes whose loss would corrupt
  external state, or accept the loss window and design idempotency to
  recover from it.
- Lua scripts execute on the primary; a failover mid-script does not
  replicate the partial effect. Recovery is by replay against the new
  primary; scripts MUST be re-runnable.
- Sentinel/Cluster failovers can promote a replica that lags by more
  than `appendfsync` would suggest, because replication is independent
  of AOF durability. Critical writes SHOULD be persisted in a stronger
  store before acknowledging the work.

## Legion Relevance

Redis is the substrate the Archivist persists short-horizon state to,
the queue backing the Sovereign Sync workers consume, and the lock
broker the Dispatcher uses for nonce reservation. The configuration
choices above (AOF + `everysec` floor, Lua-based idempotency, scoped
key naming, awareness of replication's asynchrony) are what make
Redis safe in those roles; a Redis run with default RDB-only
persistence would invalidate the engine's at-least-once guarantees
on the first crash. Sovereign Sync's restart procedure is built on
the assumption that any acked stream entry is recoverable, which in
turn rests on the AOF posture this document mandates.
