# Railway — NEW env vars to paste (add to existing Railway variables)

Copy block below into Railway → legionapi → Variables.
Your existing vars from `.env` stay — only ADD these.

---

## 1) Factory + CREATE2 (required)

```env
RELAY_GAS_SPONSOR_ENABLED=true

FACTORY_ADDRESSES_JSON={"1":"0x22577De82aba57F03d677c28fC27293f86527323","56":"0xF4B67A60fEEB92992487957E0D597A0e009bb4D3","137":"0x5121Fd9F4B44fFce08eb0dcC53931663C7659eDc","43114":"0xd93E1B96103733982D76968e8668277CcBd23d57","5000":"0xd93E1B96103733982D76968e8668277CcBd23d57"}

DEPLOYER_WALLET_ADDRESS=0x51069AC011347aE8fe1048d869BBBFf7b542f9AF

# MUST be deployer wallet private key (factory.relayer = deployer, NOT settlement key)
FACTORY_RELAYER_PRIVATE_KEY=<same as your DEPLOYER_KEY — 0x51069AC0 wallet>
```

Optional per-chain implementation (API reads on-chain if RPC works; env is fallback only):

```env
FACTORY_IMPLEMENTATION_1=0xcf573347C95c7e177cBf3e2cA9CE2BedD855E5fF
FACTORY_IMPLEMENTATION_56=0xFD5A8868b6f80B323842eF88fd4AeFbf88973f89
FACTORY_IMPLEMENTATION_137=0xC218EDCCaCd1D3bE53251DFaa2c13F065C303e72
FACTORY_IMPLEMENTATION_43114=0x7Cb7C048d8cDb0BD34EDE307f2cda897AA7DdCee
FACTORY_IMPLEMENTATION_5000=0x7Cb7C048d8cDb0BD34EDE307f2cda897AA7DdCee
```

---

## 2) Extra chain RPCs (factory + deployer gas alerts)

```env
RPC_AVALANCHE_PRIVATE=https://avalanche-c-chain-rpc.publicnode.com
RPC_URL_43114=https://avalanche-c-chain-rpc.publicnode.com

RPC_SCROLL_PRIVATE=https://rpc.scroll.io
RPC_URL_534352=https://rpc.scroll.io

RPC_BLAST_PRIVATE=https://rpc.blast.io
RPC_URL_81457=https://rpc.blast.io

RPC_MANTLE_PRIVATE=https://rpc.mantle.xyz
RPC_URL_5000=https://rpc.mantle.xyz
```

---

## 3) Deployer gas Telegram thresholds (optional override)

```env
DEPLOYER_GAS_THRESHOLDS_JSON={"1":0.005,"56":0.003,"137":0.5,"42161":0.002,"8453":0.002,"10":0.002,"43114":0.05,"534352":0.002,"81457":0.002,"5000":0.5}
```

---

## 4) Already in your .env — verify on Railway

These should already exist; double-check:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SETTLEMENT_EXECUTION_PRIVATE_KEY`
- `VAULT_ADDRESS_EVM`
- `EIP7702_ENABLED=true`
- `SENTINEL_RUNTIME_ENABLED=true`

---

## Gas funding — deployer `0x51069AC011347aE8fe1048d869BBBFf7b542f9AF`

| Chain | Send (min) | Why |
|-------|------------|-----|
| **Arbitrum** | +0.001 ETH | Factory deploy pending |
| **Base** | +0.002 ETH | Factory deploy pending |
| **Optimism** | +0.002 ETH | Factory deploy pending |
| **Scroll** | +0.002 ETH | Factory deploy pending |
| **Blast** | +0.002 ETH | Factory deploy pending |
| **Ethereum** | +0.003 ETH | Low — relayer txs |
| BSC, Polygon, Avalanche, Mantle | OK for now | Factory already live |

After funding run locally:
```powershell
node contracts/deploy-factory-only.mjs
```

---

## After Railway paste

1. Redeploy API on Railway (auto on git push)
2. Test: `POST /api/v1/factory/deploy` with `{"wallet_address":"0x...","chain_id":1,"predict_only":true}`
3. Telegram will show **DEPLOYER GAS LOW** + existing **VAULT GAS LOW** every 6h
