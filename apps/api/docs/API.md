# Legion Engine API — Frontend Integration Guide

**Base URL:** `http://localhost:4000` (dev) or your deployed API (`NEXT_PUBLIC_LEGION_ENGINE_API_URL`)

**All JSON responses use:**

```json
{
  "success": true,
  "message": "Human-readable summary",
  "data": { }
}
```

**Errors use the same shape with `success: false`.** The `data` object may include `code`, `statusCode`, `reqId`, and legacy fields (`error`, `ok`) where noted.

---

## Authentication

Send on protected routes:

```
Authorization: Bearer <token>
```

**Token options:**
- `api_jwt` from login/refresh/SIWE verify
- Supabase `access_token` from login/refresh

**CORS:** Browser clients must use an allowed origin. Set `API_CORS_ORIGINS` on the API (comma-separated), e.g.:

```
API_CORS_ORIGINS=http://localhost:3000,http://localhost:3001,https://your-frontend.vercel.app
```

Optional host suffix: `API_CORS_ORIGIN_HOST_SUFFIX=.vercel.app`

**Credentials:** `credentials: 'include'` is supported when using cookies alongside CORS.

---

## Endpoints

### Health

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | No |

**Query:** `ping` optional (`true` triggers telemetry heartbeat)

**Success `data`:** `{ status, service, timestamp, heartbeat_trigger? }`

---

### Auth

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/api/auth/login` | No | `{ email, password }` |
| POST | `/api/auth/refresh` | No | `{ refresh_token }` |
| POST | `/api/auth/logout` | Bearer + body | `{ refresh_token }` |
| GET | `/api/auth/me` | Yes | — |
| POST | `/api/auth/siwe/nonce` | No | `{ address }` |
| POST | `/api/auth/siwe/verify` | No | `{ message, signature }` |

**Login/refresh success `data`:** `{ access_token, refresh_token, expires_at, token_type, api_jwt }`

**SIWE verify success `data`:** `{ api_jwt, address, expires_in }`

---

### Scout

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/api/v1/scout` | No | `{ user_address?, chain_id?, wallet_type?, chain_family?, scout_value_usd? }` |
| POST | `/api/scout/recursive-predator-fusion` | No | Multi-chain addresses + optional RPC overrides |

**Scout success `data`:** `{ handshake_active, telemetry_trace_id }`

**Fusion success `data`:** `{ handshake_active, fusion, rpc_operational, reference_rates_usd }`

---

### Signature anchor

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/api/signature-anchor` | No | Permit2 / normalized_v1 / settlement_builder |
| POST | `/api/v1/signature-anchor` | No | Same as above |

**Success `data`:** `{ handshake_active, l2_mint_transaction_hash, settlement_reconciliation_queued, lethal_core_aligned }`

Requires server env: `SUPABASE_*`, `SHADOW_VAULT_KEY` or `GATEKEEPER_SECRET`, RPC for EVM paths.

---

### Chains

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/chains` | No |

**Success `data`:** `{ integrity_lock, handshake_active, chains[] }`

---

### Jobs

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/api/jobs/extraction` | Yes | `{ wallet_address, token_address?, protocol?, chain_id?, scout_value_usd?, kind? }` |

**Success `data`:** `{ job_id, queue, handshake_active }`

---

### Payout config

| Method | Path | Auth | Query |
|--------|------|------|-------|
| GET | `/api/v1/payout-config` | No | `trace?` |

**Success `data`:** `{ handshake_active, allocation_usd, chaos_algorithm, variance_band }`

---

### Sentinels

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/sentinels/status` | Yes |

---

### Command center

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/command-center/signatures` | Bearer (sovereign commander email only) |

**Success `data`:** `{ rows[] }`

---

### Diagnostics

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/diagnostic/ping-strike` | Yes |

---

### Internal

| Method | Path | Auth | Header |
|--------|------|------|--------|
| POST | `/api/internal/kinetic-deep-scan` | Optional key | `x-legion-kinetic-key` |

**Body:** `{ wallet_address }`

---

## Frontend fetch example

```typescript
const API = process.env.NEXT_PUBLIC_LEGION_ENGINE_API_URL ?? ''

async function apiPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.success) {
    throw new Error(json.message ?? 'Request failed')
  }
  return json.data as T
}
```

---

## Rate limits

100 requests per minute per IP (global).

---

## Lure UI proxy mode

If `NEXT_PUBLIC_LEGION_ENGINE_API_URL` is **empty**, Lure UI calls same-origin Next routes (`/api/v1/*`) which proxy to Fastify. Set the env var to call the API **directly** (requires CORS).
