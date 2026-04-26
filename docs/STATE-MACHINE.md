# Legion Engine — State Machine

All sentinel work is modeled as state machines (XState v5 in `packages/core/machines/`). Two machines matter at the API surface:

1. **Job machine** — lifecycle of a single user-submitted job.
2. **Sentinel-run machine** — lifecycle of a single sentinel's pass over a job.

Every transition emits a domain event persisted to `events` (see [`DB-SCHEMA.md`](DB-SCHEMA.md)). State is rebuildable from the event log.

## 1. Job Machine

### 1.1 States

| State | Meaning | Terminal? |
|---|---|---|
| `queued` | Accepted by Gateway, waiting for Dispatcher. | no |
| `routing` | Dispatcher selecting target sentinel(s). | no |
| `gatekeeping` | Gatekeeper running policy checks. | no |
| `simulating` | Shadow running `simulateContract` / `eth_call`. | no |
| `awaiting_signal` | Waiting on Scout for a trigger condition. | no |
| `signing` | Mask producing signed payload. | no |
| `submitting` | Closer broadcasting tx. | no |
| `mined` | Tx included; waiting on confirmations. | no |
| `confirmed` | ≥ N confirmations. | **yes** |
| `cancelled` | User cancellation honored before submit. | **yes** |
| `rejected` | Gatekeeper or Shadow blocked the job. | **yes** |
| `failed` | Unrecoverable error after submit. | **yes** |
| `replaced` | Superseded by a replacement tx. | **yes** |

### 1.2 Transitions

```
queued ─► routing ─► gatekeeping ─┬─► rejected
                                  │
                                  ├─► simulating ─┬─► rejected
                                  │               │
                                  │               └─► awaiting_signal? ─► signing
                                  │
                                  └─► signing ─► submitting ─┬─► failed
                                                             │
                                                             └─► mined ─┬─► confirmed
                                                                        ├─► replaced
                                                                        └─► failed

any non-terminal ─► cancelled    (only if cancel arrives before `submitting`)
```

### 1.3 Guards

- `gatekeepingPasses` — policy + balance + allowlist + kill-switch all green.
- `simulationPasses` — Shadow returns no revert and `policy.maxGasWei` not exceeded.
- `signalArrived` — Scout emitted a matching signal within `policy.deadline`.
- `confirmationsReached` — `block.number - tx.blockNumber >= chain.confirmations`.
- `cancelable` — current state is not `submitting`, `mined`, `confirmed`, `replaced`.

### 1.4 Side Effects (Actions)

| On entry to | Action |
|---|---|
| `routing` | Dispatcher claims job, sets `assigned_sentinels`. |
| `gatekeeping` | Gatekeeper records `policy_check` event. |
| `simulating` | Shadow runs Viem `simulateContract`; result persisted. |
| `signing` | Mask resolves `mask_id` → signer, returns signed tx. |
| `submitting` | Closer calls `walletClient.sendRawTransaction`; nonce reserved. |
| `mined` | Closer subscribes to `watchBlockNumber` for confirmations. |
| `confirmed` | Emit `job.completed`; release nonce; archive. |
| `failed`/`rejected` | Refund any reserved nonce; emit failure event. |
| `replaced` | Link `replaces` / `replaced_by` on `executions`. |

### 1.5 Timeouts

| State | Default timeout | On expiry |
|---|---|---|
| `gatekeeping` | 5s | → `failed` (`POLICY_TIMEOUT`) |
| `simulating` | 15s | → `failed` (`SIMULATION_TIMEOUT`) |
| `awaiting_signal` | `policy.deadline` | → `cancelled` (`DEADLINE_EXCEEDED`) |
| `submitting` | 30s | retry with bumped fee, max 3 attempts → `failed` |
| `mined` | 10 min | → `failed` (`CONFIRMATION_TIMEOUT`) |

## 2. Sentinel-Run Machine

A **sentinel-run** is one execution of one sentinel against one job.

States: `pending → running → succeeded | failed | skipped`.

```
pending ─► running ─┬─► succeeded
                    ├─► failed (with retry policy)
                    └─► skipped (guard returned false, e.g. dry-run only)
```

Retry policy per sentinel (configured in `packages/core/config/retry.ts`):

| Sentinel | Max attempts | Backoff |
|---|---|---|
| Mask | 3 | exponential 200ms → 1.6s |
| Scout | ∞ (long-poll) | jittered 1s |
| Closer | 3 | exponential 1s → 8s, with fee bump |
| Dispatcher | 1 | none |
| Shadow | 2 | linear 500ms |
| Gatekeeper | 1 | none |

`failed` after exhausted retries propagates to the **Job machine** as the trigger for its own `failed` transition.

## 3. Event Log

Every transition writes one row to `events`:

```
event_id       uuid
job_id         uuid
sentinel       enum
from_state     text
to_state       text
payload        jsonb
created_at     timestamptz
```

Replay = `SELECT ... ORDER BY created_at` and fold into the machine's reducer. This is how Redis state is rebuilt after a flush and how audits are produced.

## 4. Concurrency Rules

- **Per `mask_id` × `chain_id`**: at most one job in `submitting` or `mined` at a time (nonce safety). Others wait in `signing`.
- **Per user**: configurable concurrent-job ceiling (default 16) enforced by Dispatcher.
- **Global kill-switch**: Gatekeeper flag in Redis (`legion:killswitch:<chainId>`). When set, all transitions into `submitting` are blocked and the job moves to `rejected`.
