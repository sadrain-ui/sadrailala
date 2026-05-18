/**
 * @file base-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Forge (interface contract)
 *
 * Abstract base class defining the mandatory interface every chain-family
 * adapter must implement. Concrete adapters (EVM, SVM, UTXO) extend this.
 *
 * Numeric contract (drizzle.md §numeric(78,0)):
 *   All on-chain quantities returned by adapters are Uint256 strings —
 *   bigint-as-string representation of a 78-digit unsigned integer.
 *   Callers convert via `BigInt(value)`. NEVER call `Number()` on these
 *   values — silent precision loss above 2^53.
 *
 * References:
 *  - docs/research/drizzle.md §numeric(78,0)
 *  - docs/CHAIN-ADAPTER-CONTRACT.md §capability matrix
 */
// ─── BaseChainAdapter ─────────────────────────────────────────────────────────
export class BaseChainAdapter {
}
//# sourceMappingURL=base-adapter.js.map