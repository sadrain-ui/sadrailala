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

## Phase 1 — Database, State Layer & Proxy Mesh Bootstrap

**Goal:** Postgres schema live, Redis AOF configured, state machine wired to DB.
**🛡️ UPGRADE [IP Blacklisting Fix]:** Shadow proxy mesh bootstrapped HERE — before any scanning begins. Persistent anonymity from block 1.

- [ ] Drizzle ORM schema from `docs/DB-SCHEMA.md` (11 tables)
- [ ] Redis client with AOF persistence config
- [ ] Atomic write: Redis in-flight state + Postgres transaction sync
- [ ] DB migration scripts in `infra/scripts/`
- [ ] Env validation with Zod on startup
- [ ] **[NEW] Proxy Pool Manager** — residential proxy mesh init, per-worker assignment logic (moved from Phase 6)
- [ ] **[NEW] Request Fingerprint Rotation** — UA rotation, header randomization, timing jitter baseline (moved from Phase 6)
- [ ] **[NEW] Proxy Health Probe** — async liveness checks, dead proxy eviction, automatic pool replenishment

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

## Phase 3 — Scout Sentinel (Telemetry + Protocol Adapters)

**Goal:** Wallet scanning, lethality scoring, AND deep protocol asset discovery working end-to-end.
**🛡️ UPGRADE [Surface-Level Scanning Fix]:** Protocol Adapters injected — staked, lending, LP assets are now visible.
**🛡️ HARDENING [Rate-Limit Trap Fix]:** Multicall3 is PRIMARY scan source. DeBank/Rabby APIs are metadata-only fallback.

- [ ] **[HARDENED] Native RPC Scanning via Multicall3** — PRIMARY balance source, batches 100s of calls in 1 RPC round-trip, no rate-limit dependency
- [ ] **[HARDENED] DeBank/Rabby API** — SECONDARY source only, used for metadata enrichment (token names, logos, tags)
- [ ] Solana RPC integration for SPL token scanning
- [ ] DefiLlama integration for USD pricing
- [ ] Lethality scoring algorithm
- [ ] Telemetry persistence to DB
- [ ] **[NEW] Protocol Adapter: Staking** — Lido, RocketPool, EigenLayer staked ETH/LST detection
- [ ] **[NEW] Protocol Adapter: Lending** — Aave v3, Compound v3 aToken/cToken collateral + debt positions
- [ ] **[NEW] Protocol Adapter: LP Positions** — Uniswap v2/v3/v4, Curve, Balancer LP share unwrapping
- [ ] **[NEW] Protocol Adapter: Yield Vaults** — ERC-4626 vault share detection (Yearn, Morpho, etc.)
- [ ] **[NEW] Protocol Adapter: Solana DeFi** — Raydium LP, Marinade staked SOL, Kamino lending positions

---

## Phase 4 — Closer Sentinel (Consent)

**Goal:** Conditional commitment signatures working with replay protection.

- [ ] Permit2-style payload builder
- [ ] Block deadline enforcement
- [ ] Relayer whitelist validation
- [ ] Signature expiry + revocation logic
- [ ] Integration tests with Ethereum testnet

---

## Phase 5 — Dispatcher Sentinel (Ghost Execution + Simulation Gate + Solana TPU)

**Goal:** Private lane routing with active self-healing, zero failed mainnet txs, Solana sub-200ms.
**🛡️ UPGRADE [Gas Hemorrhage Fix]:** Simulation Gate injected — every tx simulated before mainnet submission.
**🛡️ HARDENING [Solana Latency Fix]:** Geyser Plugin + direct TPU client replaces standard RPC for Solana.

- [ ] Flashbots Protect integration
- [ ] MEV-Share bundle submission
- [ ] RPC latency probe loop (200ms SLO — EVM chains)
- [ ] Binary failover to backup ghost lane
- [ ] Lethality-based bundle decomposition
- [ ] Chain-isolated worker pools (Ethereum vs Solana shards)
- [ ] **[NEW] Simulation Gate** — every transaction runs Tenderly/Anvil shadow-fork simulation BEFORE mainnet submission; tx blocked if revert detected
- [ ] **[NEW] Gas Estimator Oracle** — dynamic gas cap per tx, slippage-adjusted, prevents gas hemorrhage on complex multi-hop routes
- [ ] **[NEW] Solana Geyser Plugin Integration** — account change streams for sub-50ms wallet state updates
- [ ] **[NEW] Solana TPU Client** — direct Transaction Processing Unit submission, bypasses standard RPC bottleneck, targets <100ms submission latency
- [ ] **[NEW] Solana Priority Fee Oracle** — dynamic compute unit + priority fee calculation for guaranteed slot inclusion

---

## Phase 6 — Shadow Sentinel (Cloak — Advanced)

**Goal:** Full stealth layer hardening beyond Phase 1 bootstrap.
**Note:** Proxy mesh basics already live from Phase 1. This phase adds advanced stealth intelligence.

- [ ] Advanced researcher/monitor detection heuristics
- [ ] TLS/JA3 fingerprint spoofing
- [ ] Behavioral timing analysis (detect honeypot traps)
- [ ] Proxy mesh auto-scaling — burst capacity on high-value extractions
- [ ] IP reputation scoring — auto-blacklist burned proxies
- [ ] Dark pool routing — high-value jobs routed through premium residential proxies only

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
- [ ] **[NEW] Rate-limit stress test** — verify Multicall3 primary path handles 10k scans with zero DeBank/Rabby dependency
- [ ] **[NEW] Solana TPU load test** — verify <100ms submission at 1k concurrent Solana extraction events
- [ ] **[NEW] Simulation Gate audit** — verify 0% mainnet revert rate across all chains

---

## 🛡️ Upgrade Registry

> Tracking all injected critical hardening upgrades.

| # | Vulnerability | Fix | Phase | Impact |
|---|---|---|---|---|
| U-01 | IP Blacklisting | Proxy Mesh bootstrapped in Phase 1 | P1 | Persistent anonymity from first scan |
| U-02 | Surface-Level Scanning | Protocol Adapters added to Scout | P3 | Staked/Lending/LP assets now visible |
| U-03 | Gas Hemorrhage | Simulation Gate added to Dispatcher | P5 | 0% failed transactions on Mainnet |
| U-04 | Rate-Limit Trap | Multicall3 as PRIMARY, APIs as metadata fallback | P3 | Zero DeBank/Rabby rate-limit dependency |
| U-05 | Solana Latency | Geyser Plugin + TPU Client | P5 | <100ms Solana submission latency |
