# Legion Engine — Implementation Plan

> Engineering roadmap from scaffold to production-ready Universal Asset Vacuum.

## 🏛️ THE FORGE: ARCHITECTURE INITIALIZATION (WEAPONIZED)
*This setup provides the "Memory" and "Precision" required for 10/10 lethality.*

- **Sovereignty First**: All infrastructure (Postgres, Redis, Proxy Mesh) runs on **Local Docker**. Zero cloud dependency (Neon/Supabase) to ensure absolute control and data privacy.
- **Precision Hardening**: All `uint256` blockchain numbers mapped to `numeric(78, 0)` in Drizzle/Postgres to prevent precision erasure.
- **State Hardening**: Redis **AOF (Append Only File)** persistence enforced. Every strike, state change, and nonce update is disk-backed to ensure crash-recovery.

---

## Phase 0 — Scaffold ✅ (DONE)

* [x] Monorepo structure (`apps/`, `packages/`, `infra/`)
* [x] Root `package.json`, `tsconfig.json`, `pnpm-workspace.yaml`
* [x] `.env.example` with all required variables
* [x] Core docs: `LEGION-ENGINE.md`, `API-SPEC.md`, `STATE-MACHINE.md`, `DB-SCHEMA.md`
* [x] 31 Cursor skill files in `docs/skills/`
* [x] `packages/core` — types, EVM client, lane primitives, state machine
* [x] `packages/sentinels` — 6 sentinel interfaces
* [x] `apps/api` — Fastify bootstrap
* [x] `infra/rpc/chains.config.ts` — RPC + failover config

---

## Phase 1 — Database, State Layer & Proxy Mesh Bootstrap
**Goal:** Postgres schema live, Redis AOF configured, state machine wired to DB.

* [ ] **Drizzle ORM schema** from `docs/DB-SCHEMA.md` (11 tables)
* [ ] **Redis client with AOF persistence config**
* [ ] **Atomic write**: Redis in-flight state + Postgres transaction sync
* [ ] **Local Docker Compose setup** for Postgres 15 + Redis + Mesh
* [ ] **Env validation with Zod** on startup
* [ ] **[NEW] Proxy Pool Manager** — residential proxy mesh init
* [ ] **[NEW] Request Fingerprint Rotation** — UA rotation, header randomization
* [ ] **[NEW] Proxy Health Probe** — async liveness checks

---

## Phase 2 — API Layer
**Goal:** `/v1` REST surface live and testable.

* [ ] Auth routes (register, login, refresh, logout)
* [ ] Jobs/events routes (CRUD for AssetExtraction events)
* [ ] Sentinel status routes
* [ ] WebSocket server for real-time lane updates
* [ ] Rate limiting + JWT middleware
* [ ] API integration tests
