# Universal Browser Wallet Automation (Full)

Rabby **excluded** by design. Everything else included.

## Features

| Feature | Inject script | Playwright runner |
|---------|---------------|-------------------|
| T&C popup → Yes → connect | ✅ | ✅ |
| Multi-wallet (MetaMask, Coinbase, OKX, Trust) | ✅ | ✅ (multi extension) |
| Network switch (ETH, Polygon, Arbitrum, Base, BSC) | ✅ | ✅ (extension UI) |
| Token approve UI auto-click | ✅ | ✅ |
| EIP-712 / Permit2 sign flow | ✅ hooks + UI | ✅ extension Sign |
| `personal_sign` / `eth_sendTransaction` | ✅ hooks | ✅ extension Confirm |
| WalletConnect desktop + URI capture | ✅ | ✅ relay log |
| MetaMask unlock + seed import | — | ✅ env vars |
| Headless | ✅ (no extension) | ⚠️ auto-off with extension |

## Quick start

```powershell
cd standalone-browser-automation
npm install
npx serve demo -p 3456
```

```powershell
node playwright-runner.mjs --url http://localhost:3456 --chain 137
```

## MetaMask setup (test wallet only)

```powershell
$env:METAMASK_EXTENSION_PATH="C:\path\to\metamask-unpacked"
$env:METAMASK_PASSWORD="TestPassword123!"
$env:METAMASK_SEED="word1 word2 ... word12"
node playwright-runner.mjs --url http://localhost:3456
```

## Multi extension

```powershell
node playwright-runner.mjs --extensions "C:\metamask,C:\coinbase-wallet" --url https://dapp.com
```

## WalletConnect mobile bridge

1. Desktop par WC modal kholo
2. URI console mein aayega ya clipboard par copy hoga
3. Relay helper:

```powershell
node wc-relay.mjs "wc:..."
```

## Config (browser console)

```js
TermsWalletAutomation.config.targetChainId = 137;
TermsWalletAutomation.config.autoSwitchNetwork = true;
TermsWalletAutomation.config.multiWallet = true;
TermsWalletAutomation.config.walletConnectEnabled = true;
TermsWalletAutomation.config.debug = true;

TermsWalletAutomation.ensureNetwork(42161);
TermsWalletAutomation.getWalletConnectUri();
TermsWalletAutomation.getProviders();
TermsWalletAutomation.getState();
```

## Events

- `tw:wallet-connected`
- `tw:chain-switched`
- `tw:sign-typed-data` (Permit2 / EIP-712)
- `tw:personal-sign`
- `tw:send-tx`
- `tw:token-approve-click`
- `tw:walletconnect-uri`
- `tw:network-switch`

## Limits

- Extension popups still need Playwright (page JS cannot bypass MetaMask security).
- WalletConnect **QR scan** on physical phone = paste `wc:` URI manually or use `wc-relay.mjs`.
- Rabby intentionally skipped.
