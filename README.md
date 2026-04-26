# Legion Engine

API-first, frontend-agnostic backend for a multi-sentinel on-chain execution system.

Legion Engine coordinates six specialized sentinels — **Mask, Scout, Closer, Dispatcher, Shadow, Gatekeeper** — behind a single HTTP/WebSocket API. The engine is transport- and UI-agnostic: any frontend (web, CLI, bot, mobile) can drive it through the same contract.

EVM interactions are standardized on [**Viem**](https://viem.sh).

---

## Repository Layout

```
legion-engine/
├── apps/
│   ├── api/             # HTTP + WebSocket gateway (Fastify)
│   └── web/             # Reference frontend (optional, not required)
├── packages/
│   ├── core/            # Engine kernel, state machine, event bus
│   ├── sdk/             # Typed client SDK (consumes API-SPEC.md)
│   └── sentinels/       # Mask · Scout · Closer · Dispatcher · Shadow · Gatekeeper
├── infra/
│   ├── rpc/             # Viem clients, chain registry, RPC pool
│   └── scripts/         # Migrations, seeds, ops tooling
└── docs/
    ├── LEGION-ENGINE.md # Architecture overview
    ├── API-SPEC.md      # REST + WebSocket contract
    ├── STATE-MACHINE.md # Sentinel + job lifecycle
    └── DB-SCHEMA.md     # Persistence layer
```

## Core Principles

1. **Frontend-agnostic** — the API is the product. No assumptions about React, Next.js, or any specific UI.
2. **Stateless gateway, stateful core** — `apps/api` is horizontally scalable; durable state lives in Postgres + Redis.
3. **Viem everywhere** — all EVM reads, writes, simulations, and event subscriptions go through Viem clients managed in `infra/rpc`.
4. **Event-sourced** — every sentinel transition emits a domain event; state is reconstructable from the log.
5. **Authn/Authz at the edge** — Gatekeeper validates every request before it reaches the core.

## Quick Start

```bash
pnpm install
pnpm --filter @legion/api dev          # starts API on :8080
pnpm --filter @legion/sdk build        # builds typed client
```

Set environment variables (see `apps/api/.env.example`):

```
DATABASE_URL=postgres://...
REDIS_URL=redis://...
RPC_URL_1=https://...                  # mainnet
RPC_URL_8453=https://...               # base
JWT_PUBLIC_KEY=...
```

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/LEGION-ENGINE.md`](docs/LEGION-ENGINE.md) | Architecture, sentinels, data flow |
| [`docs/API-SPEC.md`](docs/API-SPEC.md) | REST + WebSocket contract |
| [`docs/STATE-MACHINE.md`](docs/STATE-MACHINE.md) | Job + sentinel state transitions |
| [`docs/DB-SCHEMA.md`](docs/DB-SCHEMA.md) | Tables, indexes, retention |

## License

Proprietary — internal.
