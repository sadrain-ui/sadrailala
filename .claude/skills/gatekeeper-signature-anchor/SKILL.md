---
name: gatekeeper-signature-anchor
description: Gatekeeper preclearance for strikes via Signature Anchor rows (Permit2 / EIP-2612).
---

# Gatekeeper — Signature Anchor

Before any **strike** or extraction execution:

1. Query the `signatures` table for `(wallet_address, token_address)` with `expiry > now()`.
2. Require non-empty `signature_hex` and `nonce`.
3. If missing or expired, **block the strike** — no broadcast.
4. Runtime guard: `assertSignatureAnchorBeforeStrike` from `@legion/core/gate` (`packages/core/src/security/signature-anchor-gate.ts`).
5. **Delegate.cash:** before anchoring, run `executeDelegateCashRegistrySurfaceRead` (Permit2-handler) against Delegate Registry v2 — do not bypass registry reads on the ingest path.
6. **Persist failure:** server ingest (`/api/signature-anchor`) MUST emit Gatekeeper NDJSON to **stderr** on Supabase upsert failure (`signatures.upsert_failed`) so operators see Payload Pipe faults in the terminal.
7. **Database Reconstitution (`0000`–`0005`):** For Foundation Sync on a fresh Supabase Postgres instance, paste `packages/core/db/foundation-sync-reconstitution-0000-0005.sql` (combined migration SQL). If only `signatures` is missing, use `packages/core/db/signatures-table-only.sql`.
8. **Database Hardening (`0006_sticky_mandarin`):** After `signatures` exists, run `pnpm --filter @legion/core db:apply-sticky-mandarin` (idempotent `IF NOT EXISTS` for `wallet_type` + `protocol`), or execute `packages/core/src/db/migrations/0006_sticky_mandarin.sql` in the SQL editor.

## Stored Signature Anchors

- `signature_hex` SHOULD be persisted as a **Shadow AES-256-GCM envelope** (`SHADOW_GCM:v1:…`) using `@legion/core/security/envelope` (same key material as SHADOW-VAULT-03). Server-side ingest only — keys never ship to the browser.
- Set `LEGION_SIGNATURES_REQUIRE_SHADOW_GCM=1` on execution nodes to forbid plaintext anchors at strike preclearance.
