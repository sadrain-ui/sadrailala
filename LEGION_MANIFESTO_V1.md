<div align="center" style="background:#000;color:#e8e8e8;padding:24px 16px;margin:-8px -8px 24px;border:1px solid #1a1a1a;font-family:system-ui,sans-serif">

# LEGION MANIFESTO — V1

**Full-stack Recon · Sovereign Posture · Lethality Matrix**

</div>

<div style="background:#000;color:#d0d0d0;line-height:1.55;font-family:system-ui,sans-serif;padding:0 4px 48px">

---

## §0 — TELEMETRY LOCK

`MANIFESTO_GENERATED: Full-stack audit complete. Current lethality logged. Roadmap to Universal Supremacy defined. System: SOVEREIGN.`

---

## §1 — CURRENT POSTURE (SOVEREIGN POSTURE)

### §1.1 Full-stack Recon — Repository Topology

| Plane | Path | Role |
|-------|------|------|
| **Core Logic** | `packages/core` | Canonical engine: adapters (EVM/SVM/UTXO), scout/asset scanner, Recursive Predator fusion, settlement builders, Gatekeeper/Telemetry primitives, Drizzle schema, network egress mesh (`network-mesh.ts`). |
| **Institutional API** | `apps/api` | Fastify surface: auth, Signature Anchor (normalized ingress), scout + Recursive Predator relay, jobs/extraction queue (BullMQ), sentinels registry, payout-config, chains registry (Postgres `chain_registry`), health. Depends on `@legion/core`, `@legion/sentinels`, Redis, Postgres/Supabase env bindings. |
| **Ingress Package** | `apps/airdrop-hub` | Next.js shell (`#000` staging UI). **No package weld to `@legion/core`**. Operational intent: Engine API via `NEXT_PUBLIC_LEGION_ENGINE_API_URL` (comment contract only; no implemented client mesh in-tree). |
| **Primary Frontend** | `packages/lure-ui` | Production ingress: AppKit/wagmi/Solana, `PublicWalletIngressGrid`, Omni-Handshake, neural scout, settlement payloads built via `@legion/core/logic` imports, Next `/api/*` routes proxying or duplicating Gatekeeper flows. |
| **Command Center** | `packages/sovereign-admin` | Vault/admin plane; remote-config invalidation weld to `@legion/core/config/remote-sync`. |
| **SDK** | `packages/sdk` | Thin re-export of `@legion/core` for downstream consumers. |
| **Sentinels** | `packages/sentinels` | Lane/scout/dispatcher typing against `@legion/core` chain/lane types. |

### §1.2 Weld Points (Frontend ↔ API ↔ Core)

**Tier A — Direct `@legion/core` imports in browser/server bundles (logic portability weld)**

- `packages/lure-ui`: `@legion/core/logic` settlement builders (`buildEvmSignatureAnchorSettlement`, `buildSvmSignatureAnchorSettlement`, `buildUtxoSignatureAnchorSettlement`), `@legion/core` Gatekeeper helpers, `remote-sync`, `sovereign-engine-config-defaults`, envelope/security paths for Signature Anchor routes.
- `packages/lure-ui/src/logic/*.ts`: Re-exports of core modules (`capability-probe`, `deep-ingress`, `handshake`, `algorithmic-closer`).
- `packages/sdk`: Re-export surface.

**Tier B — Engine API weld (`apps/api`)**

- `@legion/core`: `runRecursivePredatorFusionUsd`, settlement + persistence verification, envelope sealing, Permit2/RPC utilities as wired in `routes/scout.ts`, `routes/signature-anchor.ts`, tests.
- `@legion/sentinels`: Types for sentinel routes.

**Tier C — HTTP proxy / dual-origin weld**

- `NEXT_PUBLIC_LEGION_ENGINE_API_URL`: lure-ui `/api/v1/scout`, `/api/v1/signature-anchor`, `/api/v1/payout-config` forward to institutional API when set; otherwise same-origin fallback routes apply.

**Tier D — Data plane weld**

- Supabase (`signatures` ledger), Postgres `DATABASE_URL` / `chain_registry`, `REDIS_URL` for extraction queue.

### §1.3 Architecture Decoupling Assessment

| Criterion | Status |
|-----------|--------|
| **Package boundaries** | `package.json` workspaces isolate `@legion/core`, API, UI; **not** a monolithic binary. |
| **API-first doctrine** | Declared at repo root; **partial coupling remains**: lure-ui executes settlement construction locally using `@legion/core` (shared logic embed), parallel to API Signature Anchor routes — **dual-path Gatekeeper weld**, not a single chokepoint. |
| **airdrop-hub decoupling** | **Maximum decoupling**, minimum lethality — no core dependency; shell only. |
| **100% clean decoupling** | **Negative.** Shared library coupling + duplicate HTTP surfaces + browser-side core imports prevent a strict “API-only core” isolation model. Decoupling is **operational** (modular packages), not **absolute** (single execution frontier). |

---

## §2 — LETHALITY MATRIX (CURRENT)

### §2.1 Chain Reach

| Family | Coverage | Evidence |
|--------|------------|----------|
| **EVM** | **High** | `evm-adapter.ts` (viem, Permit2/EIP-712 patterns, RPC rotation), `scout.ts` Recursive Predator (stETH, Uni V3 LP probe), multiple viem chains in API Signature Anchor imports (`mainnet`, `base`, `arbitrum`, `sepolia`), `chain_registry` API route. |
| **SVM** | **High** | `svm-adapter.ts` (Connection, SPL, delegate authority path), asset scanner SVM branch, Recursive Predator (mSOL, JitoSOL, Raydium LP probe), Jito bundle types in `algorithmic-closer.ts`. |
| **UTXO** | **Partial** | `utxo-adapter.ts`, `buildUtxoSignatureAnchorSettlement` — **signature/settlement posture** without full chain-specific strike automation enumerated in this recon. |

### §2.2 Asset Depth

| Layer | Status |
|-------|--------|
| **Native** | EVM + SOL native reads; RPC mesh fallbacks in adapters. |
| **Tokens** | ERC-20 / SPL discovery paths; Llama-price batching in asset scanner; minimum-USD filters on SPL. |
| **Staking / liquid staking** | **Targeted probes**: Lido stETH (EVM), Marinade mSOL, JitoSOL (SVM) via Recursive Predator fusion — **read-side density**, not full exit automation in fusion output alone. |
| **DeFi / LP** | Uniswap V3 (mainnet) LP USD estimate; Raydium LP USD probe; **Pancake V3 USD intentionally pinned to zero** in fusion shell; NFT floor signal **zero stub** pending proofs. |

### §2.3 Execution Posture

| Posture | Description |
|---------|-------------|
| **Public** | WalletConnect/AppKit ingress, `PublicWalletIngressGrid`, visible chain switching, telemetry ingress routes, `/api/v1/scout` trace IDs — **broad surface**. |
| **Ghost** | `ghost-asset.ts` deterministic virtual yield display; Shadow GCM envelope prefix for persisted signatures (`SHADOW_GCM:v1:`); `network-mesh.ts` egress cloaking via `PROXY_URL`; shadow store modules in core — **layered non-public signaling**. |
| **Institutional settlement lanes** | Jito bundle + Flashbots bundle **payload types** and Solana/EVM RPC resolution in `algorithmic-closer.ts`; closer integration depth varies by deployment. |

---

## §3 — THE GAP (PATH TO UNIVERSAL SUPREMACY)

1. **Extraction worker lethality** — BullMQ worker in `apps/api/src/lib/extraction-queue.ts` returns a **stub processed record**; no end-to-end strike chain wired inside the worker body for Universal Supremacy-class automation.

2. **Automatic unstaking / exit rails** — Recursive Predator fusion **measures** staking/LP venues; **automatic unstake** and liquidation sequencing require persistent desk integration beyond read probes (`scanStakingUnstakeManifest` and related closer artifacts are partial infrastructure).

3. **Cross-chain auto-bridging** — No first-class bridge orchestrator, relayer mesh, or CAIP-2 ↔ CAIP-2 asset teleport in this recon; chain reach is **RPC-and-settlement** scoped.

4. **Dynamic sentiment scaling** — No institutional sentiment ingestion layer (social/market microstructure) tied to payout or scout multipliers in-repo.

5. **airdrop-hub vacuum** — Staging shell without `@legion/core` weld; **zero operational lethality** until API URL binding and UI/scout wiring ship.

6. **Venue completeness** — Pancake V3 LP and NFT floor signals **zeroed** in fusion shell; BNB-dedicated mesh and NFT proof lane **not closed**.

7. **Dual-path Gatekeeper** — Browser-built settlements vs API-normalized ingress increase **consistency risk** under version skew; Universal Supremacy favors **one authoritative settlement frontier** or enforced version pins.

---

## §4 — ROADMAP TO GOD-MODE

| Phase | Objective | Sovereign Posture |
|-------|-----------|-------------------|
| **G-1** | Harden **single authoritative Signature Anchor frontier** (API vs edge); version contract + CI drift gates on `@legion/core` exports used by lure-ui. | **Integrity lock** |
| **G-2** | Replace extraction worker stub with **closed-loop job processor**: dequeue → Gatekeeper verify → adapter simulate → broadcast lane select (Jito / Flashbots / public RPC fallback). | **Execution closure** |
| **G-3** | Implement **unstake/exit manifests** for Recursive Predator venues (Lido/Marinade/JitoSOL/UniV3 positions) with signed operator policy and timelock where required. | **Asset depth expansion** |
| **G-4** | Introduce **bridge mesh** module (message-passing or liquidity-network adapters) behind `network-mesh` egress — optional proxy-aware routing already exists. | **Cross-chain reach** |
| **G-5** | Wire **dynamicSentimentScaling** as Remote Config keys + scorer in `telemetry/lethality-scorer.ts` lineage — external feeds behind institutional interfaces only. | **Adaptive lethality** |
| **G-6** | Elevate **airdrop-hub** from shell to Engine consumer: scout + anchor proxy-only client, `#000` aesthetic retained. | **Ingress multiplication** |
| **G-7** | Close **Pancake V3** and **NFT floor** fusion branches with on-chain proofs and floor oracles. | **Venue supremacy** |

---

## §5 — CLOSING LOCK

This document constitutes the **Phase 10.6 Full-stack Recon** artifact. **Sovereign Posture** is **multi-plane**, **actively coupled** through `@legion/core` shared logic, and **operationally extensible** via Engine API + Redis + Postgres + Supabase. **Universal Supremacy** remains **non-terminal** until extraction closure, bridge mesh, sentiment scaling, and venue-completion phases execute.

</div>
