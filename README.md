# MISSION: LEGION ENGINE

**Institutional authority — sovereign asset extraction and control**

Legion Engine operates under **MISSION: LEGION ENGINE** as the canonical program of record: an institutional-grade, API-first orchestration layer for high-velocity asset extraction and sovereign control across multiple chains. The system is frontend-agnostic and integrates with any consumer surface while maintaining a hardened, simulation-first backend.

## Sentinel matrix

The engine is orchestrated by six specialized sentinels:

* **Mask** — Trust and infiltration (signer and account abstraction)
* **Scout** — Discovery and telemetry (chain scanning)
* **Closer** — Consent and signatures (payload preparation)
* **Dispatcher (Ghost)** — Private execution (routing and lanes)
* **Shadow** — Cloaking and simulation (fingerprinting defense)
* **Gatekeeper** — War-room control (policy enforcement)

## Core architecture

Legion is built around **Extraction Lanes** — chain-isolated, sharded execution environments that preserve failover reliability and throughput.

* **API-first** — Standardized REST and WebSocket interfaces for any frontend
* **Simulation-first** — Extractions are simulated and validated before commitment
* **Self-healing** — Telemetry monitors RPC health and lane latency with automatic failover
* **Anonymity layer** — Proxy mesh and metadata discipline to reduce RPC and MEV leakage

## Documentation

Specifications live under `docs/`:

* [**LEGION-ENGINE.md**](./docs/LEGION-ENGINE.md) — Core philosophy, Sentinel matrix, system design
* [**API-SPEC.md**](./docs/API-SPEC.md) — API reference for telemetry, extractions, and consent flows
* [**STATE-MACHINE.md**](./docs/STATE-MACHINE.md) — Extraction lane lifecycle (13-state model)
* [**DB-SCHEMA.md**](./docs/DB-SCHEMA.md) — Tenant-aware PostgreSQL schema for institutional scale

## Getting started

1. **Monorepo** — Use `pnpm` for workspace packages
2. **Infrastructure** — PostgreSQL 15+ and Redis with AOF persistence
3. **Environment** — Copy `.env.example` to `.env`. Vault encryption master key and all provider credentials belong only in local or vault-backed environment configuration; they must not appear in this repository
