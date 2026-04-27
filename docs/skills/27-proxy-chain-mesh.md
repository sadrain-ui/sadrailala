# SKILL-27: PROXY-CHAIN MESH — IP MASKING LAYER (apify/proxy-chain)
## SOURCE: https://github.com/apify/proxy-chain
## CATEGORY: META — Engine Shield / Network Stealth

## [STRICT_RULES]
- NEVER make Flashbots/RPC calls from raw datacenter IP — always route through proxy mesh
- `ProxyChain.anonymizeProxy(upstreamUrl)` returns `127.0.0.1:PORT` — use THIS as actual proxy
- ALWAYS call `proxyChain.closeAnonymizedProxy(url, true)` after session — avoids port exhaustion
- Rotate proxies per-bundle-attempt — NEVER reuse same proxy for consecutive submissions
- SOCKS5 upstream preferred over HTTP — lower fingerprint surface than HTTP CONNECT tunnel
- Custom `requestHandler` MUST not log upstream credentials in plaintext
- NEVER use free public proxies for RPC calls — traffic is inspectable, use residential/datacenter private
- ProxyChain.Server port MUST be randomized per Legion instance — avoid static port fingerprinting
- For Puppeteer/browser automation: ALWAYS use `anonymizeProxy` then pass to `--proxy-server` arg

## [MENTAL_MODEL]
- Proxy-Chain = programmable MITM proxy server — intercept, route, transform HTTP/HTTPS/SOCKS traffic
- Legion uses it as: upstream proxy router — different IPs for different RPC endpoints
- Anonymize: wraps credential-bearing upstream URL into local unauthenticated proxy (for browsers)
- Chaining: Legion IP → ProxyChain local server → residential proxy → Flashbots/Infura/Alchemy
- Purpose: prevent IP-based rate limits, bot detection, searcher identity correlation by relays

## [REAL_API]
```typescript
import ProxyChain from 'proxy-chain'

// === Pattern 1: Anonymize upstream proxy (strip credentials) ===
const upstreamUrl = 'http://user:password@residential-proxy.com:8080'
const localUrl = await ProxyChain.anonymizeProxy(upstreamUrl)
// localUrl = 'http://127.0.0.1:XXXXX'
// Use localUrl with ethers provider:
const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
  fetchOptions: { dispatcher: new ProxyAgent(localUrl) }
})
// After session:
await ProxyChain.closeAnonymizedProxy(localUrl, true)

// === Pattern 2: Programmatic proxy server with rotation ===
const proxyPool = [
  'http://user1:pass1@proxy1.example.com:8000',
  'socks5://user2:pass2@proxy2.example.com:1080',
  'http://user3:pass3@proxy3.example.com:8000',
]
let poolIndex = 0

const server = new ProxyChain.Server({
  port: 8000 + Math.floor(Math.random() * 1000), // random port
  prepareRequestFunction: ({ request, username, password, hostname }) => {
    // Rotate upstream proxy per request
    const upstream = proxyPool[poolIndex % proxyPool.length]
    poolIndex++
    return {
      upstreamProxyUrl: upstream,
      requestAuthentication: false,
    }
  },
})
await server.listen()
console.log(`Legion proxy mesh on port ${server.port}`)

// === Pattern 3: Per-endpoint proxy assignment ===
const endpointProxyMap: Record<string, string> = {
  'eth.flashbots.net': 'http://user1:pass1@proxy1.com:8080',
  'mainnet.infura.io': 'http://user2:pass2@proxy2.com:8080',
  'rpc.ankr.com': 'socks5://user3:pass3@proxy3.com:1080',
}

const smartServer = new ProxyChain.Server({
  port: 9000,
  prepareRequestFunction: ({ request }) => {
    const host = new URL(request.url).hostname
    return {
      upstreamProxyUrl: endpointProxyMap[host] || proxyPool[0],
    }
  },
})

// === Pattern 4: Custom response (block/mock specific URLs) ===
const filterServer = new ProxyChain.Server({
  port: 9001,
  prepareRequestFunction: ({ request }) => {
    // Block telemetry/analytics hosts
    if (request.url.includes('analytics') || request.url.includes('telemetry')) {
      return { customResponseFunction: () => ({ statusCode: 403, body: 'Blocked' }) }
    }
    return { upstreamProxyUrl: proxyPool[0] }
  },
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await server.close(true) // true = force close existing connections
})
```

## [LEGION USE CASES]
- RPC stealth: Route Flashbots bundle submissions through rotating residential IPs — avoid IP bans
- Identity separation: Different proxy for each Legion strategy module — correlation-proof
- Rate limit bypass: Rotate proxies per 50 requests to free-tier RPC endpoints (Infura/Alchemy)
- Browser automation: anonymizeProxy for Puppeteer-based data scraping (DEX frontends, analytics)
- Endpoint-aware routing: Map RPC providers to their own dedicated proxy — latency + stealth
- Block leak prevention: Filter analytics/telemetry URLs via custom response — zero footprint
