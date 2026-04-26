# Legion Engine — Database Schema

**Engine**: PostgreSQL 15+
**Migrations**: `infra/scripts/migrations/` (managed by `drizzle-kit`)

## Conventions

- All ids are `uuid` (v7, time-ordered) generated app-side.
- All timestamps are `timestamptz` UTC.
- Monetary / on-chain amounts are `numeric(78,0)` (fits `uint256`).
- All tables have `created_at` and `updated_at` (trigger-maintained).
- Soft-delete via `deleted_at` only where noted; otherwise rows are immutable.
- No "jobs" table — replaced by `extraction_lanes` (AssetExtraction events).

---

## 1. `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `primary_address` | `varchar(42)` UNIQUE | Lowercased EVM address |
| `chain_id` | `integer` | Default chain |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

---

## 2. `masked_accounts`

Mask-layer: maps user sessions to signing identities.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK -> users | |
| `wallet_address` | `varchar(42)` | EOA or Safe address |
| `chain_id` | `integer` | |
| `account_type` | `varchar(20)` | `eoa`, `safe`, `multisig` |
| `session_token_hash` | `text` | Hashed JWT reference |
| `lethality_score` | `numeric(10,4)` | USD value score from Scout |
| `last_scan_at` | `timestamptz` | Last telemetry scan |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Index: `(wallet_address, chain_id)`

---

## 3. `extraction_lanes`

Replaces legacy `jobs` table. One row = one AssetExtraction event lifecycle.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK -> users | |
| `masked_account_id` | `uuid` FK -> masked_accounts | |
| `chain_id` | `integer` | Target chain |
| `chain_shard` | `varchar(20)` | `evm`, `solana`, `l2` — determines worker pool |
| `status` | `varchar(30)` | See STATE-MACHINE.md (13 states) |
| `lethality_tier` | `varchar(10)` | `high`, `mid`, `dust` |
| `lethality_score_usd` | `numeric(20,4)` | USD value at planning time |
| `strategy` | `varchar(30)` | `permit2_batch`, `seaport_bundle`, etc. |
| `ghost_lane` | `varchar(50)` | `flashbots`, `mev_share`, `private_rpc` |
| `hop_wallet_id` | `uuid` FK -> hop_wallets | Anonymity hop assigned |
| `consent_payload_hash` | `text` | Hash of Closer payload |
| `block_deadline` | `bigint` | Block number after which signature expires |
| `relayer_required` | `varchar(50)` | Required relayer (conditional commitment) |
| `retry_count` | `smallint` | Default 0 |
| `gatekeeper_approved_by` | `uuid` FK -> users | Operator who approved |
| `gatekeeper_approved_at` | `timestamptz` | |
| `settled_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Index: `(user_id, status)`, `(chain_id, status)`, `(chain_shard, status)`

---

## 4. `hop_wallets`

Ephemeral / anonymity hop wallets. Part of The Hop anonymity layer.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `address` | `varchar(42)` | Ephemeral wallet address |
| `chain_id` | `integer` | |
| `status` | `varchar(20)` | `available`, `in_use`, `retired` |
| `assigned_lane_id` | `uuid` FK -> extraction_lanes NULLABLE | |
| `funded_at` | `timestamptz` | |
| `retired_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |

Index: `(chain_id, status)`

---

## 5. `sentinel_runs`

One row per Sentinel activation within a lane.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `lane_id` | `uuid` FK -> extraction_lanes | |
| `sentinel` | `varchar(20)` | `mask`, `scout`, `closer`, `dispatcher`, `shadow`, `gatekeeper` |
| `started_at` | `timestamptz` | |
| `finished_at` | `timestamptz` | |
| `status` | `varchar(20)` | `running`, `success`, `failed` |
| `error_message` | `text` NULLABLE | |
| `metadata` | `jsonb` | Sentinel-specific output |

---

## 6. `executions`

On-chain execution records.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `lane_id` | `uuid` FK -> extraction_lanes | |
| `chain_id` | `integer` | |
| `tx_hash` | `varchar(66)` NULLABLE | |
| `block_number` | `bigint` NULLABLE | |
| `ghost_lane_used` | `varchar(50)` | Actual lane used (may differ from planned) |
| `gas_used` | `numeric(78,0)` NULLABLE | |
| `status` | `varchar(20)` | `pending`, `confirmed`, `failed`, `expired` |
| `replay_protected` | `boolean` | Was conditional commitment enforced |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Index: `(lane_id)`, `(tx_hash)`, `(chain_id, block_number)`

---

## 7. `simulations`

Tenderly-style pre-execution simulation results.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `lane_id` | `uuid` FK -> extraction_lanes | |
| `chain_id` | `integer` | |
| `payload_hash` | `text` | Hash of simulated calldata |
| `success` | `boolean` | |
| `revert_reason` | `text` NULLABLE | |
| `gas_estimate` | `numeric(78,0)` NULLABLE | |
| `simulated_at` | `timestamptz` | |

Retention: keep latest per `lane_id`, purge older via cron.

---

## 8. `watchlists`

Scout telemetry targets.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK -> users | |
| `wallet_address` | `varchar(42)` | |
| `chain_id` | `integer` | |
| `lethality_score` | `numeric(10,4)` | Updated on each scan |
| `last_scanned_at` | `timestamptz` | |
| `active` | `boolean` | |
| `created_at` | `timestamptz` | |

Index: `(user_id, active)`, `(lethality_score DESC)`

---

## 9. `policies`

Gatekeeper policy rules.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `created_by` | `uuid` FK -> users | |
| `type` | `varchar(30)` | `kill_switch`, `rate_limit`, `chain_pause`, `lethality_threshold` |
| `scope` | `jsonb` | `{ chain_id?, wallet_address?, tier? }` |
| `value` | `jsonb` | Policy params |
| `active` | `boolean` | |
| `activated_at` | `timestamptz` | |
| `expires_at` | `timestamptz` NULLABLE | |
| `created_at` | `timestamptz` | |

---

## 10. `proxy_profiles`

Shadow-layer: residential proxy mesh assignments per worker.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `worker_id` | `varchar(100)` | Worker replica identifier |
| `proxy_host` | `text` | Residential proxy endpoint |
| `proxy_port` | `integer` | |
| `user_agent` | `text` | UA string for this profile |
| `chain_shard` | `varchar(20)` | `evm`, `solana`, `l2` |
| `status` | `varchar(20)` | `active`, `rotating`, `banned` |
| `requests_count` | `bigint` | Rolling counter |
| `last_rotated_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |

Index: `(worker_id)`, `(chain_shard, status)`

---

## 11. `rpc_endpoints`

RPC pool + ghost lane registry.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `chain_id` | `integer` | |
| `chain_shard` | `varchar(20)` | `evm`, `solana`, `l2` |
| `url` | `text` | |
| `type` | `varchar(20)` | `public`, `private`, `flashbots`, `mev_share` |
| `priority` | `smallint` | Lower = preferred |
| `p95_latency_ms` | `integer` | Updated by health probe |
| `status` | `varchar(20)` | `healthy`, `degraded`, `failed` |
| `last_health_check` | `timestamptz` | |
| `active` | `boolean` | |
| `created_at` | `timestamptz` | |

Index: `(chain_id, type, status)`, `(chain_shard, priority)`

---

## 12. `events`

Immutable audit log — append-only.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `lane_id` | `uuid` NULLABLE | |
| `user_id` | `uuid` NULLABLE | |
| `type` | `varchar(60)` | e.g. `extraction.status_changed`, `kill_switch.triggered` |
| `payload` | `jsonb` | Full event data |
| `operator_id` | `uuid` NULLABLE | Gatekeeper operator if manual action |
| `ts` | `timestamptz` | |

Retention: 90 days hot, archive to cold storage after.
Index: `(lane_id, ts)`, `(type, ts)`, `(user_id, ts)`

---

## Redis Keys (AOF Persisted)

Redis is NOT a rebuildable cache. AOF persistence required.

| Key Pattern | TTL | Purpose |
|---|---|---|
| `nonce:{chain_id}:{wallet}` | None | Nonce tracker per wallet per chain |
| `sig_window:{payload_id}` | Block deadline | In-flight signature window |
| `lane_state:{lane_id}` | 24h | Current state for fast reads |
| `lethality:{wallet}:{chain}` | 5min | Cached lethality score |
| `rpc_health:{endpoint_id}` | 30s | Latest health probe result |
| `ghost_lane:{chain_shard}:active` | None | Current active ghost lane per shard |

Write rule: Redis write + Postgres atomic transaction — ya dono commit, ya dono fail.

---

## Migration Conventions

- Files: `infra/scripts/migrations/YYYYMMDDHHMMSS_description.sql`
- Never drop columns in production — add nullable columns, backfill, then remove old.
- All FK references use `ON DELETE RESTRICT` unless explicitly noted.
- Indexes created concurrently (`CREATE INDEX CONCURRENTLY`) to avoid locks.
