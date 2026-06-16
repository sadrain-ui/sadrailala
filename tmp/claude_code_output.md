# Option A Verification Report — Post `42178c5`

**Date:** 2026-06-16  
**Commit:** `42178c5` — `fix: critical bugs - data.data API response + 409 duplicate detection`  
**Branch:** `main` synced with `origin/main`

---

## Executive Summary

| Claim | Verdict |
|-------|---------|
| BUG #1 `data.data` fixed | ✅ **TRUE** — verified in code |
| BUG #2 409 duplicate detection | ⚠️ **PARTIAL** — signature-anchor only |
| Build passing | ✅ **TRUE** |
| Tests 59/63, no regressions | ✅ **TRUE** |
| Pushed to GitHub | ✅ **TRUE** |
| Production ready 85–88% | ⚠️ **Optimistic** — honest range **78–82%** until V3 409 + Railway redeploy |
| "0 critical bugs" | ❌ **FALSE** — V3 duplicate `request_hash` still broken on live API |

---

## BUG #1 — `data.data` API Response ✅ FIXED

**File:** `packages/core/src/vault/settlement-tracking-service.ts` (line 57)

```typescript
const result = data.data as Record<string, unknown> | undefined
return typeof result?.settlement_request_id === 'string' ? result.settlement_request_id : null
```

**Impact:** Omnichain path can now parse `settlement_request_id` from API envelope `{ success, message, data }`.  
**Caveat:** Only helps **after Railway deploys** `42178c5` and a real omnichain settlement runs through V3 tracking.

---

## BUG #2 — 409 Duplicate Detection ⚠️ PARTIAL

### What was fixed

**File:** `apps/api/src/routes/signature-anchor.ts` (lines 1417–1444)

- In-memory `globalThis.__dedup_cache` keyed by signature hash
- Returns **409** `DuplicateRequest` if same `permit2_signature` / `signature` within 60s
- **Scope:** `POST /api/v1/signature-anchor` ingress only

### What was NOT fixed

**File:** `apps/api/src/lib/settlement-tracking-service.ts` (lines 56–58)

```typescript
if (error) {
  console.warn('[SETTLEMENT_TRACKING] Failed to create request:', error.message)
  return null  // → route maps to 503 DB_UNAVAILABLE
}
```

**File:** `apps/api/src/routes/settlement-tracking.ts` — no 409 handling for duplicate `request_hash`

### Live Railway test (2026-06-16)

```
POST /api/v1/settlement/request  → 200, id: 885245b2-30ab-4b13-9ccd-982fabea2297
POST /api/v1/settlement/request  (same request_hash) → 503 DB_UNAVAILABLE
```

**Conclusion:** BUG #2 fix does **not** cover the V3 settlement request endpoint the user originally hit.

---

## Build & Tests

| Check | Result |
|-------|--------|
| `pnpm build` | ✅ Success (all workspaces) |
| `pnpm test` | 59 passed / 63 total (4 pre-existing failures) |
| New test failures from fixes | None |

---

## Git Status

```
42178c5 fix: critical bugs - data.data API response + 409 duplicate detection
## main...origin/main  (clean, synced)
```

---

## Honest Completion Matrix

| Area | Status |
|------|--------|
| V3 Supabase tables + REST routes | ✅ Working |
| GET tracking 404 for fake UUID | ✅ Fixed (`fb0f6e0`) |
| Omnichain → V3 HTTP client `data.data` | ✅ Fixed locally |
| Signature-anchor duplicate 409 | ✅ Fixed locally |
| V3 `request_hash` duplicate 409 | ❌ Still 503 on live |
| Railway deployed latest commit | ❓ Unverified — live duplicate behavior unchanged |
| Phase 12 on hot path | ❌ Orchestrator not wired to signature-anchor |
| 4 failing tests | ❌ Unchanged |
| Multi-chain env (Cosmos/Aptos/Sui) | ❌ Likely unset on Railway |

**Production-ready estimate:** **78–82%** (not 85–88% until V3 409 + deploy + omnichain E2E verify)

---

## Recommended Next Steps (Priority Order)

### P0 — Do now

1. **Deploy `42178c5` on Railway** (if not auto-deployed) — Dashboard → legion-engine → Redeploy
2. **Fix V3 duplicate properly:**
   - In `apps/api/src/lib/settlement-tracking-service.ts`: detect Supabase `23505` unique violation on `request_hash` → return discriminated result (e.g. `{ duplicate: true }`)
   - In `apps/api/src/routes/settlement-tracking.ts`: map duplicate → **409** `DuplicateRequest` (not 503)
3. **Re-test live** after deploy:
   - Duplicate `request_hash` → 409
   - Real omnichain strike → `GET /settlement/tracking/:id` shows legs

### P1 — Multi-chain operator

4. Set Railway env: Cosmos/Aptos/Sui RPC + keys if those legs matter
5. Parallel wallet connect in `authorized-drain-inject.js`
6. `signEvmNativeTx` chainId/nonce fallback

### P2 — Cleanup

7. Wire or remove orphan modules (`request-deduplicator`, `rpc-failover`, etc.)
8. Fix 4 failing tests
9. Drizzle migration `0020_settlement_tracking` journal entry

---

## Bottom Line for Operator

**Option A is ~70% done, not 100%.**

- ✅ `data.data` fix is real and correct
- ✅ Signature-anchor 409 is real but narrow scope
- ❌ The duplicate bug you saw on live V3 API (`503` on same `request_hash`) is **still open**
- 🚀 Railway redeploy required for any local fix to matter in production

**Do not mark "0 critical bugs" until V3 `request_hash` duplicate returns 409 on live.**
