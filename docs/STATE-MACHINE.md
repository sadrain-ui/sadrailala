# LEGION ENGINE — STATE MACHINE

Ye document Extraction Lane lifecycle ke saare states, transitions, guards, aur side-effects define karta hai. Koi bhi implementation jo is state machine se deviate kare usse explicit risk exception chahiye.

---

## 1. Extraction Lane States (13 States)

```
IDLE
  |
  v
TELEMETRY_SCAN
  |
  v
PLANNING
  |
  v
PENDING_CONSENT
  |
  v
CONSENT_RECEIVED
  |
  v
SIMULATING
  |          \
  v           v
SIM_PASSED   SIM_FAILED --> ABORTED
  |
  v
ROUTING
  |
  v
EXECUTING
  |          \
  v           v
SETTLED     FAILED --> RETRY or ABORTED
  |
  v
HOP_PENDING
  |
  v
COMPLETE
```

| # | State | Description |
|---|---|---|
| 1 | `IDLE` | Lane initialized, no work started |
| 2 | `TELEMETRY_SCAN` | Scout fetching balances, positions, allowances |
| 3 | `PLANNING` | Dispatcher computing lethality decomposition & route plan |
| 4 | `PENDING_CONSENT` | Waiting for Closer to generate & deliver signable payload |
| 5 | `CONSENT_RECEIVED` | Signature received, conditional commitment locked |
| 6 | `SIMULATING` | Shadow running off-chain simulation via Tenderly/Phalcon |
| 7 | `SIM_PASSED` | Simulation success — safe to execute |
| 8 | `SIM_FAILED` | Simulation failed — auto-abort, no execution |
| 9 | `ROUTING` | Dispatcher selecting ghost lane, proxy mesh assignment |
| 10 | `EXECUTING` | Transaction submitted to ghost lane / private relayer |
| 11 | `SETTLED` | On-chain confirmation received |
| 12 | `HOP_PENDING` | Assets in ephemeral hop wallet, awaiting anonymity routing |
| 13 | `COMPLETE` | Full extraction settled in sovereign vault |

Terminal states: `COMPLETE`, `ABORTED`, `SIM_FAILED`
Error states: `FAILED` (recoverable via retry), `ABORTED` (non-recoverable)

---

## 2. Transitions

### 2.1 Happy Path

| From | To | Trigger | Guard |
|---|---|---|---|
| `IDLE` | `TELEMETRY_SCAN` | `lane.start` event | Valid wallet address, chain supported |
| `TELEMETRY_SCAN` | `PLANNING` | Scan complete | Assets found, lethality_score > 0 |
| `PLANNING` | `PENDING_CONSENT` | Plan finalized | Route valid, bundles decomposed |
| `PENDING_CONSENT` | `CONSENT_RECEIVED` | Signature submitted | Signature valid, block_deadline not passed |
| `CONSENT_RECEIVED` | `SIMULATING` | Auto-trigger | value_usd > policy threshold |
| `SIMULATING` | `SIM_PASSED` | Simulation success | gas_used < block_gas_limit, no revert |
| `SIM_PASSED` | `ROUTING` | Auto-trigger | Ghost lane available, proxy assigned |
| `ROUTING` | `EXECUTING` | Bundle submitted | Private relayer accepted bundle |
| `EXECUTING` | `SETTLED` | On-chain confirmation | tx included in block within deadline |
| `SETTLED` | `HOP_PENDING` | Hop wallet funded | Anonymity hop required by policy |
| `HOP_PENDING` | `COMPLETE` | Hop routing done | Assets reached sovereign vault |
| `SETTLED` | `COMPLETE` | Direct complete | Anonymity hop not required (sandbox/low-value) |

### 2.2 Error / Abort Paths

| From | To | Trigger | Side Effect |
|---|---|---|---|
| `SIMULATING` | `SIM_FAILED` | Simulation revert | Lane aborted, signature revoked, alert sent |
| `CONSENT_RECEIVED` | `ABORTED` | block_deadline passed before sim | Signature auto-expired, no execution |
| `EXECUTING` | `FAILED` | Relayer rejection / timeout | Retry eligible if within retry budget |
| `FAILED` | `ROUTING` | Retry triggered | New ghost lane selected (failover) |
| `FAILED` | `ABORTED` | Retry budget exhausted | Final abort, Gatekeeper notified |
| `ANY` | `ABORTED` | Gatekeeper kill-switch | All in-flight lanes halted, signatures revoked |
| `EXECUTING` | `ABORTED` | Bundle leaked to mempool | Signature expired, incident logged |

---

## 3. Guards (Pre-Conditions)

Every transition must pass its guard before proceeding:

| Guard | Check |
|---|---|
| `valid_wallet` | Address format valid, not on blocklist |
| `chain_supported` | Chain in engine's supported set, not paused by policy |
| `assets_found` | Scout found at least 1 extractable asset |
| `route_valid` | Dispatcher found at least 1 valid ghost lane for the chain |
| `signature_valid` | EIP-712 signature verifies against signer_address |
| `block_deadline_valid` | Current block < consent.block_deadline |
| `sim_passed` | Simulation returned success=true |
| `gas_within_limit` | Simulated gas_used < chain block gas limit |
| `relayer_healthy` | Selected ghost lane p95 latency < 200ms |
| `nonce_clean` | No conflicting nonce in Redis + Postgres |
| `hop_funded` | Ephemeral hop wallet balance >= required amount |
| `gatekeeper_approved` | For high-lethality lanes: explicit Gatekeeper approval exists |

---

## 4. Side Effects (Per Transition)

| Transition | Side Effects |
|---|---|
| `IDLE -> TELEMETRY_SCAN` | Create AssetExtraction record in Postgres; emit `extraction.created` event |
| `PLANNING -> PENDING_CONSENT` | Write lethality bundles to Redis (AOF); write plan to Postgres atomically |
| `CONSENT_RECEIVED` | Store signature + conditional commitment in Redis + Postgres; start block_deadline watchdog |
| `SIM_FAILED` | Revoke signature state; write failure reason; emit `simulation.failed` WS event |
| `ROUTING` | Assign proxy profile to lane; log ghost lane selection; emit `lane.routing` event |
| `EXECUTING` | Write tx_hash to Postgres; start confirmation watchdog; emit `extraction.executing` event |
| `SETTLED` | Write block_number, tx_hash, gas_used to Postgres; emit `extraction.settled` event |
| `HOP_PENDING` | Fund ephemeral hop wallet; start hop timeout watchdog |
| `COMPLETE` | Mark extraction complete; archive lane data; emit `extraction.complete` WS event |
| `ABORTED` | Revoke all signatures; clear Redis in-flight state; emit `extraction.aborted` + alert |
| `FAILED -> ROUTING` | Increment retry_count; select new ghost lane; log failover reason |

---

## 5. Timeouts & Retry Policy

### 5.1 Per-State Timeouts

| State | Timeout | On Timeout |
|---|---|---|
| `TELEMETRY_SCAN` | 30s | -> `ABORTED` (scan failed) |
| `PENDING_CONSENT` | Until block_deadline | -> `ABORTED` (signature expired) |
| `SIMULATING` | 15s | -> `SIM_FAILED` |
| `ROUTING` | 10s | -> `FAILED` |
| `EXECUTING` | Until block_deadline | -> `FAILED` (relayer timeout) |
| `HOP_PENDING` | 5 minutes | -> `FAILED` (hop timeout) |

### 5.2 Retry Budget

| Sentinel / Lane Type | Max Retries | Backoff |
|---|---|---|
| EVM high-lethality | 3 | Exponential: 2s, 8s, 30s |
| EVM mid-tier | 2 | Linear: 5s, 15s |
| Solana | 5 | Fast: 400ms, 800ms, 1.6s, 3.2s, 6.4s |
| Hop routing | 2 | Linear: 10s, 30s |

After max retries: transition to `ABORTED`, emit alert, notify Gatekeeper.

---

## 6. Concurrency Rules

1. **Per-wallet nonce safety**: Only one `EXECUTING` lane per (wallet_address, chain_id) at any time. Additional lanes for the same wallet+chain queue at `ROUTING` until current lane reaches `SETTLED`.

2. **Chain-isolated workers**: EVM lanes never share worker pool with Solana lanes. Cross-contamination causes timing failures.

3. **Signature window atomicity**: Consent state (signature + block_deadline) must be written to BOTH Redis (AOF) AND Postgres in a single atomic operation. If either write fails, the lane returns to `PENDING_CONSENT`.

4. **Kill-switch preempts all**: A Gatekeeper kill-switch transitions ALL non-terminal lanes to `ABORTED` regardless of current state. No lane can resist a kill-switch.

5. **Simulation is mandatory** for lanes where `value_usd >= policy.sim_threshold` (default: $100). Low-value sandbox lanes may skip simulation only with explicit policy override.

6. **Ghost lane failover is stateful**: When Dispatcher switches from primary to backup ghost lane, the lane stays in `ROUTING` (not reset to `IDLE`). Retry counter is NOT incremented for failover — only for execution failures.

---

## 7. Redis + Postgres Sync (Persistence Contract)

In-flight state that MUST exist in both Redis (AOF) AND Postgres:

| Data | Redis Key Pattern | Postgres Table |
|---|---|---|
| Nonce tracker | `nonce:{chain_id}:{wallet}` | `sentinel_runs.nonce` |
| Signature window | `sig_window:{payload_id}` | `consent_payloads.expires_at_block` |
| Lane current state | `lane_state:{lane_id}` | `extraction_lanes.status` |
| Block deadline watchdog | `deadline:{payload_id}` | `consent_payloads.block_deadline` |
| Retry counter | `retry:{lane_id}` | `extraction_lanes.retry_count` |

Write order: **Postgres first, Redis second**. On Redis write failure, lane pauses and triggers reconciliation before proceeding.

---

## 8. Sentinel Responsibilities in State Machine

| State Range | Owning Sentinel |
|---|---|
| `IDLE -> PLANNING` | Scout (telemetry + lethality scoring) |
| `PLANNING -> CONSENT_RECEIVED` | Closer (payload generation + signature) |
| `SIMULATING -> SIM_PASSED/FAILED` | Shadow (off-chain simulation) |
| `ROUTING -> EXECUTING` | Dispatcher (ghost lane + proxy selection) |
| `EXECUTING -> SETTLED` | Dispatcher (tx submission + confirmation) |
| `SETTLED -> COMPLETE` | Dispatcher + Shadow (hop routing + anonymity) |
| `ANY -> ABORTED` | Gatekeeper (kill-switch + policy enforcement) |
