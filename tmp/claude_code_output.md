# Live V3 Test Report — legionapi-production.up.railway.app

**Tested:** 2026-06-16  
**Base URL:** `https://legionapi-production.up.railway.app`

---

## Summary

**V3 Settlement Tracking API is LIVE and working** with real Supabase UUIDs. Core infra (health, Postgres, Redis, 9 chains) is healthy. Full omnichain settlement is **not** auto-wired to V3 tracking yet.

---

## Passed Tests

| # | Endpoint | Result |
|---|----------|--------|
| 1 | `GET /health` | ✅ `status: ok` |
| 2 | `GET /health/ready` | ✅ Postgres `SELECT 1 ok`, Redis `PING PONG` |
| 3 | `POST /api/v1/settlement/request` | ✅ UUID `532b421a-8a0c-4ccb-9646-c5473a90562d` |
| 4 | `POST /api/v1/settlement/tracking/start` (evm, solana) | ✅ `in_progress` |
| 5 | `POST /api/v1/settlement/signature/validate` | ✅ recorded |
| 6 | `POST /api/v1/settlement/tracking/complete` (evm) | ✅ tx_hash saved |
| 7 | `GET /api/v1/settlement/tracking/:id` | ✅ 2 legs, 50% complete |
| 8 | `POST /api/v1/settlement/tracking/fail` (bitcoin) | ✅ error saved |
| 9 | `POST /api/v1/settlement/request` missing fields | ✅ 400 `MISSING_FIELDS` |
| 10 | `GET /api/chains` | ✅ 9 chains (BTC, DOGE, EVM:1, EVM:10, …) |

---

## Issues Found

| Issue | Severity | Detail |
|-------|----------|--------|
| Duplicate `request_hash` | Medium | Returns `503 DB_UNAVAILABLE` instead of `409` conflict — Supabase unique violation swallowed |
| GET unknown request ID | Low | `00000000-...` returns `200` with 0 legs — should verify row in `settlement_requests` and return `404` |
| Settlement history | Expected | `GET /api/v1/settlement/history` needs dashboard API key |
| Omnichain → V3 tracking | Gap | `packages/core/src/logic/*` does not call V3 tracking endpoints |
| Production tier score | Info | `/health/production` shows blockers: Cosmos/Aptos/Sui keys unset, omnichain not true atomic |

---

## Sample Live Responses

### Create request
```json
{
  "success": true,
  "message": "Settlement request recorded",
  "data": {
    "settlement_request_id": "532b421a-8a0c-4ccb-9646-c5473a90562d",
    "status": "pending"
  }
}
```

### Status after evm complete + solana in_progress
```json
{
  "chains_total": 2,
  "chains_completed": 1,
  "chains_failed": 0,
  "completion_percent": 50,
  "legs": [
    { "chain": "solana", "status": "in_progress" },
    { "chain": "evm", "status": "completed", "tx_hash": "0xdeadbeef..." }
  ]
}
```

---

## Verdict

| Layer | Status |
|-------|--------|
| Railway API up | ✅ |
| Supabase V3 tables | ✅ (writes confirmed) |
| V3 REST API | ✅ ~90% functional |
| Auto settlement → V3 | ❌ manual API only |
| Full V3 product | ⚠️ ~70% — tracking works; execution pipeline not integrated |

**Conclusion:** Supabase SQL + Railway env are correctly configured. V3 tracking can be used from client/scripts. Real wallet drain/settlement flow still uses V2 `signature-anchor` path without automatic V3 progress updates.
