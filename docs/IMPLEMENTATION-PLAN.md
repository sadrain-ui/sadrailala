# Legion Engine — Final Implementation Plan v2 (Hardened)

> Universal implementation roadmap for Legion Engine across EVM, SVM, UTXO, COSMOS, and SUBSTRATE, with docs-first hardening, backward-compatible evolution, atomic workflow control, compensation-aware orchestration, and phased rollout safety.

---

## Overview

Legion Engine is being built as a universal, chain-aware system that can reason across multiple execution families without collapsing them into a fake “one-chain-fits-all” model. The implementation strategy is deliberately phased: first remove ambiguity from the repository, then build the data and workflow foundations, then add read paths, then simulation and signing, and only then enable narrowly scoped live execution.

This roadmap exists to enforce four non-negotiables:

1. **Universal awareness** — EVM, SVM, UTXO, COSMOS, and SUBSTRATE must be modeled explicitly.
2. **Backward compatibility** — existing `chain_id` and `chain_shard` semantics must remain intact during rollout.
3. **Atomic correctness** — correctness-sensitive workflow transitions must be idempotent and atomic.
4. **Safe rollout** — live execution must be feature-flagged, simulation-gated, and narrow by default.

---

## Guiding Rules

- **Docs before code**: Research, schema, state, and API contracts must be universal-aware before implementation begins.
- **Backward compatibility first**: Preserve `chain_id` and `chain_shard`; introduce new universal fields additively, then backfill, then enforce.
- **Read before write**: Discovery and simulation paths must be stable before enabling real execution.
- **Atomic transitions only**: Shared workflow state must use atomic and idempotent transition semantics.
- **Compensation over fake atomicity**: Cross-chain workflows must use saga-style compensation, not pretend to be globally ACID.
- **Observability before scale**: Logs, metrics, traces, and audit events must exist before expanding execution scope.
- **Feature-flagged rollout**: Every new family, adapter, or execution path ships behind narrow flags and policy controls.

---

## Phase 0 — Repository Hardening and Universal Normalization

**Goal:** Make the repository unambiguous for Cursor and future contributors.

### Objectives
- Normalize all research docs with fixed YAML metadata.
- Sync `DB-SCHEMA.md`, `STATE-MACHINE.md`, `API-SPEC.md`, `LEGION-ENGINE.md`, and this file.
- Remove EVM-default ambiguity from docs and research.
- Fill missing research coverage for universal chain families and infra dependencies.

### Deliverables
- Universalized `docs/research/*`
- Standardized metadata keys:
  - `chain_family`
  - `resource_model`
  - `signing_model`
  - `cross_chain_capable`
  - `cursor_use`
- Synced architecture/core docs
- Cursor-readiness audit with blockers removed

### Exit Criteria
- No research file remains context-blind.
- No core doc assumes EVM-only behavior unless explicitly marked.
- Repo is safe to use as coding context.

---

## Phase 1 — Foundation: Database, Chain Registry, and Infra Contracts

**Goal:** Establish the persistent backbone with migration-safe universal support.

### Objectives
- Introduce `chain_registry` as the canonical universal chain descriptor table.
- Preserve legacy compatibility for `chain_id` and `chain_shard`.
- Standardize high-precision storage for balances, fees, and amounts.
- Define Redis persistence usage for queueing, coordination, and workflow state.

### Deliverables
- Drizzle schema updates
- Additive migrations only
- `chain_registry` table
- Universal family metadata support
- Numeric precision discipline (`numeric(78, 0)` or equivalent mapping)
- Redis persistence model for:
  - queue state
  - workflow coordination
  - nonce/account coordination caches

### Constraints
- No destructive schema changes
- No rename/remove of legacy fields in this phase
- Add first, migrate later, enforce later

### Exit Criteria
- Schema compiles
- Migrations are additive
- Existing consumers remain compatible

---

## Phase 2 — Observability, Validation, and Test Harnesses

**Goal:** Install the safety net before workflow complexity grows.

### Objectives
- Add structured logs, metrics, traces, and audit events.
- Add validation for core schemas and payload contracts.
- Create local simulation/shadow harnesses.
- Build fixture-driven tests for docs/schema/API consistency.

### Deliverables
- Telemetry event taxonomy
- Logging conventions
- Metric/tracing hooks
- Contract tests
- Fixture data and local harnesses
- Error classifications and baseline alerts

### Exit Criteria
- Every critical workflow emits structured telemetry
- Core contracts can be validated automatically
- Local test harnesses exist for future phases

---

## Phase 3 — Core Orchestration, Concurrency Control, and Atomic State Engine

**Goal:** Build the durable workflow backbone with race-safe concurrency.

### Objectives
- Implement job orchestration and state transitions.
- Add retries, timeouts, dead-letter paths, and recovery metadata.
- Enforce atomic state transitions under concurrent worker load.
- Prevent account-level or wallet-level race conditions.

### Deliverables
- Workflow engine skeleton
- Job/state enums and transition guards
- Queue payload contracts
- Retry and timeout semantics
- Dead-letter handling
- Redis-backed atomic transition helpers
- Redis Lua scripts for correctness-sensitive transitions
- Per-account / per-wallet coordination lanes
- Idempotency keys
- Atomic nonce allocation primitives
- Lock ownership tokens and TTL renewal policies

### Hardening Notes
- Workers touching the same account must not compete naïvely.
- Shared state transitions must be atomic.
- Nonce allocation must be treated as a correctness boundary, not a convenience helper.

### Exit Criteria
- Concurrent worker simulation does not corrupt workflow state
- Duplicate transition attempts remain idempotent
- Nonce/account coordination path exists and is testable

---

## Phase 4 — Universal API and Compensation-Aware Workflow Contracts

**Goal:** Expose stable control surfaces and make partial-failure behavior explicit.

### Objectives
- Add chain-family-aware REST and WebSocket contracts.
- Propagate correlation IDs and saga IDs end to end.
- Explicitly model partial success and compensation paths for multistep workflows.

### Deliverables
- Auth/session shell
- REST endpoints for:
  - jobs
  - simulations
  - policies
  - watchlists
  - status
- WebSocket streams for:
  - job updates
  - state changes
  - lane updates
  - simulation/execution events
- Validation schemas
- Saga IDs and correlation IDs
- Compensation contracts
- Rollback state taxonomy
- Manual-recovery and dead-letter interfaces

### Hardening Notes
Cross-chain workflows must support:
- forward actions
- compensation actions
- timeout behavior
- operator intervention paths
- terminal states such as:
  - `completed`
  - `compensated`
  - `partial_failed`
  - `manual_recovery_required`

### Exit Criteria
- API is chain-family aware
- Compensation states are first-class
- No multileg workflow relies on fake global atomicity

---

## Phase 5 — Chain Abstraction Layer and Transport Hygiene

**Goal:** Build the universal chain client abstraction and baseline provider discipline.

### Objectives
- Implement `IChainClient`-style interfaces.
- Separate account-based, UTXO-based, and message-based models cleanly.
- Add provider transport abstraction and baseline fingerprint hygiene.

### Deliverables
- Adapter boundaries for:
  - EVM
  - SVM
  - UTXO
  - COSMOS
  - SUBSTRATE
- Resource model separation
- Signing model separation
- Execution model separation
- Provider transport abstraction
- Retry, timeout, and backoff rules
- Baseline transport fingerprint consistency
- Provider behavior normalization

### Hardening Notes
Basic RPC/client hygiene starts here, not later. The first network touch already creates observable behavior, so baseline transport discipline belongs in the adapter/runtime phase.

### Exit Criteria
- Chain families are modeled explicitly
- Adapters compile against a shared contract
- Baseline provider behavior is controlled

---

## Phase 6 — Scout Sentinel: Universal Read-Only Discovery

**Goal:** Implement read-only discovery across supported families.

### Objectives
- Start with balances, holdings, positions, and protocol exposure.
- Normalize outputs into shared internal telemetry models.
- Validate chain adapters with real read paths before any signing or dispatch.

### Deliverables
- EVM discovery paths
- Solana discovery paths
- Bitcoin/UTXO discovery paths
- Cosmos/Substrate reads where practical
- Shared normalized asset/position models
- Optional lightweight pricing hooks
- Initial lethality or priority scoring

### Exit Criteria
- Read-only discovery works across initial supported families
- Internal models are normalized enough for simulation/policy layers
- No live write path exists yet

---

## Phase 7 — Simulation, Policy Engine, and Safety Gates

**Goal:** Validate intent before any signing or dispatch is enabled.

### Objectives
- Add dry-run/simulation contracts.
- Add risk and policy gates.
- Add explainable failure reasons and block decisions.

### Deliverables
- Simulation request/response models
- Policy engine scaffolding
- Chain restrictions
- Value/risk thresholds
- Allow/deny rules
- Manual approval requirements
- Failure classification
- Explainable block reasons
- Resource/fee sanity checks

### Exit Criteria
- Every planned action can be evaluated before signing
- Policy rejections are explainable
- Dry-run path is production-usable

---

## Phase 8 — Closer Sentinel: Signing Preparation and Consent Envelopes

**Goal:** Prepare family-specific signing flows without broad live execution.

### Objectives
- Model signing requests for heterogeneous chains safely.
- Support hardware-safe and multisig-aware approval flows.
- Add replay and expiry protection.

### Deliverables
- EVM signing envelope/request builders
- Bitcoin PSBT request builders
- Solana message/versioned transaction builders
- Expiry and replay metadata
- Commitment/approval metadata
- Hardware-wallet-safe request modeling
- Multisig-aware flows

### Exit Criteria
- Signing preparation works without enabling broad auto-dispatch
- Request models are safe for human/hardware review
- Replay/expiry protections are represented

---

## Phase 9 — Dispatcher Sentinel: Controlled Execution and Private Routing

**Goal:** Enable the smallest safe live execution slice first.

### Objectives
- Turn on one narrow live path only.
- Require passing simulation/policy conditions.
- Keep execution scope bounded by flags and policy.

### Deliverables
- Dry-run to live gate
- Feature-flagged narrow dispatcher path
- Limited family/adapter rollout
- Audit event emission
- Kill-switch support
- Version-aware compatibility checks
- Private routing where applicable

### Exit Criteria
- One narrow live path works end to end
- Live execution is reversible and observable
- Scope expansion is still blocked by default

---

## Phase 10 — Gatekeeper, Mask, and Trust Controls

**Goal:** Centralize operator trust, approvals, governance, and auditability.

### Objectives
- Add war-room controls
- Add hardware trust boundary workflows
- Enforce tenant/chain policy boundaries
- Ensure auditability of all critical actions

### Deliverables
- Control plane hooks
- Kill-switch endpoints
- Audit/event streams
- Tenant and chain policy enforcement
- Hardware trust workflows
- Approval governance paths

### Exit Criteria
- High-risk actions are governable
- Trust boundaries are explicit
- Auditability exists for critical operations

---

## Phase 11 — Shadow and Advanced Cloak Features

**Goal:** Add only advanced anonymity/routing features after correctness is proven.

### Objectives
- Keep advanced stealth optional
- Ensure correctness, observability, and compensation are already stable
- Make privacy/routing controls explicit and policy-gated

### Deliverables
- Advanced routing/privacy controls
- Timing/fingerprint hardening beyond baseline hygiene
- Strict opt-in policies
- Abuse/risk review gates

### Exit Criteria
- Advanced cloak features are not a dependency for correctness
- Privacy features are explicit and controlled
- Abuse/risk review is possible

---

## Phase 12 — Canary Rollout and Production Hardening

**Goal:** Move from narrow trust to broader production use through staged rollout.

### Objectives
- Roll out through canaries and feature flags
- Add rollback playbooks
- Validate readiness before widening scope

### Deliverables
- Canary rollout plan
- Rollback hooks and playbooks
- Post-deploy verification checklist
- Version compatibility checks
- Production-readiness scorecard

### Exit Criteria
- At least one execution slice is stable under observation
- Rollback is tested
- Expansion decisions can be data-driven

---

## Release Rules

- No destructive schema changes before compatibility validation.
- No rename/remove of `chain_id` or `chain_shard` during migration phases.
- No live execution before simulation and policy gates are stable.
- No multileg workflow without explicit compensation semantics.
- No correctness-sensitive shared state without atomic transition logic.
- No broad rollout before telemetry baselines exist.
- No advanced cloak dependency before baseline transport hygiene is already implemented.

---

## Recommended Cursor Build Order

1. Shared types, env/config, chain registry contracts
2. Drizzle schema and additive migrations
3. Workflow engine skeleton
4. Atomic Redis transition layer
5. Account coordination and nonce allocation
6. REST/WebSocket contracts
7. Chain adapter interfaces and provider runtime
8. Scout read-only modules
9. Simulation and policy engine
10. Signing envelope builders
11. Saga and compensation orchestration
12. Limited dispatcher live path
13. Telemetry, testing, rollout hardening

---

## Definition of Done (Per Major Milestone)

A phase is considered done only when all of the following are true:
- Code compiles
- Tests for that phase exist
- Telemetry/events are emitted where relevant
- Docs remain consistent
- Backward compatibility assumptions are documented
- Next phase inputs are clear

---

## Not Included Yet

These are intentionally deferred until the core system is proven:
- Broad multichain live execution
- Wide protocol adapter coverage
- Full advanced stealth stack
- Aggressive optimization before correctness validation
- Non-essential UI polish

---

## Operating Principle

**Foundation first. Correctness before speed. Read before write. Compensation before scale. Flags before rollout.**
