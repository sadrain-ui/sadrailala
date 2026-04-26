# Legion Engine — Architecture

## 1. Overview

Legion Engine is a backend that orchestrates **six sentinels** to execute on-chain strategies on EVM networks. It exposes a single API surface so any frontend — web app, CLI, Telegram bot, mobile client, automated agent — can drive the same engine without code duplication.

The engine is **not** coupled to any frontend. The reference `apps/web` exists for developer testing only and can be deleted without affecting production.

## 2. Sentinels

Each sentinel is a stateless worker that consumes from the job queue and writes events to the bus. Sentinels never call each other directly — they communicate through the state machine (see [`STATE-MACHINE.md`](STATE-MACHINE.md)).

| Sentinel | Responsibility | Key Inputs | Key Outputs |
|---|---|---|---|
| **Mask** | Identity & wallet abstraction. Resolves user → signer, manages session keys, hides raw EOAs from upstream consumers. | `userId`, `chainId` | `MaskedAccount`, signed payloads |
| **Scout** | Discovery. Watches mempools, price feeds, and contract events via Viem `watchContractEvent` / `watchBlocks`. | RPC streams, watchlists | `Signal` events |
| **Closer** | Execution. Builds, simulates, and submits transactions. Handles nonce management, gas pricing, replacement. | `Signal`, `MaskedAccount` | `Execution` records, tx hashes |
| **Dispatcher** | Routing & scheduling. Decides which sentinel handles a job, applies rate limits, sharding, and priority. | All inbound jobs | Routed jobs |
| **Shadow** | Simulation & dry-run. Runs Viem `simulateContract` / `eth_call` against forked or live state for previews and risk checks. | Job payloads | `SimulationResult` |
| **Gatekeeper** | AuthN/AuthZ, rate limits, allowlists, kill-switch. First in the request path; last word on whether anything executes. | API requests, policies | Allow / deny |

## 3. Layers

```
┌──────────────────────────────────────────────────────┐
│  Any Frontend  (web · CLI · bot · mobile · agent)    │
└──────────────────────────────────────────────────────┘
                       │   HTTP / WS
┌──────────────────────▼───────────────────────────────┐
│  apps/api  —  Gateway (Fastify)                      │
│    · Gatekeeper middleware                           │
│    · OpenAPI surface (see API-SPEC.md)               │
│    · WS event fan-out                                │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│  packages/core  —  Engine Kernel                     │
│    · Job queue (BullMQ on Redis)                     │
│    · State machine (XState)                          │
│    · Event bus (Postgres LISTEN/NOTIFY + Redis pub)  │
└──────┬───────────────┬───────────────┬───────────────┘
       │               │               │
┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐
│ Sentinels  │  │ infra/rpc  │  │ Postgres   │
│ (workers)  │  │ Viem pool  │  │ + Redis    │
└────────────┘  └────────────┘  └────────────┘
```

## 4. Frontend-Agnostic Contract

The API is the only public surface. Rules:

- No frontend-specific fields in responses (no `__react_*`, no server-rendered HTML).
- All errors follow [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807).
- All time values are ISO-8601 UTC strings.
- All amounts are stringified base units (wei, satoshi-equivalent) — never `number`.
- Pagination is cursor-based.
- Realtime updates flow through the WebSocket channel defined in [`API-SPEC.md`](API-SPEC.md). Polling endpoints exist for clients that cannot hold a socket.

## 5. Viem as EVM Standard

All EVM access lives in `infra/rpc` and is exposed to sentinels through a typed client factory:

```ts
// infra/rpc/clients.ts
import { createPublicClient, createWalletClient, http, fallback } from 'viem';
import { mainnet, base, arbitrum } from 'viem/chains';

export function publicClient(chainId: number) { /* fallback() over RPC pool */ }
export function walletClient(chainId: number, account: Account) { /* ... */ }
```

Rules:

- **No `ethers`, no `web3.js`.** Any new dependency that wraps EVM RPC must justify why Viem is insufficient.
- All contract interactions use Viem's typed `Abi` inference; ABIs live in `packages/core/abis/`.
- Reads use `publicClient.readContract` or `multicall`.
- Writes go through `walletClient.writeContract`, preceded by `simulateContract` (Shadow).
- Event subscriptions use `watchContractEvent` with reconnect logic in `infra/rpc/watchers.ts`.

## 6. Persistence

- **Postgres** — durable state: jobs, executions, sentinel runs, audit log. Schema in [`DB-SCHEMA.md`](DB-SCHEMA.md).
- **Redis** — hot path: BullMQ queues, rate-limit counters, ephemeral session keys, pub/sub fan-out to WS clients.

Postgres is the source of truth. Redis is rebuildable.

## 7. Deployment Topology

- `apps/api` — N stateless replicas behind a load balancer.
- Sentinel workers — independently scalable per sentinel type. Scout and Closer typically need the most replicas.
- One Postgres primary + read replicas. One Redis cluster.
- RPC pool — multiple providers per chain, weighted by latency and error rate. Health-checked every 10s.

## 8. Observability

- Structured JSON logs (`pino`), one log line per state transition.
- OpenTelemetry traces across gateway → core → sentinel → RPC.
- Metrics: job latency, sentinel queue depth, RPC error rate, gas spent per chain, simulation-vs-execution drift.
