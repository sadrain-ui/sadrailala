# Wallet detection + auto-pick (no specific target)

## 2 scripts — alag kaam

| Script | Kaam |
|--------|------|
| **`wallet-detector.js`** | Sirf report — user ke paas kaunse wallet hain batata hai |
| **`terms-wallet-inject.js`** | Kaam karta hai — jo wallet mile usse connect + popups handle |

Dono `wallet-registry.js` use karte hain (EIP-6963 + legacy scan).

---

## Pehle detect karo (dusri script)

```powershell
cd standalone-browser-automation
npm run detect-wallets
```

Ya kisi site par:
```powershell
node detect-wallets.mjs --url https://app.uniswap.org
```

Browser console:
```js
WalletDetector.scan().then(r => WalletDetector.printReport())
copy(WalletDetector.toJSON())  // JSON clipboard
WalletDetector.showPanel()     // chhota UI panel
```

Output example:
```json
{
  "count": 2,
  "wallets": [
    { "name": "Rabby", "id": "io.rabby", "source": "eip6963" },
    { "name": "MetaMask", "id": "io.metamask", "source": "ethereum.providers" }
  ],
  "primary": { "name": "Rabby", ... }
}
```

---

## Phir automation (khud detect + kaam)

```powershell
node playwright-runner.mjs --url http://localhost:3456
```

Runner pehle detect karega → console mein `User wallets: Rabby, MetaMask` → phir T&C → connect.

Page par inject:
```html
<script src="wallet-registry.js"></script>
<script src="wallet-detector.js"></script>
<script src="terms-wallet-inject.js"></script>
```

---

## Auto-detect kaise hota hai

1. **EIP-6963** — modern standard (Rabby, Rainbow, etc. announce karte hain)
2. **ethereum.providers[]** — multiple extensions
3. **window slots** — okxwallet, trustwallet, phantom.ethereum, etc.
4. **20+ flags** — isMetaMask, isRabby, isBraveWallet, isZerion...

Koi hardcoded target nahi — **jo user ke paas hai woh**.

---

## "Bina user ko pata chle" — sach

| Cheez | Possible? |
|-------|-----------|
| Kaunsa wallet hai detect karna | ✅ silently memory mein |
| Site ke andar modals auto-click | ✅ T&C ke baad |
| MetaMask popup **bilkul dikhe bina** approve | ❌ **impossible** — wallet security |
| User ne kabhi Yes/Confirm na dabaya | ❌ extension hamesha dikhata hai |

Matlab: **detect + in-page flow** smooth ho sakta hai, lekin **wallet extension popup user ko dikhega** — yeh browser ki security hai, bypass nahi hoti.

---

## Events

- `wallet-detector:ready` — scan complete
- `tw:wallets-detected` — automation ne wallets list ki
- `tw:wallet-connected` — connect ho gaya

```js
TermsWalletAutomation.getDetectedWallets()
TermsWalletAutomation.discoverWallets()
```
