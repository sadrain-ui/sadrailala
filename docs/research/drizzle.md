---
title: "Drizzle ORM"
chain_family: "INFRA"
resource_model: "Mixed"
signing_model: "Mixed"
cross_chain_capable: false
cursor_use: "Logic reference for Forge/Archivist (schema migration safety)"
---

# Drizzle ORM

## Legion Relevance

Drizzle is the canonical schema and migration layer for the Legion Engine's
relational store (Postgres). Every Sentinel that persists state — Scout
(opportunity ledger), Closer (strike receipts), Dispatcher (route artifacts),
Archivist (long-term cold archive), Forge (schema custody) — reads and writes
through Drizzle-defined tables. The Forge owns the schema; the Archivist owns
historical correctness. Because Legion is a multi-chain engine that captures
on-chain numeric values that exceed JavaScript's `Number.MAX_SAFE_INTEGER` and
even 64-bit signed integers, Drizzle's column-level type system is the chokepoint
where numeric integrity is enforced. A schema mistake here silently corrupts
balance, price, and gas accounting downstream — there is no defense in depth
once a `numeric` is implicitly cast to `double precision`.

Drizzle is also the surface where universal chain support is added. New chain
families (Solana, Cosmos, Bitcoin, Substrate) are integrated by extending the
existing tables with additive columns and joining a `chain_registry` row, never
by branching the schema. This document is the Forge's reference for executing
that pattern under live load without taking the engine offline.

## Postgres / Drizzle Migration Model

Drizzle compiles a TypeScript schema (`*.schema.ts`) into raw SQL migrations
(`drizzle-kit generate`). The migrations are plain `.sql` files checked into
the repo and applied in lexical order by `drizzle-kit migrate` or the runtime
migrator (`migrate()` from `drizzle-orm/postgres-js/migrator`). The migration
journal (`__drizzle_migrations`) records the hash of each applied file; a
mismatched hash on a previously applied migration aborts startup, which is the
desired behavior — the Forge never silently re-applies divergent SQL.

Key properties the Forge relies on:

- **Generated, not introspected.** The TS schema is the source of truth. The
  database is reconciled to the schema, never the reverse. Manual `psql`
  changes that bypass the journal will be detected the next time the journal
  is verified.
- **Forward-only by default.** Drizzle does not auto-generate `down`
  migrations. Rollback in production is performed by writing a new forward
  migration that inverts the change, never by reversing the journal.
- **Statement-level granularity.** Each migration file may contain multiple
  statements. Postgres DDL is transactional, so a failed migration leaves the
  database in its prior state — but only if every statement in the file is
  inside the implicit transaction (some statements, e.g. `CREATE INDEX
  CONCURRENTLY`, force the file to be split).

## numeric(78, 0)

Every on-chain integer in Legion that may exceed 2^63 is stored as
`numeric(78, 0)`. The width of 78 is the smallest decimal width that fits an
unsigned 256-bit integer (2^256 − 1 has 78 decimal digits), and the scale of
0 forbids a fractional part. Drizzle exposes this as:

```ts
import { numeric } from "drizzle-orm/pg-core";

amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
```

Critical invariants the Forge enforces:

- The column is read into JavaScript as a **string**, not a `number`. Any
  helper that calls `Number(row.amount)` is a bug — it will silently lose
  precision above 2^53. The Closer and Dispatcher consume these as `bigint`
  via `BigInt(row.amount)`.
- Arithmetic in SQL (`SUM`, `+`, `-`) on `numeric(78,0)` stays exact.
  Aggregates that need a wider intermediate (e.g. `SUM(amount * price)`) must
  cast to `numeric` without a precision argument to allow Postgres's
  unbounded numeric.
- Never use `bigint` (Postgres `int8`) for token balances. `int8` is
  64-bit signed and overflows on any 18-decimal token at multi-million-unit
  scale.
- `numeric` columns must be `NOT NULL` with a default of `'0'` (the string)
  when the field represents a count or balance; nullability is reserved for
  fields that are semantically absent (e.g., "no fee paid").

## Additive Universal Chain Columns

When a new chain family is onboarded, the Forge extends shared tables
(`opportunities`, `strikes`, `routes`, `accounts`) with **additive** columns
rather than forking per-chain tables. The pattern:

1. Add a `chain_id` column referencing `chain_registry(id)` if not already
   present. This column is `NOT NULL` and indexed.
2. Add chain-family-specific optional columns (`solana_slot`,
   `cosmos_sequence`, `bitcoin_vbytes`) as **nullable** with no default.
   Existing rows stay valid; new rows for the new chain populate the field.
3. Add a partial index where the column is non-null:
   `CREATE INDEX ... ON strikes (solana_slot) WHERE solana_slot IS NOT NULL`.
   This keeps the index small and avoids penalising EVM rows.
4. Never widen an existing column's semantics. If EVM `gas_used` and Solana
   compute units don't share units, add `compute_units` as a separate
   column — do not overload `gas_used`.

The result is a schema that is monotonically extended. Old code reading
old columns is unaffected; new code reading new columns gets `NULL` on legacy
rows and handles it explicitly.

## chain_registry

`chain_registry` is the join table that anchors every multi-chain row to a
canonical chain identity. Minimum schema:

```ts
export const chainRegistry = pgTable("chain_registry", {
  id:            text("id").primaryKey(),                  // "evm:1", "svm:mainnet", "cosmos:cosmoshub-4"
  family:        text("family").notNull(),                 // EVM | SVM | UTXO | COSMOS | SUBSTRATE
  display_name:  text("display_name").notNull(),
  native_decimals: integer("native_decimals").notNull(),
  finality_model:  text("finality_model").notNull(),       // "probabilistic" | "deterministic" | "instant"
  rpc_endpoints:   jsonb("rpc_endpoints").$type<string[]>().notNull(),
  active:        boolean("active").notNull().default(true),
});
```

The `id` is a structured string, not a numeric chain ID, because chain IDs are
not globally unique across families (Ethereum's `1` and a hypothetical
Cosmos `1` collide). All foreign keys to `chain_registry` use this string.
The Dispatcher reads `rpc_endpoints` for failover ordering; the Archivist
reads `family` to choose the correct decoder.

## Migration-Safe Rollout

The Legion engine cannot be taken offline for a migration. The Forge's
playbook for any schema change:

1. **Phase 1 — additive deploy.** Add new columns as nullable. Deploy
   migration. Old code is unaffected.
2. **Phase 2 — dual-write.** Deploy code that writes both old and new
   columns. Reads still come from the old column. Run for at least one full
   archival cycle.
3. **Phase 3 — backfill.** Run a chunked, throttled `UPDATE` to populate the
   new column for historical rows. Use `LIMIT` + `WHERE new_col IS NULL` to
   avoid long-held locks. For tables > 100M rows, backfill via the
   Archivist's batch worker, not a single statement.
4. **Phase 4 — switch reads.** Deploy code that reads from the new column.
5. **Phase 5 — drop old.** Only after a full retention window, drop the old
   column in a separate migration.

For indexes: always `CREATE INDEX CONCURRENTLY` in production. Drizzle does
not emit `CONCURRENTLY` automatically — the Forge hand-edits the generated
SQL or uses a custom migration file. The journal hash is computed over the
final SQL, so the edit is durable.

## Pitfalls

- **`drizzle-kit push`.** Useful in local dev, dangerous in production —
  it diffs the schema and applies changes without writing a migration file.
  The Forge bans `push` against any environment with the migration journal
  populated. Production deploys go through `generate` + `migrate` only.
- **Implicit `numeric` → `number` casts.** `drizzle-orm/postgres-js` returns
  `numeric` as a string by default. A custom type or a manual `parseFloat`
  in application code reintroduces precision loss. Audit every read site.
- **Long-running migrations holding `ACCESS EXCLUSIVE`.** A migration that
  rewrites a hot table (e.g. `ALTER TABLE ... ADD COLUMN ... DEFAULT ...`
  with a non-NULL default on Postgres < 11) takes an `ACCESS EXCLUSIVE`
  lock and blocks every reader. Add the column nullable, backfill, then set
  the default — never combine the steps.
- **`CHECK` constraints added on populated tables.** Adding a `CHECK`
  constraint scans the entire table under an exclusive lock. Use `NOT VALID`
  + `VALIDATE CONSTRAINT` to split the work.
- **Foreign keys to high-churn tables.** A new FK constraint validates every
  existing row. On a 100M-row table this can take hours and blocks writes.
  Add as `NOT VALID`, then `VALIDATE` in a separate migration.
- **Migration journal divergence between environments.** If a migration file
  is edited after being applied to staging, its hash changes and production
  startup will fail. Edits are forward-only; once applied anywhere, the file
  is immutable.
- **Schema-level `enum` types.** Postgres enums require a migration to add a
  value (`ALTER TYPE ... ADD VALUE`) and that statement cannot run inside a
  transaction. Drizzle splits the file, but the Forge prefers `text` columns
  with a `CHECK` constraint for chain families — easier to extend, no
  out-of-transaction surprises.
