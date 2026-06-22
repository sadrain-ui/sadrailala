// @ts-nocheck
/**
 * @file address-resolver.ts
 * @module @legion/core/adapters
 * @sentinel Gatekeeper (address identity enforcement)
 *
 * Identifies the chain family of a raw address string and resolves it to
 * candidate chain_ids in chain_registry. The only allowed entry point for
 * any cross-chain address interaction — unidentified addresses NEVER reach
 * the strike pipeline (Gatekeeper kill-switch, RULE-00-B).
 *
 * References:
 *  - docs/skills/43-viem-core-standard.md  — EVM address model (0x hex, 20 bytes)
 *  - docs/research/solana.md §account model — Ed25519 public key, base58, 32 bytes
 *  - docs/research/bitcoin.md §address formats — P2PKH / P2SH / Bech32
 *  - docs/UNIVERSAL-CHAINS.md §chain_family   — EVM | SVM | UTXO taxonomy
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ChainFamily } from '../db/schema';
export declare class GatekeeperError extends Error {
    readonly code: "GATEKEEPER_UNIDENTIFIED_ADDRESS";
    readonly address: string;
    constructor(address: string);
}
/**
 * Determines the chain family of a raw address string by structural pattern.
 *
 * Does NOT make any network call — purely regex-based, synchronous, and safe
 * to call in hot-path sentinel code.
 *
 * @param address - Raw address string in any supported format.
 * @returns 'EVM' | 'SVM' | 'UTXO'
 * @throws {GatekeeperError} Address format unrecognised — strike must be blocked.
 */
export declare function identifyFamily(address: string): Extract<ChainFamily, 'EVM' | 'SVM' | 'UTXO'>;
/**
 * Returns all **active** chain_ids in chain_registry whose family matches the
 * identified family of `address`.
 *
 * An address string alone cannot identify the *specific* chain — the same EVM
 * address exists on Ethereum, Polygon, Arbitrum, Base, etc. This function
 * returns the full candidate set; callers filter by business context (e.g. the
 * chain_id stored on the opportunity row).
 *
 * @param db      - Drizzle node-postgres DB instance (from `drizzle(pool)`).
 * @param address - Raw address string in any supported format.
 * @returns Array of CAIP-2 chain_id strings, e.g. `["evm:1", "evm:137"]`.
 * @throws {GatekeeperError} Propagated from identifyFamily if format unknown.
 */
export declare function resolveChain(db: NodePgDatabase, address: string): Promise<string[]>;
//# sourceMappingURL=address-resolver.d.ts.map