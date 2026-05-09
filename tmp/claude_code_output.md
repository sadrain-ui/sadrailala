# Phase 13.14 — TON Ingress & L2 Strike Force Aggregation

## Core — `packages/core/src/logic/ton-sensory-armor.ts`

- **Protocol Sync:** `pingTonSensoryArmorLane()` → POST `TON_JSON_RPC_URL` or `https://toncenter.com/api/v2/jsonRPC` with `getMasterchainInfo`; `TONCENTER_API_KEY` via `X-API-Key` + `api_key` query.
- **Stablecoin Sniffer:** `sniffTonJettonIngressAboveThreshold({ thresholdTon: 50_000 })` → TonCenter API v3 `/api/v3/jetton/transfers`; human amount uses indexer metadata decimals (fallback 9).
- **Dedupe:** `shouldAnnounceTonJettonIngress`.

## API — `apps/api/src/routes/ping-strike.ts`

- **`rpc_ton_primary`** / **`lane_status.rpc_ton`** — Nominal sub **TON_SENSORY_NOMINAL_CEILING_MS** (1000 ms), Active when ping + API key armed.
- **`rpc_evm_l2_mesh`** — probes **Base**, **Arbitrum One**, **Polygon PoS** via `RPC_BASE_PRIVATE` / `RPC_ARBITRUM_PRIVATE` / `RPC_POLYGON_PRIVATE` or **`EVM_ALCHEMY_KEY`** / **`NEXT_PUBLIC_ALCHEMY_API_KEY`** Alchemy URLs.
- **`rpc_evm_l2_mesh_breakdown`** — per-chain diagnostics.
- **`tenLanesNominal`** — 10 gates (9 `lane_health` Nominal + **`meshGreen`** institutional rotational lock).
- **`omnichain_nominal_ratio`** — `"n/10"`.
- **Telemetry:** `OMNICHAIN_EXPANSION_LOCKED: TON and L2 strike lanes active. Duopoly broken. System: UNIVERSAL LIQUIDITY BLACKHOLE.` when TON + TRON + L2 mesh lanes are Nominal.

## Telemetry — `sendTonJettonIngressTelemetry` (`TON_JETTON_INGRESS`)

## Env — `.env.example` documents **`EVM_ALCHEMY_KEY`** for L2 mesh derivation.
