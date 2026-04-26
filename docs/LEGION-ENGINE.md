# LEGION ENGINE

Universal Asset Vacuum for institutional-grade, sovereign-controlled extraction across public ledgers.

Legion Engine ek multi-sentinel backend hai jo wallets, chains, protocols aur liquidity venues ko ek **single war-room surface** me fold karta hai. Engine ka design **frontend-agnostic** hai: koi bhi UI, CLI ya agent isko use kar sakta hai, lekin control hamesha Gatekeeper ke paas rehta hai.

---

## 1. Mission & Guarantees

Legion Engine ka primary mission:

- **Universal Asset Vacuum**: Omni-chain portfolios ko discover, value, aur selectively drain karna — bina human ko low-level DeFi UX touch karaye.
- **Sovereign Control**: Final consent, kill-switch aur policy override hamesha Gatekeeper layer me rahe.
- **Operational Stealth**: Extraction lanes ko aise route karna ki infra providers, researchers, ya targets kisi centralized hunter ko reliably fingerprint na kar saken.
- **Institutional Reliability**: Crash, RPC failure, partial fills, ya replay attempt ke baad bhi system deterministic recovery kare.

Engine ye guarantees deta hai:

1. **No orphaned signatures**: Kisi bhi AssetExtraction lane ka signature ya to successfully execute hota hai, ya explicit timeout / block miss pe expire ho jata hai.
2. **No mixed-timing workers**: Ethereum jaise 12s blocktime aur Solana jaise sub-second chains ko kabhi generic worker pool me mix nahi kiya jata.
3. **No direct vault exposure**: Extraction lanes kabhi target wallets se sovereign vaults tak straight line nahi banate; hamesha ek anonymity hop ke through jata hai.
4. **Self-healing lanes**: Private RPC lane degrade ya fail hone par Dispatcher automatically backup ghost lane par flip karta hai bina session break kiye.

---

## 2. Core Concepts & Terminology

- **Telemetry**: Chain-agnostic observation of balances, positions, approvals, credit lines, pending intent, aur historical flows.
- **AssetExtraction Event**: Ek discrete, structured event jo kisi asset/position ko ek chain se nikalne ya reposition karne ki intent describe karta hai.
- **Extraction Lanes**: End-to-end pipelines jo telemetry se start hoke, consent, routing, execution, anonymity hop aur settlement tak jaate hain.
- **Sovereign Sync**: Engine ka control-plane refresh loop, jahan Gatekeeper policies, vault topology, kill-switch state sync hoti hai.
- **Ghost Lanes**: Private execution paths jo public mempool ke bahar operate karte hain (Flashbots, MEV-Share, private relayers).
- **War-Room Session**: Time-bounded operation window jahan Gatekeepers live portfolio tak command & control exercise karte hain.

---

## 3. The Sentinel Matrix

| Sentinel | Institutional Role | Logic Source (DNA) |
|---|---|---|
| Mask | Psychological trust & infiltration | Ledger/Trezor UX, hardware wallet flows |
| Scout | Omni-chain asset telemetry & discovery | Rabby, DeBank, 1inch, DefiLlama indexers |
| Closer | Cryptographic handshake & one-tap consent | Uniswap Permit2, Seaport bundles, Safe modules |
| Dispatcher | Ghost execution & private lane routing | Flashbots Protect, MEV-Share, LayerZero relayers |
| Shadow | Cloak, fingerprinting & researcher defense | Slither, proxy farms, fingerprint hardening |
| Gatekeeper | Sovereign command & war-room control | DefiLlama data, custom admin terminals |

### 3.1 Sentinel Responsibilities

**Mask**
- User-facing trust flows, progressive attestation, hardware-wallet-aligned UX.
- Phishing resistance: flows jo typical DeFi "sign anything" se fundamentally alag lagein.

**Scout**
- Multi-chain telemetry: balances, LP positions, debt, staked assets, pending intents.
- Har account ke liye lethality profile banata hai — high-value vs noise.

**Closer**
- Signable payloads design karta hai (Permit2 approvals, intent bundles, Safe-style batched ops).
- **Conditional Commitment Logic**: Signature sirf tab valid hai jab specific block range ke andar execute ho YA specific private relayer ke zariye jaye. Block miss ya bundle leak hone par signature auto-expire.

**Dispatcher**
- Extraction Lanes ko concrete execution hops me convert karta hai.
- Ghost lanes me routing: Flashbots, MEV-Share, private RPC pools, cross-chain relayers.
- Latency-aware routing: agar lane >200ms degrade ho, bin session drop kiye backup ghost lane pe flip.

**Shadow**
- Researchers, scanners aur anomaly detectors ke against defense.
- Proxy topology, request patterns, fingerprint entropy, simulation-only dry runs.

**Gatekeeper**
- Sovereign command surface: approvals, aborts, throttling, regional policies, kill-switch.
- DefiLlama + internal data ke upar real-time risk dashboards.
- Human-in-the-loop: koi bhi high-lethality extraction Gatekeeper approval ke bina nahi jata.

---

## 4. Architecture Overview

### 4.1 Layers

1. **Ingress & Identity** — Frontends (web, CLI, mobile, agents) -> Mask / Gatekeeper APIs. AuthN/AuthZ, session establishment.
2. **Telemetry & Planning** — Scout + internal indexers -> Asset telemetry, portfolio graph, AssetExtraction event graph.
3. **Consent & Routing** — Closer -> conditional signatures. Dispatcher -> route selection, ghost lane pairing.
4. **Execution & Stealth** — Dispatcher + Shadow -> private RPC lanes, proxy mesh, anonymity hops, settlement.

Har layer **frontend-agnostic**: multiple UIs, bots, ya automated clients engine ko parallel me operate kar sakte hain.

### 4.2 Anonymity Layer (The Hop)

Direct path (target wallet -> sovereign vault) production me **forbidden** hai.

All extraction lanes must pass through at least one anonymity hop:
- Hop Wallets / Ephemeral Vaults
- Mixer / Route Obfuscation layer (jahan applicable)

Rule: "Predator never sees the hunter's lair."

---

## 5. Protocol DNA & External References

| Capability | DNA Source |
|---|---|
| EVM Core | Viem-inspired RPC abstraction, type-safe clients |
| Wallet & UX | Ledger/Trezor, Rabby UI patterns |
| Indexer schemas | Rabby, DeBank, 1inch, DefiLlama APIs |
| Consent flows | Uniswap Permit2, Seaport bundles, Safe transaction modules |
| Ghost execution | Flashbots Protect, MEV-Share, private relay frameworks |
| Simulation & defense | Slither, Tenderly-style sim stacks, custom proxy farms |
| Cross-chain | LayerZero-style messaging, canonical bridge patterns |
| Solana support | solana-web3.js patterns, Sentinel-2 RPC abstraction |

`/infra` aur `packages/core` ka har subsystem clearly document karega: "Is behavior ka reference kaun sa public system hai?"

---

## 6. State & Persistence Model

### 6.1 Postgres as Canonical Truth

Postgres hai **canonical state store**: users, masked_accounts, portfolios, AssetExtraction events, sentinel runs, executions, policies, simulations, RPC endpoints.

Sab critical transitions **atomic transactions** ke through commit hote hain.

### 6.2 Redis: Durable In-Flight State (NOT Rebuildable Cache)

**Risk**: Agar extraction ke beech Redis crash ho jaye, nonce tracking aur in-flight signature state kho jayegi. Kuch seconds ke window me submission miss ho sakta hai.

**Design requirement**:
- Redis **AOF (Append Only File)** persistence ke sath configure hoga.
- Critical in-flight structures: Redis write + Postgres atomic transaction — ya dono commit, ya dono fail. No half-applied signature windows.

---

## 7. Concurrency, Sharding & Workers

### 7.1 Chain-Isolated Sharding

Generic "N stateless replicas" **galat** hai. Worker pools chain-aware honge:

- **Ethereum/EVM cluster** — 12s blocktime, heavy batch jobs.
- **Solana cluster** — ~400ms blocktime, high-frequency flow.
- **Other chains/L2s** — apna logical shard.

Har shard ke paas apna: latency budget, blocktime assumptions, queue depth, retry policy.

Solana ki speed Ethereum ki latency se choke nahi hoti. Ethereum ke heavy jobs Solana flow ko block nahi karte.

### 7.2 Extraction Lanes vs Generic Jobs

Har lane = multiple steps: telemetry snapshot -> planning -> consent -> routing -> ghost lane submission -> settlement. Har lane ke sath chain-specific SLA attach hota hai.

---

## 8. Observability & Active Self-Healing

Passive observability (sirf logs/metrics) **insufficient** hai.

### 8.1 Health Probes & SLOs

Har private RPC / ghost lane ke liye:
- Latency SLO: p95 < 200ms
- Error-rate threshold
- Slot/block lag thresholds

### 8.2 Automatic Lane Failover

Dispatcher behavior:
- Agar primary private RPC SLO breach kare (p95 > 200ms) ya hard fail de:
  - Binary-switch to backup ghost lane.
  - In-flight lanes resume bina session drop ya user re-consent ke (jab tak signature valid hai).

Observability stack confirm karta hai: "Engine ne khud ko reroute kar liya" — sirf "engine down hai" nahi.

---

## 9. Execution Safety: Replay & Front-Running

**Risk**: Private bundle include na ho aur mempool me leak ho jaye. MEV bots leaked signature replay karke assets redirect kar sakte hain.

### 9.1 Conditional Commitment Logic (Closer)

Signatures aise design honge:
- Transaction **tabhi valid** ho jab:
  - Specific block number / block range ke andar mined ho, **AND/OR**
  - Specific relayer (e.g., Flashbots endpoint) ke zariye submit ho.
- Block window miss ya relayer condition violate -> **automatic expire** (on-chain deadlines + off-chain revocation dono level).

---

## 10. RPC Pool & Metadata Anonymity

**Risk**: Providers (Alchemy, Infura, etc.) IP, User-Agent, headers, timing log karte hain. 10,000 extractions ek server IP se -> rate limits, bans, identity link.

### 10.1 Client-Side Proxy Injection (Shadow)

- Har worker replica ka apna **Residential Proxy Mesh**.
- Provider ke nazariye se: requests 10,000 alag households se aa rahi lagni chahiye.
- Fingerprint hardening: UA rotation, realistic fingerprints, time-based jitter, provider-specific organic patterns.
- RPC configs me: proxy profiles bhi configure honge, sirf tokens nahi.

---

## 11. Lethality-Based Decomposition

**Risk**: 50 tokens ek shot me sync -> block gas limit hit ya slippage itni high ki extraction unprofitable.

### 11.1 Decomposition Strategy (Dispatcher)

Dispatcher portfolio ko lethality slices me todta hai:

1. High-value assets ($10,000+ equivalent) — pehle
2. Mid-tier assets
3. Long tail / dust — idle capacity windows me

Result: time-to-value drastically kam, success rate maximized, system "fast and sufficient" behave karta hai.

---

## 12. Sovereign Control & War-Room Flows

Gatekeeper design explicitly **War-Room** pattern:

- **Live session view**: Active Extraction Lanes, Ghost lanes & RPC health, Sentinel activity.
- **Controls**: Global pause, region-specific pause, per-chain rate limits, per-wallet kill-switch.
- **Audit trail**: Har high-lethality action — kis operator ne approve kiya, kis context me, kis policy se.

> Sentinels automation provide karte hain, lekin **Sovereign permission** hamesha human Gatekeeper ke paas rehti hai.

---

## 13. Implementation Sequence

1. **Docs & DNA** — Research docs `docs/research/` me commit karo. API-SPEC, STATE-MACHINE, DB-SCHEMA align karo.
2. **Core Packages** — `packages/core`: Viem-based clients, telemetry engines, Extraction Lane state machines, replay-protection primitives.
3. **Infra & RPC** — `infra/`: Redis AOF + Postgres sync, chain-isolated worker pools, proxy mesh, ghost lane configs.
4. **Gatekeeper Surface** — War-room API + minimal admin UI. Policies, kill-switches, audit log streams.

Ye document **engineering contract** ke roop me treat hona chahiye — koi bhi implementation jo in guarantees ko break kare, usse explicit risk exception chahiye ya reject hona chahiye.
