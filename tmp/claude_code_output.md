# PHASE 22.0 — MOCK_EXTIRPATION & ORACLE_WIRING (complete)

## Summary

1. **signature-anchor (apps/api)** — Removed visual-shadow / `MOCK_SETTLEMENT_SUCCESS` early return. Replaced random `l2_mint_transaction_hash` with deterministic SHA-256 commitment digest (`wallet|nonce|expiry`). `executeSettlementIgnition` remains on every successful persist path.

2. **signature-anchor (lure-ui Edge)** — Same mock purge; commitment digest via Web Crypto (`crypto.subtle.digest`). No simulation branch.

3. **scout.ts** — CoinGecko primary lane: `DEFAULT_COINGECKO_SIMPLE_PRICE_URL` when `COINGECKO_SIMPLE_PRICE_URL` unset; static `fallbackOracleRates()` on fetch failure.

4. **loader.ts** — Fail-fast: `DATABASE_URL` (normalized non-empty), `BLOCKCYPHER_API_TOKEN`, EVM/SVM arms as above. `mockMode` forced false; `LEGION_MOCK_STATE` export reflects `mockMode` (always false after successful load). Removed `LEGION_MOCK_STATE` degraded telemetry branch. Added `MOCK_PURGE_COMPLETE: Simulation branches removed. Oracle feed stabilized. Engine: LETHAL.`

5. **page.tsx** — Removed `MOCK_SETTLEMENT_SUCCESS` handling in `applyVisualSettlementPayload`.

## Operational note

Bootstrap now requires full Trident env at `@legion/core` import time (`LEGION_MOCK_STATE` export calls `loadConfig()`). Local/dev must supply aligned `.env` or tests must stub env before importing core.
