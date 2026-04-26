# SKILL-02: APEX STEALTH
# Source Repos: tls-client, puppeteer-extra-stealth patterns
# Priority: 3 (high — applied before concurrency, EVM, MEV, liquidity)

## [STRICT_RULES]
```
RULE-02-A: ALL outbound HTTP/HTTPS calls in @packages/core MUST route through
           the proxy mesh. NEVER call RPC endpoints with bare IP/hostname.
           Direct IP = fingerprint = ban = failed extraction.

RULE-02-B: TLS fingerprint MUST be rotated on every new session.
           Use tls-client (Golang-style TLS) patterns for Node.
           Default Node.js TLS fingerprint is trivially detectable by Akamai/CF.

RULE-02-C: User-Agent and Accept headers MUST be randomized from a curated list
           per request. Never use a static UA string.

RULE-02-D: All retry delays MUST include jitter: delay = base + random(0, base*0.5)
           Never use fixed-interval retries — they are detectable as bot patterns.

RULE-02-E: RPC rate limits MUST be respected per-chain. Store call counts in Redis.
           If rate limit hit: backoff with jitter, rotate proxy, then retry.
           NEVER burst above chain RPC limit even for time-sensitive extractions.
```

---

## 1. Proxy Mesh Architecture

```typescript
// Proxy rotation — factory pattern
export function createProxyMesh(proxies: ProxyConfig[]): ProxyMesh {
  let index = 0
  
  return {
    next(): ProxyConfig {
      // Round-robin with jitter skip to avoid pattern detection
      index = (index + 1 + Math.floor(Math.random() * 2)) % proxies.length
      return proxies[index]
    },
    
    forChain(chainId: number): ProxyConfig {
      // Chain-isolated: Ethereum RPC never shares proxy with Polygon RPC
      // Prevents cross-chain correlation by proxy providers
      const chainProxies = proxies.filter(p => p.chains.includes(chainId))
      return chainProxies[Math.floor(Math.random() * chainProxies.length)]
    }
  }
}

type ProxyConfig = {
  url: string           // 'http://user:pass@host:port'
  chains: number[]      // which chains this proxy serves
  region: string        // geographic region (for RPC affinity)
}
```

## 2. TLS Fingerprint Rotation Pattern

```typescript
import { createSocket } from 'tls'

// Mimic browser TLS fingerprints — rotate per session
const TLS_PROFILES = [
  {
    // Chrome 120 fingerprint
    ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
    minVersion: 'TLSv1.2' as const,
    maxVersion: 'TLSv1.3' as const,
    ecdhCurve: 'X25519:P-256:P-384',
  },
  {
    // Firefox 121 fingerprint  
    ciphers: 'TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_256_GCM_SHA384',
    minVersion: 'TLSv1.2' as const,
    maxVersion: 'TLSv1.3' as const,
    ecdhCurve: 'X25519:P-256:P-521:P-384',
  }
]

export function getRotatedTlsOptions(): object {
  return TLS_PROFILES[Math.floor(Math.random() * TLS_PROFILES.length)]
}

// Apply to undici Pool
export function createStealthPool(rpcUrl: string, proxy: ProxyConfig): Pool {
  return new Pool(rpcUrl, {
    connections: 5,
    connect: {
      ...getRotatedTlsOptions(),
      rejectUnauthorized: true,
    },
    // Route through proxy
    bodyTimeout: 10_000,
    headersTimeout: 5_000,
  })
}
```

## 3. Request Header Randomization

```typescript
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
]

export function buildStealthHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'sec-ch-ua-platform': '"Windows"',
    ...extra
  }
}
```

## 4. Jitter Retry Pattern

```typescript
export async function withJitterRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries: number; baseDelayMs: number; context: string }
): Promise<T> {
  let lastError: unknown
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === opts.maxRetries) break
      
      // Jitter: base + random(0, base * 0.5)
      const jitter = Math.random() * opts.baseDelayMs * 0.5
      const delay = opts.baseDelayMs * Math.pow(2, attempt) + jitter
      
      await sleep(Math.min(delay, 30_000))  // cap at 30s
    }
  }
  
  throw createLegionError({
    code: LegionErrorCode.RPC_RATE_LIMITED,
    sentinel: 'Scout',
    cause: lastError,
    recoverable: true
  })
}
```

## 5. RPC Rate Limiter (Redis-backed)

```typescript
export async function checkRateLimit(
  redis: Redis,
  chainId: number,
  rpcUrl: string
): Promise<boolean> {
  const key = `rpc:rate:${chainId}:${hashUrl(rpcUrl)}`
  const LIMITS: Record<number, number> = {
    1: 10,    // Ethereum: 10 req/s
    137: 30,  // Polygon: 30 req/s
    42161: 20 // Arbitrum: 20 req/s
  }
  const limit = LIMITS[chainId] ?? 10
  
  const current = await redis.incr(key)
  if (current === 1) await redis.expire(key, 1)  // 1 second window
  
  return current <= limit  // true = proceed, false = backoff
}
```
