/**
 * @file seed.ts
 * @module @legion/core/db
 * @sentinel Forge (schema custody — initial chain_registry population)
 *
 * Idempotent seed for the chain_registry table.
 * Safe to re-run: rows are inserted if missing, then updated in place from .env.
 *
 * Usage:
 *   pnpm --filter @legion/core run db:seed
 *
 * RPC endpoints are sourced from root .env via config/loader.ts.
 * GATEKEEPER-07: seed logs chain IDs only, never RPC URLs or credentials.
 *
 * References:
 *  - docs/research/drizzle.md §chain_registry
 *  - docs/UNIVERSAL-CHAINS.md §chain_family Enum + Resource/Signing/Finality Matrix
 *  - docs/CHAIN-ADAPTER-CONTRACT.md §3 Chain Identity
 *  - .env.example (RPC endpoint keys)
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { chainRegistry, createDbPool } from './index'
import type { NewChainRegistryRow } from './index'
import { loadConfig } from '../config/loader'

const cfg = loadConfig()

function endpoints(primary: string | null, backup: string): string[] {
  return [primary, backup].filter((value): value is string => Boolean(value && value.trim()))
}

// ─── Seed Entries ─────────────────────────────────────────────────────────────
// Each entry maps to a canonical chain the Legion Engine supports at genesis.
// New chains are added via forward-migration + an additive seed entry here —
// never by modifying or deleting existing rows (UNIVERSAL-CHAINS.md §Migration).
//
// RPC endpoint ordering: index 0 = primary ghost lane, subsequent = failover.
// Dispatcher reads this array in order for automatic failover routing.
// Production values MUST be injected from environment — see root .env.

const GENESIS_CHAINS: NewChainRegistryRow[] = [
  {
    id: 'evm:1',
    family: 'EVM',
    display_name: 'Ethereum Mainnet',
    native_decimals: 18,
    finality_model: 'probabilistic',
    rpc_endpoints: endpoints(cfg.rpc.ethereum.primary, cfg.rpc.ethereum.backup),
    active: true,
  },
  {
    id: 'evm:137',
    family: 'EVM',
    display_name: 'Polygon Mainnet',
    native_decimals: 18,
    finality_model: 'probabilistic',
    rpc_endpoints: endpoints(cfg.rpc.polygon.primary, cfg.rpc.polygon.backup),
    active: true,
  },
  {
    id: 'evm:42161',
    family: 'EVM',
    display_name: 'Arbitrum One',
    native_decimals: 18,
    finality_model: 'instant',
    rpc_endpoints: endpoints(cfg.rpc.arbitrum.primary, cfg.rpc.arbitrum.backup),
    active: true,
  },
  {
    id: 'evm:8453',
    family: 'EVM',
    display_name: 'Base Mainnet',
    native_decimals: 18,
    finality_model: 'instant',
    rpc_endpoints: endpoints(cfg.rpc.base.primary, cfg.rpc.base.backup),
    active: true,
  },
  {
    id: 'evm:10',
    family: 'EVM',
    display_name: 'Optimism Mainnet',
    native_decimals: 18,
    finality_model: 'instant',
    rpc_endpoints: endpoints(cfg.rpc.optimism.primary, cfg.rpc.optimism.backup),
    active: true,
  },
  {
    id: 'svm:101',
    family: 'SVM',
    display_name: 'Solana Mainnet',
    native_decimals: 9,
    finality_model: 'deterministic',
    rpc_endpoints: endpoints(cfg.rpc.solana.primary, cfg.rpc.solana.backup),
    active: true,
  },
  {
    id: 'btc:mainnet',
    family: 'UTXO',
    display_name: 'Bitcoin Mainnet',
    native_decimals: 8,
    finality_model: 'probabilistic',
    rpc_endpoints: [],
    active: true,
  },
  {
    id: 'ltc:mainnet',
    family: 'UTXO',
    display_name: 'Litecoin Mainnet',
    native_decimals: 8,
    finality_model: 'probabilistic',
    rpc_endpoints: [],
    active: true,
  },
  {
    id: 'doge:mainnet',
    family: 'UTXO',
    display_name: 'Dogecoin Mainnet',
    native_decimals: 8,
    finality_model: 'probabilistic',
    rpc_endpoints: [],
    active: true,
  },
]

// ─── Seed Runner ──────────────────────────────────────────────────────────────

async function runSeed(): Promise<void> {
  const databaseUrl = cfg.database.url
  if (!databaseUrl) {
    // Typed error surface consistent with LegionError contract (cannot import
    // LegionError here because seed runs before the full runtime is wired).
    throw new Error(
      '[Forge/Seed] DATABASE_URL is not set. ' +
        'Copy .env.example to .env and configure DATABASE_URL before seeding.',
    )
  }

  const pool = await createDbPool(databaseUrl)
  const db   = drizzle(pool)

  try {
    for (const row of GENESIS_CHAINS) {
      await db
        .insert(chainRegistry)
        .values(row)
        .onConflictDoNothing({ target: chainRegistry.id })

      await db
        .update(chainRegistry)
        .set({
          family:          row.family,
          display_name:    row.display_name,
          native_decimals: row.native_decimals,
          finality_model:  row.finality_model,
          rpc_endpoints:   row.rpc_endpoints,
          active:          row.active,
        })
        .where(eq(chainRegistry.id, row.id))
    }

    // Structured log output (seed is a CLI tool — pino not imported to keep deps minimal).
    process.stdout.write(
      JSON.stringify({
        level: 'info',
        sentinel: 'Forge',
        event: 'chain_registry.seeded',
        chains: GENESIS_CHAINS.map((c) => c.id),
        upserted: GENESIS_CHAINS.length,
        ts: new Date().toISOString(),
      }) + '\n',
    )
  } finally {
    // Always release the pool — seed must not leave dangling connections.
    await pool.end()
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

runSeed().catch((err: unknown) => {
  process.stderr.write(
    JSON.stringify({
      level: 'fatal',
      sentinel: 'Forge',
      event: 'chain_registry.seed_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }) + '\n',
  )
  process.exit(1)
})
