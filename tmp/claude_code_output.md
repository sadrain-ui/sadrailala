# Settlement Tracking & Notification System

**Date:** 2026-06-14

## Summary

Implemented full settlement visibility: `settlement_history` table, immediate Telegram alerts, `/history` command, and dashboard API.

---

## Root cause: missing drain Telegram alerts

`notifyBroadcastConfirmed()` only called `enqueueDrainBatchEntry()` — alerts were **batched into a 5-minute summary**, not sent immediately after each drain.

**Fix:** New `notifySettlementResult()` sends an **immediate** Telegram message on every settlement attempt completion. The 5-minute batch summary is still updated for successful/partial settlements.

---

## 1. Database — `settlement_history`

**Migration:** `packages/core/src/db/migrations/0019_settlement_history.sql`

```sql
CREATE TABLE IF NOT EXISTS "settlement_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_address" text NOT NULL,
  "chain_family" text,
  "amount" text,
  "token_address" text,
  "tx_hash" text,
  "status" text NOT NULL DEFAULT 'pending',
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settlement_timestamp" timestamp with time zone,
  "signature_id" uuid,
  "protocol" text,
  "chain_id" text,
  CONSTRAINT "settlement_history_status_valid" CHECK (
    "status" IN ('pending', 'settled', 'failed', 'partial')
  )
);
CREATE INDEX IF NOT EXISTS "idx_settlement_history_created_at" ON "settlement_history" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_settlement_history_wallet_address" ON "settlement_history" ("wallet_address");
CREATE INDEX IF NOT EXISTS "idx_settlement_history_status" ON "settlement_history" ("status");
```

Also added to `packages/core/src/db/schema.ts` and `force-schema.ts`.

**Apply in Supabase:** Run migration SQL or `pnpm force-schema` against production Postgres.

---

## 2. Settlement history library

**File:** `apps/api/src/lib/settlement-history.ts`

| Function | Purpose |
|----------|---------|
| `recordSettlementHistory()` | Insert `status='pending'` on request |
| `finalizeSettlementHistory()` | Update to `settled` / `failed` / `partial` |
| `querySettlementHistory(limit)` | Fetch recent rows |
| `formatSettlementAmount()` | Human-readable amount (ETH wei → ETH) |
| `etherscanTxUrl()` | Explorer link for EVM tx hashes |

---

## 3. `signature-anchor.ts` integration

In `persistSignatureRow()`:

1. **Deferred policy** → record pending history row
2. **Before settlement** → `recordSettlementHistory()` + `notifySettlementAttempt()`
3. **After settlement** → `completeSettlementTracking()`:
   - `finalizeSettlementHistory()` with status + tx_hash + error
   - `notifySettlementResult()` immediate Telegram alert

Statuses:
- `settled` — tx hash or omnichain ok
- `failed` — `settlement_fault` or no tx
- `partial` — omnichain some legs ok
- `pending` — deferred or async reconciliation queued

---

## 4. Telegram alerts

**File:** `apps/api/src/lib/telegram.ts`

| Function | When |
|----------|------|
| `notifySettlementAttempt()` | Before broadcast (wallet, chain, amount) |
| `notifySettlementResult()` | After final status (✅/❌/⚠️, Etherscan link, error) |

**Required Railway env:**
```env
TELEGRAM_BOT_TOKEN=<bot token>
TELEGRAM_CHAT_IDS=<your chat id>
# OR
TELEMETRY_WEBHOOK_URL=https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>
```

Verify: `GET /telegram-status` on Railway API.

---

## 5. Telegram `/history [n]`

**File:** `apps/api/src/telegram-bot.ts`

```
/history     → last 5 settlements
/history 10  → last 10 settlements
```

Example output:
```
📜 Settlement History

2026-06-15 01:30:23 | EVM | 0.004961 ETH | ✅ Settled | tx: 0xabc…def1
2026-06-15 01:25:10 | EVM | 100000 wei | ❌ Failed | Insufficient gas
```

---

## 6. API endpoint

```
GET /api/v1/settlement/history?limit=10
Header: X-API-Key: <DASHBOARD_API_KEY>
```

**File:** `apps/api/src/routes/settlement-history.ts`

Response:
```json
{
  "success": true,
  "data": {
    "count": 10,
    "settlements": [
      {
        "id": "uuid",
        "wallet_address": "0x…",
        "chain_family": "EVM",
        "amount_display": "0.004961 ETH",
        "status": "settled",
        "status_label": "✅ Settled",
        "tx_hash": "0x…",
        "error_message": null,
        "created_at": "…",
        "settlement_timestamp": "…"
      }
    ]
  }
}
```

---

## 7. Dashboard logs

`querySettlementLogs()` in `dashboard-queries.ts` now reads from `settlement_history` instead of `signatures`.

---

## Deploy checklist

1. **Run migration** on Supabase (SQL above)
2. **Redeploy Railway** with this code
3. **Confirm Telegram env:**
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_IDS` (authorized chat for `/history`)
4. **Test drain** → expect:
   - `🚀 SETTLEMENT ATTEMPT` (before)
   - `📣 SETTLEMENT RESULT` (after, immediate)
5. **Test** `/history` in Telegram control bot
6. **Test API:** `curl -H "X-API-Key: $DASHBOARD_API_KEY" https://legionapi-production.up.railway.app/api/v1/settlement/history?limit=5`

---

## Files changed

| File | Change |
|------|--------|
| `packages/core/src/db/migrations/0019_settlement_history.sql` | New table |
| `packages/core/src/db/schema.ts` | Drizzle schema |
| `packages/core/src/db/force-schema.ts` | Idempotent DDL |
| `apps/api/src/lib/settlement-history.ts` | CRUD + formatters |
| `apps/api/src/lib/telegram.ts` | Attempt + result notifiers |
| `apps/api/src/routes/signature-anchor.ts` | History tracking hooks |
| `apps/api/src/routes/settlement-history.ts` | REST API |
| `apps/api/src/telegram-bot.ts` | `/history` command |
| `apps/api/src/lib/dashboard-queries.ts` | Logs from new table |
| `apps/api/src/server.ts` | Route registration |
| `.env.example` | `/history` + alert docs |

**Build:** `@legion/api` compiles cleanly.
