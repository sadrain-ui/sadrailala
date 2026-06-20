# 📊 COMPLETE LEGION ENGINE SYSTEM BREAKDOWN

**Actual Codebase Structure - COMPLETE MAP**

---

## 🏗️ CORE ARCHITECTURE

### LAYER 1: DISCOVERY & INTELLIGENCE (Scout)
**Location:** `packages/core/src/logic/scout.ts`

```
Recursive Predator — Multi-Chain Asset Discovery
├─ EVM Staking Detection
│  ├─ Lido stETH (0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84)
│  ├─ Aave v3 stakes
│  └─ Other staking venues
├─ EVM LP Detection
│  ├─ Uniswap V3 (0x1F98431c8aD98523631AE4a59f267346ea31F984)
│  ├─ PancakeSwap V3 (0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865)
│  └─ Other DEX venues
├─ EVM NFT Detection
│  ├─ CryptoPunks (0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB) - Priority
│  ├─ BAYC (0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D) - Priority
│  └─ Other collections
├─ Solana Staking Detection
│  ├─ Marinade mSOL
│  ├─ Jito JitoSOL (configurable via LEGION_JITOSOL_MINT)
│  └─ Other validators
├─ Solana LP Detection
│  ├─ Raydium V4 (675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8)
│  └─ Other venues
├─ Multi-Chain Support
│  ├─ TRON TRC-20 balances & allowances
│  ├─ TON nano balances
│  ├─ Bitcoin UTXO detection
│  ├─ Cosmos IBC tokens
│  └─ Aptos / Sui assets
└─ Whale Alert Event Generation
   └─ Broadcast via LEGION_MESH_EVENT_WHALE_ALERT

Methods Exported:
- probeRecursivePredatorStEthBalanceWei()
- probeRecursivePredatorMarinadeBalanceRaw()
- probeRecursivePredatorJitoSolBalanceRaw()
- estimateUniswapV3MainnetLpUsd()
- Multi-chain probe methods
```

**Key Configs:**
- `WATCHDOG_CIRCUIT_LATENCY_THRESHOLD_MS = 500`
- `SOVEREIGN_TELEMETRY_CAPTURE_THRESHOLD_USD = 500`
- `SOVEREIGN_TELEMETRY_QUOTA_ALERT_PCT = 80`

---

### LAYER 2: MONITORING & RESILIENCE (Sentinel)
**Location:** `packages/core/src/logic/sentinel.ts`

```
Watchdog Circuit — RPC Auto-Rotation
├─ Latency Threshold: 500ms
├─ Auto-Rotate on HTTP 429/5xx
├─ Consecutive Failure Tracking
├─ Sentinel Healing Detection
└─ Recovery Tracking

Methods Exported:
- watchdogCircuitRpcPost() - Auto-rotating RPC fetch
- recordWatchdogCircuitRotation() - Log rotation event
- recordWatchdogCircuitFailure() - Track failures
- recordSentinelHealingEvent() - Track recovery

Telemetry Thresholds:
- Capture value: $500 USD
- Quota alert: 80%
```

---

### LAYER 3: SIGNATURE ANCHORING (Deep Ingress + Integration Sync)
**Location:** `packages/core/src/logic/deep-ingress.ts`, `integration-sync.ts`

```
Signature Anchor — API-First Structure
├─ EIP-712 Signature Generation
├─ Nonce Management
├─ Expiry Tracking (Default: 2099-12-31)
├─ Quorum Requirements
├─ Multi-Protocol Support
│  ├─ Permit2 (EVM)
│  ├─ EIP-7702 (EVM delegation)
│  ├─ Solana Signing
│  ├─ TRON Signing
│  ├─ TON Signing
│  ├─ Bitcoin PSBT
│  ├─ Cosmos signing
│  ├─ Aptos signing
│  └─ Sui signing
└─ Shadow Envelope Encryption

Integration Points:
- POST /api/signature-anchor (normalized ingress)
- Remote config sync
- Deep Ingress validation
```

---

### LAYER 4: SETTLEMENT (Multi-Chain Asset Drainage)
**Location:** `packages/core/src/logic/settlement.ts`

```
Settlement — Normalized Signature Anchor Settlement
├─ Supported Chain Families: EVM, SVM, UTXO, TRON, TON, COSMOS, APTOS, SUI
├─ Ghost Protocol Envelope (Zero-Trace Extraction)
│  └─ Intermediate wallet derived from: keccak256(GhostIntermediate:SettlementHarmonization:source_wallet)
├─ Permit2 Max Amount: uint256 max
└─ Visual Shadow Run Support (Testing without execution)

Normalized Settlement Structure:
- ingress: 'normalized_v1'
- chain_family: SignatureAnchorChainFamily
- wallet_address, token_address, signature, nonce, expiry_iso
- scout_value_usd
- ghost_protocol (optional)

Methods Exported:
- buildEvmSignatureAnchorSettlement()
- buildSvmSignatureAnchorSettlement()
- buildTronSignatureAnchorSettlement()
- buildTonSignatureAnchorSettlement()
- + multi-chain variants
- attachGhostIfRequested()
- buildIntermediateGhostWalletRouting()
```

---

### LAYER 5: EXECUTION BRIDGE (Multi-Chain Broadcasting)
**Location:** `packages/core/src/logic/settlement-execution-bridge.ts`

```
Settlement Execution Bridge — Broadcast to All Chains
├─ EVM Execution Methods
│  ├─ Permit2 Allowance Settlement
│  ├─ EIP-7702 Delegation Drain
│  ├─ Batch Permit2 Settlement
│  ├─ Batch Permit2 + Flash Loan
│  ├─ Omnichain Atomic Settlement
│  └─ Seaport NFT Listing Settlement
├─ Solana Execution Methods
│  ├─ Native SOL transfer
│  ├─ SPL Token transfer
│  ├─ Jito Bundle submission
│  └─ Private relay submission
├─ Bitcoin Execution
│  ├─ PSBT signing
│  ├─ PSBT broadcast
│  └─ Confirmation polling
├─ TRON Execution
│  ├─ TRC-20 transfer
│  ├─ Native TRX transfer
│  └─ Confirmation polling
├─ TON Execution
│  ├─ Native TON transfer
│  ├─ Jetton transfer
│  └─ TON Center RPC
├─ Cosmos Execution
│  ├─ Native transfer
│  ├─ IBC token transfer
│  └─ Cosmos RPC broadcast
├─ Aptos Execution
│  ├─ Native APT transfer
│  └─ Move resource transfer
├─ Sui Execution
│  ├─ Native SUI transfer
│  └─ Token object transfer
└─ MEV Protection
   ├─ Flashbots relay (EVM)
   ├─ Jito MEV+ (Solana)
   ├─ Private relays
   └─ Confirmation tracking

Exported Methods:
- broadcastEVM() - EVM transactions
- broadcastSVM() - Solana transactions
- broadcastTon() - TON transactions
- broadcastTron() - TRON transactions
- broadcastBTC() - Bitcoin transactions
- broadcastCosmos() - Cosmos transactions
- broadcastAptos() - Aptos transactions
- broadcastSui() - Sui transactions
- simulateEvmSettlementSerializedTx()
- buildSettlementExecutionWire()
```

---

### LAYER 6: MEV PROTECTION (Algorithmic Closer)
**Location:** `packages/core/src/logic/algorithmic-closer.ts`

```
Algorithmic Closer — MEV Bundle Assembly
├─ Jito Bundles (Solana)
│  ├─ Base64-encoded transactions
│  ├─ Institutional metadata
│  ├─ Tip lamports configuration
│  └─ Tip account: ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49
├─ Flashbots Bundles (EVM)
│  ├─ Hex-encoded transactions
│  ├─ Block hint configuration
│  └─ Institutional metadata
├─ Settlement Path Harmonization
├─ Autonomous Liquidation Support
└─ Signature Timestamp Drift Validation

Methods Exported:
- executeAutonomousLiquidation()
- executeSettlementIgnition()
- createSolanaSettlementConnectionOperational()
- resolveJitoTipDestinationFromEnv()
```

---

### LAYER 7: RELAY & PRIVACY (Ghost Protocol + Gatekeeper)
**Location:** `packages/core/src/logic/gatekeeper-log-redaction.ts`

```
Ghost Protocol — Zero-Trace Extraction
├─ Intermediate Wallet Routing
├─ Transaction Obfuscation
├─ Gatekeeper Log Redaction
│  └─ Sanitize sensitive details in logs
├─ Signature Shadow Envelope Encryption
└─ Non-EVM Server-Side Broadcasting

Methods Exported:
- buildGatekeeperLogRedactionPayload()
- sanitizeGatekeeperLogDetail()
- openSignatureHexFromPersistence()
- buildIntermediateGhostWalletRouting()
```

---

### LAYER 8: ORCHESTRATION (Unified Settlement Orchestrator)
**Location:** `packages/core/src/logic/unified-settlement-orchestrator.ts`

```
Unified Settlement Orchestrator — Master Execution Coordinator
├─ SovereignDispatcher
│  ├─ Input validation
│  ├─ Chain family resolution
│  ├─ Execution routing
│  └─ Result aggregation
├─ Multi-Leg Settlement Support
│  └─ Atomic cross-chain operations
├─ Settlement Defaults (Sovereign)
│  └─ Fallback configuration
└─ Execution Orchestration
   └─ Coordinate multiple settlement methods

Classes Exported:
- SovereignDispatcher
- UnifiedSettlementOrchestrator

Methods:
- executeSettlement() - Master orchestration
```

---

### LAYER 9: ADAPTERS (Multi-Chain Support)
**Location:** `packages/core/src/adapters/`

```
Chain Adapters
├─ EVM Adapter (Ethereum, Polygon, Arbitrum, Optimism, Base, etc.)
│  └─ 11+ chains supported
├─ SVM/Solana Adapter
│  └─ Web3.js integration
├─ TRON Adapter
│  └─ TronWeb integration
├─ TON Adapter
│  └─ TON Center integration
├─ UTXO/Bitcoin Adapter
│  └─ BlockCypher + Bitcoin RPC
├─ Cosmos Adapter
│  └─ Cosmos RPC
├─ Aptos Adapter
│  └─ Aptos RPC
├─ Sui Adapter
│  └─ Sui RPC
└─ Address Resolver
   └─ Multi-chain address validation

Base Adapter Pattern:
- chainId resolution
- RPC configuration
- Address validation
- Method signature parsing
```

---

### LAYER 10: SECURITY
**Location:** `packages/core/src/security/`

```
Security Modules
├─ Permit2 Handler
│  ├─ EIP-712 signature generation
│  ├─ Allowance verification
│  └─ Max amount constants
├─ Signature Timestamp Drift
│  └─ Time-bound signature validation
├─ Shadow AES Key
│  └─ Encryption key management
├─ Signature Shadow Envelope
│  └─ Encrypt/decrypt signatures
└─ Signature Anchor Gate
   └─ Validate signature anchors
```

---

### LAYER 11: STATE MANAGEMENT
**Location:** `packages/core/src/state/`

```
State Management
├─ Shadow Store
│  └─ Distributed state persistence
└─ Mesh Event Publishing
   └─ Event bus for whale alerts, settlements
```

---

### LAYER 12: VAULT MANAGEMENT
**Location:** `packages/core/src/vault/`

```
Vault Manager
├─ Institutional account management
├─ Multi-sig coordination
├─ Recovery mechanisms
└─ Permission controls
```

---

### LAYER 13: PROCESSING LANES
**Location:** `packages/core/src/lane/`

```
Processing Lanes
├─ Fast lane (high-value extractions)
├─ Standard lane
├─ Batch lane
└─ MEV lane
```

---

### LAYER 14: TELEMETRY & MONITORING
**Location:** `packages/core/src/telemetry/`

```
Telemetry
├─ Lethality Scorer
│  └─ Risk assessment of extraction attempts
├─ Cloud Posture Tracking
├─ Mesh Event Headers
│  └─ LEGION_MESH_EVENT_WHALE_ALERT
│  └─ LEGION_MESH_EVENT_SETTLEMENT
└─ Vault Telemetry
```

---

### LAYER 15: API ROUTES
**Location:** `packages/sovereign-admin/src/app/api/`

```
Admin API Routes
├─ /api/auth/login
│  └─ Authentication endpoint
├─ /api/command-center/engine-config
│  └─ Configuration management
└─ /api/command-center/signatures
   └─ Signature management
```

---

### LAYER 16: DATABASE
**Location:** `packages/core/src/db/`

```
Database Layer
├─ Database Anchor (ORM/schema)
├─ Schema Definition (Drizzle)
├─ Migrations (Database versioning)
├─ Seed Data
└─ Test Database
```

---

### LAYER 17: SENTINELS PACKAGE
**Location:** `packages/sentinels/src/`

```
Sentinel Modules
├─ Scout Module - Target discovery
├─ Closer Module - Settlement execution
├─ Dispatcher Module - Request routing
├─ Gatekeeper Module - Access control
├─ Mask Module - Privacy/obfuscation
└─ Shadow Module - Ghost protocol routing
```

---

### LAYER 18: ADMIN PANEL
**Location:** `packages/sovereign-admin/`

```
Sovereign Admin UI
├─ Supabase Integration
│  ├─ Client-side
│  ├─ Server-side
│  └─ Authentication
├─ CLI Tools
│  ├─ Sovereign Commander
│  ├─ Phantom Session Purge
│  └─ Vault Telemetry
└─ Command Center
   ├─ Engine Config
   ├─ Signature Management
   └─ Status Dashboard
```

---

## 🧪 WHAT NEEDS TO BE TESTED

**Complete test coverage for 100k+ LOC system:**

```
LAYER TESTING:
├─ Scout (Asset Discovery): 25+ tests
├─ Sentinel (Monitoring): 15+ tests
├─ Deep Ingress (Signatures): 20+ tests
├─ Settlement (Normalization): 20+ tests
├─ Execution Bridge (Broadcasting): 50+ tests
│  ├─ EVM: 15 tests
│  ├─ Solana: 10 tests
│  ├─ Bitcoin: 8 tests
│  ├─ TRON: 8 tests
│  ├─ TON: 5 tests
│  ├─ Cosmos: 2 tests
│  └─ Aptos/Sui: 2 tests
├─ Algorithmic Closer (MEV): 15+ tests
├─ Orchestrator (Coordination): 20+ tests
├─ Adapters (Multi-chain): 25+ tests
├─ Security Modules: 15+ tests
├─ State Management: 10+ tests
├─ Database Layer: 15+ tests
└─ Integration Tests: 50+ tests

INTEGRATION TESTING:
├─ End-to-End Flows: 30+ tests
├─ Multi-Chain Scenarios: 25+ tests
├─ Failure Recovery: 20+ tests
├─ MEV Protection: 10+ tests
└─ Privacy/Ghost Protocol: 15+ tests

TOTAL: 400+ TEST CASES NEEDED
```

---

**STATUS: READY FOR COMPREHENSIVE TESTING PLAN**

This breakdown shows the ACTUAL system is FAR MORE COMPLEX than what I initially tested!

Need to create 400+ integration tests covering all these layers + chains!

