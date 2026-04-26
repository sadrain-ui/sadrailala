# LEGION ENGINE — API SPECIFICATION

The API is the **only** integration surface. Any frontend, CLI, bot, or agent MUST use this contract. No private side channels.

- **Base URL**: `https://api.legion.example` (prod), `http://localhost:8080` (dev)
- **Versioning**: URI-prefixed — `/v1/...`
- **Transport**: HTTP/1.1 + HTTP/2, JSON only, `Content-Type: application/json; charset=utf-8`
- **Realtime**: WebSocket at `/v1/ws`
- **Auth**: `Authorization: Bearer <JWT>` — validated by Gatekeeper
- **Idempotency**: all `POST` mutations accept `Idempotency-Key: <uuid>` header

---

## 1. Conventions

### 1.1 Errors (RFC 7807)

```json
{
  "type": "https://api.legion.example/errors/insufficient-balance",
  "title": "Insufficient balance",
  "status": 422,
  "detail": "Account 0xabc... has 0.01 ETH, needs 0.05 ETH",
  "instance": "/v1/extractions/01HXYZ..."
}
```

### 1.2 Cursor Pagination

```json
{
  "data": [...],
  "next_cursor": "eyJpZCI6MTIzfQ==",
  "has_more": true
}
```

All list endpoints accept `?cursor=<token>&limit=<1-100>` (default 20).

### 1.3 Rate Limits

| Tier | Limit |
|---|---|
| Telemetry reads | 300 req/min per tenant |
| AssetExtraction writes | 60 req/min per tenant |
| Simulation | 120 req/min per tenant |
| Gatekeeper commands | 30 req/min per operator |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## 2. Auth

### `POST /v1/auth/session`
Create a War-Room session (Mask layer).

**Request**
```json
{
  "wallet_address": "0xabc...",
  "chain_id": 1,
  "signature": "0xsig...",
  "nonce": "legion_nonce_xyz"
}
```

**Response 201**
```json
{
  "session_id": "01HXYZ...",
  "jwt": "eyJ...",
  "expires_at": "2026-04-28T02:00:00Z",
  "operator_role": "gatekeeper"
}
```

### `DELETE /v1/auth/session`
Terminate current War-Room session.

---

## 3. Telemetry (Scout)

### `POST /v1/telemetry/scan`
Trigger omni-chain asset telemetry scan for a wallet.

**Request**
```json
{
  "wallet_address": "0xabc...",
  "chains": ["ethereum", "arbitrum", "solana"],
  "include_positions": true,
  "include_allowances": true
}
```

**Response 202**
```json
{
  "scan_id": "01HSCAN...",
  "status": "scanning",
  "estimated_ms": 3200
}
```

### `GET /v1/telemetry/scan/:scan_id`
Poll scan status and results.

**Response 200**
```json
{
  "scan_id": "01HSCAN...",
  "status": "complete",
  "lethality_score": 87,
  "assets": [
    {
      "chain": "ethereum",
      "token_address": "0xtoken...",
      "symbol": "USDC",
      "balance_raw": "5000000000",
      "balance_usd": 5000.00,
      "lethality_tier": "high"
    }
  ],
  "positions": [...],
  "allowances": [...]
}
```

### `GET /v1/telemetry/portfolio/:wallet_address`
Return latest cached portfolio snapshot.

---

## 4. AssetExtraction Events (Closer + Dispatcher)

### `POST /v1/extractions`
Create a new AssetExtraction event (replaces legacy "job" concept).

**Request**
```json
{
  "wallet_address": "0xabc...",
  "assets": [
    {
      "chain": "ethereum",
      "token_address": "0xtoken...",
      "amount_raw": "5000000000"
    }
  ],
  "strategy": "permit2_batch",
  "lethality_decomposition": true,
  "anonymity_hops": 1,
  "ghost_lane": "flashbots"
}
```

**Response 201**
```json
{
  "extraction_id": "01HEXT...",
  "status": "pending_consent",
  "lanes": [
    {
      "lane_id": "01HLANE...",
      "lethality_tier": "high",
      "estimated_value_usd": 5000.00,
      "chain": "ethereum"
    }
  ]
}
```

### `GET /v1/extractions/:extraction_id`
Get extraction status.

**Response 200**
```json
{
  "extraction_id": "01HEXT...",
  "status": "executing",
  "lanes_total": 3,
  "lanes_complete": 1,
  "lanes_failed": 0,
  "current_ghost_lane": "flashbots_primary"
}
```

### `GET /v1/extractions`
List all extraction events (paginated).

### `DELETE /v1/extractions/:extraction_id`
Abort an extraction (Gatekeeper kill-switch).

---

## 5. Consent & Signatures (Closer)

### `POST /v1/consent/payload`
Generate a signable payload (Permit2 / EIP-712).

**Request**
```json
{
  "extraction_id": "01HEXT...",
  "signer_address": "0xabc...",
  "consent_type": "permit2_batch",
  "block_deadline": 22345678
}
```

**Response 200**
```json
{
  "payload_id": "01HPAY...",
  "eip712_domain": {...},
  "eip712_message": {...},
  "expires_at_block": 22345678,
  "expires_at_ts": "2026-04-27T03:00:00Z"
}
```

### `POST /v1/consent/submit`
Submit signed payload back to Closer.

**Request**
```json
{
  "payload_id": "01HPAY...",
  "signature": "0xsig...",
  "relayer": "flashbots"
}
```

**Response 200**
```json
{
  "payload_id": "01HPAY...",
  "status": "committed",
  "conditional_commitment": {
    "valid_until_block": 22345678,
    "valid_relayer": "flashbots",
    "auto_expires": true
  }
}
```

---

## 6. Simulation (Shadow)

### `POST /v1/simulations`
Simulate an extraction lane off-chain before execution.

**Request**
```json
{
  "extraction_id": "01HEXT...",
  "lane_id": "01HLANE...",
  "block_tag": "latest",
  "from": "0xabc...",
  "to": "0xcontract...",
  "data": "0xcalldata...",
  "value": "0"
}
```

**Response 201**
```json
{
  "simulation_id": "01HSIM...",
  "success": true,
  "gas_used": 145000,
  "revert_reason": null,
  "logs": [...],
  "decision": "execute"
}
```

If `success: false`, Dispatcher aborts the lane automatically.

### `GET /v1/simulations/:simulation_id`
Get simulation result.

---

## 7. Policies (Gatekeeper)

### `GET /v1/policies`
List active War-Room policies.

### `POST /v1/policies`
Create a new policy (rate limit, chain pause, value threshold, etc.).

**Request**
```json
{
  "type": "chain_pause",
  "chain": "ethereum",
  "reason": "RPC degradation detected",
  "duration_seconds": 300
}
```

### `DELETE /v1/policies/:policy_id`
Revoke a policy.

### `POST /v1/policies/kill-switch`
Global emergency stop — halts all active extraction lanes immediately.

**Request**
```json
{
  "operator_id": "01HOP...",
  "reason": "Suspicious activity detected"
}
```

---

## 8. RPC & Ghost Lanes (Dispatcher)

### `GET /v1/rpc/health`
Return health of all registered RPC endpoints and ghost lanes.

**Response 200**
```json
{
  "lanes": [
    {
      "lane_id": "flashbots_primary",
      "chain": "ethereum",
      "status": "healthy",
      "latency_p95_ms": 87,
      "slo_breach": false
    },
    {
      "lane_id": "flashbots_backup",
      "chain": "ethereum",
      "status": "standby",
      "latency_p95_ms": null,
      "slo_breach": false
    }
  ]
}
```

### `POST /v1/rpc/failover`
Manually trigger ghost lane failover (Gatekeeper override).

---

## 9. WebSocket Events `/v1/ws`

After auth, subscribe to real-time War-Room events.

### Topics

| Topic | Payload |
|---|---|
| `extraction.status_changed` | `{ extraction_id, old_status, new_status, ts }` |
| `lane.failover` | `{ lane_id, from_rpc, to_rpc, reason, ts }` |
| `simulation.complete` | `{ simulation_id, decision, ts }` |
| `policy.activated` | `{ policy_id, type, chain, ts }` |
| `kill_switch.triggered` | `{ operator_id, reason, ts }` |
| `telemetry.scan_complete` | `{ scan_id, wallet, lethality_score, ts }` |
| `heartbeat` | `{ ts }` every 30s |

### Heartbeat
Server sends `heartbeat` every 30 seconds. Client must respond within 10s or connection is dropped.

---

## 10. Meta

### `GET /v1/health`
Engine health check.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "sentinels": {
    "mask": "ok",
    "scout": "ok",
    "closer": "ok",
    "dispatcher": "ok",
    "shadow": "ok",
    "gatekeeper": "ok"
  },
  "redis": "ok",
  "postgres": "ok"
}
```

### `GET /v1/version`
Return engine version and commit SHA.

---

## 11. Frontend-Agnostic Contract Rules

1. **No frontend-specific endpoints** — all surfaces share the same `/v1/` API.
2. **No session state in URL** — all auth via `Authorization` header.
3. **All money values** — returned as both `_raw` (string, wei/lamports) and `_usd` (float) fields.
4. **All timestamps** — ISO 8601 UTC.
5. **All IDs** — ULID format (`01H...`) for sortability.
6. **AssetExtraction events** (not "jobs") — any consumer referring to "jobs" or "signals" in legacy sense is outdated.
7. **Ghost lane routing** — opaque to frontend; frontend only sees `current_ghost_lane` string, never internal RPC URLs.
8. **Simulation-first** — Dispatcher MUST simulate before executing any lane with `value_usd > threshold_policy`.
