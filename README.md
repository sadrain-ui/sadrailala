# Legion Engine

**Sovereign Asset Extraction & Control System**

Legion Engine is an institutional-grade, API-first orchestration layer designed for high-velocity asset extraction and sovereign control across multiple chains. It is built to be frontend-agnostic, integrating directly with any UI while maintaining a hardened, simulation-first backend.

## 🏛 The Sentinel Matrix

The engine is orchestrated by six specialized sentinels:

*   **Mask**: Trust & Infiltration (Signer/Account abstraction)
*   **Scout**: Discovery & Telemetry (Chain scanning)
*   **Closer**: Consent & Signatures (Payload preparation)
*   **Dispatcher (Ghost)**: Private Execution (Routing & Lanes)
*   **Shadow**: Cloaking & Simulation (Fingerprinting defense)
*   **Gatekeeper**: War-Room Control (Policy enforcement)

## 🛠 Core Architecture

Legion is designed around **Extraction Lanes**—chain-isolated, sharded execution environments that ensure failover reliability and maximum performance.

*   **API-First**: Standardized REST/WS interface for any frontend.
*   **Simulation-First**: All extractions are simulated and validated before commitment.
*   **Self-Healing**: Active telemetry monitors RPC health and lane latency, triggering automatic failover.
*   **Anonymity Layer**: Proxy mesh and metadata cloaking to prevent RPC/MEV leakage.

## 📚 Documentation

Detailed specifications are available in the `docs/` directory:

*   [**LEGION-ENGINE.md**](./docs/LEGION-ENGINE.md): Core Philosophy, Sentinel Matrix, and System Design.
*   [**API-SPEC.md**](./docs/API-SPEC.md): Full API reference for telemetry, extractions, and consent flows.
*   [**STATE-MACHINE.md**](./docs/STATE-MACHINE.md): Lifecycle of an Extraction Lane (13-state model).
*   [**DB-SCHEMA.md**](./docs/DB-SCHEMA.md): Tenant-aware PostgreSQL schema for institutional scale.

## 🚀 Getting Started

1.  **Monorepo Structure**: Use `pnpm` to manage workspace packages.
2.  **Infrastructure**: Requires PostgreSQL 15+ and Redis with AOF persistence.
3.  **Environment**: See `infra/config/` for Sentinel configuration.

---

*This is a tool for sovereign operators. Use with precision.*
