# Legion Engine — API Specification

The API is the **only** integration surface. Any frontend MUST use this contract; no private side channels.

- **Base URL**: `https://api.legion.example` (prod), `http://localhost:8080` (dev)
- **Versioning**: URI-prefixed — `/v1/...`
- **Transport**: HTTP/1.1 + HTTP/2, JSON only, `Content-Type: application/json; charset=utf-8`
- **Realtime**: WebSocket at `/v1/ws`
- **Auth**: `Authorization: Bearer <JWT>` — validated by Gatekeeper
- **Idempotency**: all `POST` mutations accept `Idempotency-Key: <uuid>` header

## 1. Conventions

### 1.1 Errors (RFC 7807)

```json
{
  "type": "https://api.legion.example/errors/insufficient-balance",
  "title": "Insufficient balance",
  "status": 422,
  "detail": "Account 0xabc... has 0.01 ETH, needs 0.05 ETH",
  "instance": "/v1/jobs/01HXYZ...",
  "code": "INSUFFICIENT_BALANCE"
}
```

### 1.2 Pagination

```
GET /v1/jobs?limit=50&cursor=eyJpZCI6...
```

Response envelope:

```json
{ "data": [...], "next_cursor": "eyJpZCI6..." | null }
```

### 1.3 Amounts & Time

- Amounts: `string` in base units (`"1000000000000000000"` = 1 ETH).
- Time: ISO-8601 UTC (`"2026-04-27T01:52:00Z"`).
- Chain IDs: numeric (`1`, `8453`, `42161`).

## 2. REST Endpoints

### 2.1 Auth & Accounts (Mask + Gatekeeper)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/auth/siwe/nonce` | Issue SIWE nonce |
| `POST` | `/v1/auth/siwe/verify` | Verify SIWE signature → JWT |
| `GET`  | `/v1/me` | Current user + linked masked accounts |
| `POST` | `/v1/me/accounts` | Link a new wallet (returns Mask handle) |
| `DELETE` | `/v1/me/accounts/:maskId` | Revoke a Mask handle |

`POST /v1/auth/siwe/verify` request:

```json
{ "message": "<EIP-4361 message>", "signature": "0x..." }
```

Response:

```json
{
  "access_token": "eyJ...",
  "expires_at": "2026-04-27T02:52:00Z",
  "user": { "id": "usr_01HXYZ", "address": "0xabc..." }
}
```

### 2.2 Jobs

A **Job** is the unit of work submitted by any frontend. The Dispatcher routes it to the right sentinel(s).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/jobs` | Submit a new job |
| `GET`  | `/v1/jobs` | List jobs (filter by `status`, `kind`, `chain_id`) |
| `GET`  | `/v1/jobs/:id` | Job detail incl. sentinel run history |
| `POST` | `/v1/jobs/:id/cancel` | Cooperative cancel |
| `POST` | `/v1/jobs/:id/simulate` | Force a Shadow simulation, return diff |

`POST /v1/jobs` request:

```json
{
  "kind": "swap" | "transfer" | "approve" | "custom",
  "chain_id": 8453,
  "mask_id": "msk_01HXYZ",
  "payload": { "...": "kind-specific" },
  "policy": {
    "max_gas_wei": "500000000000000",
    "deadline": "2026-04-27T02:00:00Z",
    "simulate_first": true
  }
}
```

Response (201):

```json
{
  "id": "job_01HXYZ...",
  "status": "queued",
  "created_at": "2026-04-27T01:52:00Z"
}
```

### 2.3 Signals (Scout)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/v1/signals` | List recent signals |
| `POST` | `/v1/signals/watchlists` | Create a watchlist (addresses, topics, price feeds) |
| `GET`  | `/v1/signals/watchlists` | List watchlists |
| `DELETE` | `/v1/signals/watchlists/:id` | Remove watchlist |

### 2.4 Executions (Closer)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/executions` | List executions |
| `GET` | `/v1/executions/:id` | Execution detail (tx hash, receipt, gas used) |
| `POST` | `/v1/executions/:id/replace` | Submit replacement tx (same nonce, higher fee) |

### 2.5 Policies (Gatekeeper)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/policies` | List active policies |
| `POST` | `/v1/policies` | Create policy (allowlist, rate limit, kill-switch) |
| `PATCH` | `/v1/policies/:id` | Toggle / update |

### 2.6 Health & Meta

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/health` | Liveness |
| `GET` | `/v1/ready` | Readiness (DB + Redis + RPC) |
| `GET` | `/v1/meta/chains` | Supported chains + RPC health |

## 3. WebSocket Channel

**URL**: `wss://api.legion.example/v1/ws?token=<JWT>`

Frames are JSON. Server → client envelope:

```json
{ "type": "event", "topic": "job.updated", "data": { ... } }
```

Client → server envelope:

```json
{ "type": "subscribe", "topics": ["job.*", "signal.created"] }
```

### 3.1 Topics

| Topic | Emitted by | Payload |
|---|---|---|
| `job.created` | Gateway | Full job |
| `job.updated` | Core | `{ id, status, prev_status }` |
| `job.completed` | Closer | `{ id, execution_id, tx_hash }` |
| `job.failed` | any | `{ id, error }` |
| `signal.created` | Scout | Signal record |
| `execution.confirmed` | Closer | `{ id, tx_hash, block_number }` |
| `policy.tripped` | Gatekeeper | `{ policy_id, reason }` |

Subscriptions are **scoped to the authenticated user** — Gatekeeper filters frames before fan-out.

### 3.2 Heartbeat

Server sends `{"type":"ping"}` every 25s. Client must reply `{"type":"pong"}` or be disconnected.

## 4. SDK

`packages/sdk` is a typed TypeScript client generated from the OpenAPI document at `apps/api/openapi.yaml`. It is the **only** sanctioned client for in-house frontends, but third parties may call the REST/WS API directly.

```ts
import { LegionClient } from '@legion/sdk';
const legion = new LegionClient({ baseUrl, token });
const job = await legion.jobs.create({ kind: 'swap', chainId: 8453, ... });
legion.ws.on('job.completed', (e) => { ... });
```

## 5. Rate Limits

Enforced by Gatekeeper via Redis token buckets. Defaults:

| Scope | Limit |
|---|---|
| Per user, all endpoints | 600 req / min |
| `POST /v1/jobs` per user | 60 req / min |
| WS frames per connection | 240 / min |

`429` responses include `Retry-After` (seconds) and `X-RateLimit-Remaining`.
