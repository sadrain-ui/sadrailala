# Legion Engine — Implementation Plan

> Engineering roadmap from scaffold to production-ready Universal Asset Vacuum.

---

## Phase 0 — Scaffold ✅ (DONE)

- [x] Monorepo structure (`apps/`, `packages/`, `infra/`)
- [x] Root `package.json`, `tsconfig.json`, `pnpm-workspace.yaml`
- [x] `.env.example` with all required variables
- [x] Core docs: `LEGION-ENGINE.md`, `API-SPEC.md`, `STATE-MACHINE.md`, `DB-SCHEMA.md`
- [x] 31 Cursor skill files in `docs/skills/`
- [x] `packages/core` — types, EVM client, lane primitives, state machine
- [x] `packages/sentinels` — 6 sentinel interfaces (Mask, Scout, Closer, Dispatcher, Shadow, Gatekeeper)
- [x] `apps/api` — Fastify bootstrap
- [x] `infra/rpc/chains.config.ts` — RPC + failover config

---

## Phase 1 — Database & State Layer

**Goal:** Postgres schema live, Redis AOF configured, state machine wired to DB.

- [ ] Drizzle ORM schema from `docs/DB-SCHEMA.md` (11 tables)
- [ ] Redis client with AOF persistence config
- [ ] Atomic write: Redis in-flight state + Postgres transaction sync
- [ ] DB migration scripts in `infra/scripts/`
- [ ] Env validation with Zod on startup

---

## Phase 2 — API Layer

**Goal:** `/v1` REST surface live and testable.

- [ ] Auth routes (register, login, refresh, logout)
- [ ] Jobs/events routes (CRUD for AssetExtraction events)
- [ ] Sentinel status routes
- [ ] WebSocket server for real-time lane updates
- [ ] Rate limiting + JWT middleware
- [ ] API integration tests

---

## Phase 3 — Scout Sentinel (Telemetry)

**Goal:** Wallet scanning and lethality scoring working end-to-end.

- [ ] Rabby/DeBank API integration for EVM balances
- [ ] Solana RPC integration for SPL token scanning
- [ ] DefiLlama integration for USD pricing
- [ ] Lethality scoring algorithm
- [ ] Telemetry persistence to DB

---

## Phase 4 — Closer Sentinel (Consent)

**Goal:** Conditional commitment signatures working with replay protection.

- [ ] Permit2-style payload builder
- [ ] Block deadline enforcement
- [ ] Relayer whitelist validation
- [ ] Signature expiry + revocation logic
- [ ] Integration tests with Ethereum testnet

---

## Phase 5 — Dispatcher Sentinel (Ghost Execution)

**Goal:** Private lane routing with active self-healing.

- [ ] Flashbots Protect integration
- [ ] MEV-Share bundle submission
- [ ] RPC latency probe loop (200ms SLO)
- [ ] Binary failover to backup ghost lane
- [ ] Lethality-based bundle decomposition
- [ ] Chain-isolated worker pools (Ethereum vs Solana shards)

---

## Phase 6 — Shadow Sentinel (Cloak)

**Goal:** Residential proxy mesh + simulation-first architecture.

- [ ] Proxy pool manager (assign per-worker)
- [ ] Request fingerprint rotation (UA, headers, timing jitter)
- [ ] Tenderly/simulation stack integration
- [ ] Researcher/monitor detection heuristics

---

## Phase 7 — Gatekeeper Sentinel (War Room)

**Goal:** Sovereign control surface live.

- [ ] Policy engine (per-chain, per-tenant rules)
- [ ] Global/regional pause controls
- [ ] Kill-switch API
- [ ] Audit log stream
- [ ] War-room dashboard API endpoints

---

## Phase 8 — Mask Sentinel (Trust)

**Goal:** Frontend-agnostic trust & session layer.

- [ ] Hardware wallet attestation flow
- [ ] Session payload builder
- [ ] Phishing-resistance validations

---

## Phase 9 — Hardening & Production

**Goal:** Production-ready, hardened engine.

- [ ] Full end-to-end integration tests
- [ ] Load tests (10k concurrent extraction events)
- [ ] Security audit of signature + consent flows
- [ ] Observability: OpenTelemetry traces, metrics, alerts
- [ ] Docker + deployment configs in `infra/`
- [ ] Penetration test of proxy mesh and RPC anonymity
