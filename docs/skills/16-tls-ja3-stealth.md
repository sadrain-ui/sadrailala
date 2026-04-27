# SKILL-16: TLS JA3 STEALTH (SKILL Layer — Browser Fingerprint Mimicry)
# Source: github.com/bogdanfinn/tls-client (Readme.md, profiles/)
# Scanned: Real ClientProfile API from tls-client Readme — NOT generic
# Priority: SKILL-2 (all external HTTP calls in Legion use stealth profiles)

## [STRICT_RULES]
```
RULE-16-A: NEVER use Node.js default http/https for DeFi protocol API calls.
            Default Node TLS = instantly fingerprinted as bot. Use tls-client with profiles.
            Source: tls-client WithClientProfile(profiles.Chrome_144)

RULE-16-B: Rotate between 3+ browser profiles per session. NEVER use same profile repeatedly.
            Same JA3 + same IP = pattern match. Rotate: Chrome_144 -> Firefox_135 -> Safari_18.
            Source: tls-client profiles package (Chrome, Firefox, Safari, Edge available)

RULE-16-C: HTTP/3 (QUIC) fingerprinting: use profiles that support QUIC where available.
            QUIC fingerprint is separate from TLS JA3. Both must match target browser.
            Source: tls-client Readme: 'HTTP/3 Fingerprinting - Accurate QUIC/HTTP/3 fingerprints'

RULE-16-D: User-Agent header MUST match the TLS profile exactly.
            Chrome_144 profile + Firefox UA = fingerprint mismatch = instant detection.
            Source: tls-client Readme: 'it is not enough to change the user-agent header'

RULE-16-E: For Legion RPC calls: use tls-client only for web scraping / DEX price feeds.
            Ethereum JSON-RPC does NOT fingerprint TLS. Only external REST APIs need stealth.
```

## [MENTAL_MODEL]
```
TLS Fingerprinting detection chain (what we bypass):

  Server sees:
    1. TLS ClientHello (cipher suites, extensions, curves) = JA3 fingerprint
    2. HTTP/2 SETTINGS frame order = HTTP/2 fingerprint
    3. User-Agent header
    4. Header order (Cookie, Accept, etc.)

  tls-client mimics all 4 layers of a REAL browser.
  Result: server sees Chrome 144, not 'Node.js bot'.

Legion needs this for:
  - DEX aggregator price scraping (1inch, ParaSwap web interfaces)
  - NFT floor price feeds
  - Protocol TVL monitoring via web interfaces
  - Any API that blocks non-browser TLS
```

## [REAL API — from tls-client Readme source scan]
```typescript
// tls-client is a Go library with Node.js bindings via cffi
// Install: npm install @dryft/tls-client (Node.js wrapper)

import tlsClient from '@dryft/tls-client'

// Available profiles from tls-client:
const BROWSER_PROFILES = [
  'Chrome_144',
  'Chrome_124',
  'Firefox_135',
  'Firefox_117',
  'Safari_18_0',
  'Edge_131'
] as const

type BrowserProfile = typeof BROWSER_PROFILES[number]

// RULE-16-A, 16-B: rotate profiles
function getRandomProfile(): BrowserProfile {
  return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)]
}

// RULE-16-D: matching UA per profile
const USER_AGENTS: Record<BrowserProfile, string> = {
  'Chrome_144': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Chrome_124': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Firefox_135': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
  'Firefox_117': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0',
  'Safari_18_0': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Edge_131': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
}

async function stealthFetch(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
  const profile = getRandomProfile() // RULE-16-B: rotate

  // RULE-16-D: matching UA
  const headers = {
    'User-Agent': USER_AGENTS[profile],
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    ...options.headers
  }

  // RULE-16-A: tls-client, not Node default https
  const client = tlsClient.NewHttpClient(
    tlsClient.NewHttpClientOptionsSetter()
      .SetClientProfile(profile) // JA3 fingerprint
      .SetTimeout(30)
      .Build()
  )

  return client.Execute({
    method: options.method ?? 'GET',
    url,
    headers,
    body: options.body
  })
}
```

## [LEGION USE CASES]
```
- 1inch web price feed: stealthFetch('https://app.1inch.io/v6.0/1/quote?...')
- NFT floor scraping: stealthFetch('https://opensea.io/api/v2/...')
- Protocol TVL: stealthFetch('https://defillama.com/api/...')
- Rate limit bypass: rotate profiles + proxy IPs
- NEVER use for: Ethereum RPC calls (RULE-16-E)
```
