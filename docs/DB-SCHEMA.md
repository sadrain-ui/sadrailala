# Legion Engine — Database Schema

**Engine**: PostgreSQL 15+
**Migrations**: `infra/scripts/migrations/` (managed by `drizzle-kit`)
**Conventions**: 1

- All ids are `uuid` (v7, time-ordered) generated app-side unless noted.
- All timestamps are `timestamptz` UTC.
- Monetary / on-chain amounts are `numeric(78,0)` (fits `uint256`).
- All tables have `created_at` and `updated_at` (trigger-maintained).
- Soft-delete via `deleted_at` only where noted; otherwise rows are immutable.

---

## 1. `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `primary_address` | `varchar(42)` UNIQUE | Lowercased EVM address |
| `display_name` | `text` NULL | |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Index: `idx_users_primary_address` on `primary_address`.

## 2. `masked_accounts` (Mask)

Each row is a sanctioned signer the user has linked.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | The `mask_id` exposed via API |
| `user_id` | `uuid` FK → `users.id` | |
| `address` | `varchar(42)` | Lowercased |
| `chain_id` | `int` | |
| `signer_kind` | `enum('eoa','session_key','smart_account')` | |
| `metadata` | `jsonb` | Session-key permissions, AA factory, etc. |
| `revoked_at` | `timestamptz` NULL | Soft-revoke |
| `created_at` | `timestamptz` | |

Indexes:
- `idx_masked_user_chain` on `(user_id, chain_id)`
- `uniq_masked_addr_chain` UNIQUE on `(address, chain_id)` WHERE `revoked_at IS NULL`

## 3. `jobs`

The unit of work referenced everywhere in the API.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users.id` | |
| `mask_id` | `uuid` FK → `masked_accounts.id` | |
| `kind` | `enum('swap','transfer','approve','custom')` | |
| `chain_id` | `int` | |
| `status` | `enum` | See STATE-MACHINE.md §1.1 |
| `payload` | `jsonb` | Kind-specific request body |
| `policy` | `jsonb` | Caps, deadline, `simulate_first` |
| `idempotency_key` | `text` NULL | UNIQUE per `user_id` |
| `error` | `jsonb` NULL | RFC-7807 doc on terminal failure |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |
| `terminal_at` | `timestamptz` NULL | Set when status becomes terminal |

Indexes:
- `idx_jobs_user_status` on `(user_id, status, created_at DESC)`
- `idx_jobs_status_open` on `(status)` WHERE `terminal_at IS NULL` (hot queue scans)
- `uniq_jobs_idem` UNIQUE on `(user_id, idempotency_key)` WHERE `idempotency_key IS NOT NULL`

## 4. `sentinel_runs`

One row per sentinel pass over a job (see STATE-MACHINE.md §2).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `job_id` | `uuid` FK → `jobs.id` | |
| `sentinel` | `enum('mask','scout','closer','dispatcher','shadow','gatekeeper')` | |
| `attempt` | `int` | 1-indexed |
| `status` | `enum('pending','running','succeeded','failed','skipped')` | |
| `input` | `jsonb` | |
| `output` | `jsonb` NULL | |
| `error` | `jsonb` NULL | |
| `started_at` | `timestamptz` NULL | |
| `finished_at` | `timestamptz` NULL | |

Indexes:
- `idx_sruns_job` on `(job_id, started_at)`
- `idx_sruns_sentinel_status` on `(sentinel, status)`

## 5. `executions` (Closer)

One row per broadcast tx, including replacements.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `job_id` | `uuid` FK → `jobs.id` | |
| `chain_id` | `int` | |
| `from_address` | `varchar(42)` | |
| `to_address` | `varchar(42)` NULL | |
| `nonce` | `bigint` | |
| `tx_hash` | `varchar(66)` UNIQUE NULL | Null until broadcast accepted |
| `raw_tx` | `bytea` | Signed tx bytes |
| `gas_limit` | `numeric(78,0)` | |
| `max_fee_per_gas` | `numeric(78,0)` | |
| `max_priority_fee_per_gas` | `numeric(78,0)` | |
| `value` | `numeric(78,0)` | |
| `status` | `enum('pending','mined','confirmed','dropped','replaced','failed')` | |
| `block_number` | `bigint` NULL | |
| `gas_used` | `numeric(78,0)` NULL | |
| `effective_gas_price` | `numeric(78,0)` NULL | |
| `replaces` | `uuid` FK → `executions.id` NULL | |
| `replaced_by` | `uuid` FK → `executions.id` NULL | |
| `submitted_at` | `timestamptz` NULL | |
| `confirmed_at` | `timestamptz` NULL | |

Indexes:
- `idx_exec_job` on `(job_id)`
- `idx_exec_chain_nonce` on `(chain_id, from_address, nonce)`
- `idx_exec_status_open` on `(status)` WHERE `status IN ('pending','mined')`

## 6. `signals` (Scout)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `watchlist_id` | `uuid` FK → `watchlists.id` | |
| `chain_id` | `int` | |
| `kind` | `enum('event_log','price','mempool','block')` | |
| `source` | `text` | Contract addr, feed id, etc. |
| `payload` | `jsonb` | Decoded log / price tick |
| `block_number` | `bigint` NULL | |
| `tx_hash` | `varchar(66)` NULL | |
| `observed_at` | `timestamptz` | |

Indexes:
- `idx_signals_watch_observed` on `(watchlist_id, observed_at DESC)`
- `idx_signals_chain_block` on `(chain_id, block_number)`

## 7. `watchlists` (Scout)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users.id` | |
| `name` | `text` | |
| `chain_id` | `int` | |
| `filter` | `jsonb` | Viem-compatible filter (addresses, topics, abi events) |
| `enabled` | `boolean` DEFAULT `true` | |
| `created_at` | `timestamptz` | |

Index: `idx_watch_user_enabled` on `(user_id, enabled)`.

## 8. `simulations` (Shadow)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `job_id` | `uuid` FK → `jobs.id` | |
| `chain_id` | `int` | |
| `block_number` | `bigint` | Snapshot block |
| `request` | `jsonb` | Viem `simulateContract` args |
| `result` | `jsonb` | Return data, gas estimate, state diff summary |
| `reverted` | `boolean` | |
| `revert_reason` | `text` NULL | |
| `created_at` | `timestamptz` | |

Index: `idx_sim_job` on `(job_id, created_at DESC)`.

## 9. `policies` (Gatekeeper)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `scope` | `enum('global','user','mask')` | |
| `scope_id` | `uuid` NULL | Null for `global` |
| `kind` | `enum('allowlist','denylist','rate_limit','spend_cap','killswitch')` | |
| `config` | `jsonb` | Kind-specific |
| `enabled` | `boolean` DEFAULT `true` | |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Index: `idx_policies_scope_kind` on `(scope, scope_id, kind)` WHERE `enabled`.

## 10. `events` (audit + state replay)

Append-only log of every state transition.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `job_id` | `uuid` FK → `jobs.id` NULL | |
| `sentinel_run_id` | `uuid` FK → `sentinel_runs.id` NULL | |
| `sentinel` | `enum` NULL | |
| `from_state` | `text` NULL | |
| `to_state` | `text` NULL | |
| `payload` | `jsonb` | |
| `created_at` | `timestamptz` | |

Indexes:
- `idx_events_job_time` on `(job_id, created_at)`
- BRIN on `created_at` for cheap range scans during replay

## 11. `rpc_endpoints` (infra/rpc)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `chain_id` | `int` | |
| `url` | `text` | |
| `weight` | `int` DEFAULT `1` | Weighted fallback selection |
| `last_latency_ms` | `int` NULL | |
| `last_error_at` | `timestamptz` NULL | |
| `enabled` | `boolean` DEFAULT `true` | |

Index: `idx_rpc_chain_enabled` on `(chain_id, enabled)`.

---

## 12. Retention

| Table | Retention | Mechanism |
|---|---|---|
| `events` | 180 days | Daily partition drop (BRIN-friendly) |
| `signals` | 30 days | Daily partition drop |
| `simulations` | 90 days | Cron purge, keep latest per `job_id` |
| `sentinel_runs` | with parent `job` | CASCADE on `jobs` archival |
| `jobs` | 2 years (terminal) | Move to cold table `jobs_archive` after 90 days |
| `executions` | 2 years | Same as `jobs` |

## 13. Foreign Key Behavior

- `ON DELETE` for tenant-owned rows (`watchlists`, `policies` with `scope_id`): `CASCADE`.
- For analytical lineage (`executions`, `simulations`, `events`): `RESTRICT` — never auto-deleted; use archival.

## 14. Migration Style

- One file per change, prefixed with timestamp: `20260427T015200_add_policies.sql`.
- Forward-only. Rollback is performed via a new forward migration. No down-migrations in production.
- Every migration must be safe under rolling deploy: add columns nullable, backfill, then add `NOT NULL` in a follow-up.
