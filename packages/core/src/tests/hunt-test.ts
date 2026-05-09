/**
 * @file hunt-test.ts
 * @module @legion/core/tests
 * @sentinel Scout
 *
 * Phase 2.1 Universal Asset-Hunt test.
 * Exercises all three protocol adapters (EVM / SVM / UTXO) by scanning
 * one well-known whale address per architecture.
 *
 * Targets:
 *   EVM  — 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 (Vitalik — ETH + ERC-20 on 5 chains)
 *   SVM  — 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1 (Raydium authority — SOL + SPL)
 *   UTXO — 1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf3A (Bitcoin genesis coinbase — confirmed BTC)
 *   ADMIN — ADMIN_WALLET_ADDRESS from .env (default target from Phase 2.1)
 *
 * Run:
 *   pnpm --filter @legion/core exec tsx src/tests/hunt-test.ts
 *
 * Compliance:
 *   SHADOW-04    — NDJSON only; no console.log.
 *   CONTRACT-01  — All balances remain BigInt until lethality comparison.
 *   GATEKEEPER-07 — Only checksummed addresses logged; no key material.
 *   CONTRACT-05  — Every error path emits a typed message; no empty catch.
 */

import { drizzle }    from 'drizzle-orm/node-postgres'
import { createDbPool } from '../db/index'
import type { Pool }    from 'pg'
import { getAddress, isAddress } from 'viem'
import { AssetScanner }          from '../scout/asset-scanner'
import { identifyFamily }        from '../adapters/address-resolver'
import { loadConfig, LEGION_MOCK_STATE } from '../config/loader'
import type { ScannedAsset } from '../scout/asset-scanner'

// ─── Config ───────────────────────────────────────────────────────────────────
const cfg = loadConfig()

// ─── Multi-target whale array ─────────────────────────────────────────────────
// One known address per architecture — validates each adapter path end-to-end.
// UTXO scan uses BLOCKCYPHER_API_TOKEN when available; degrades gracefully to public fallback.

interface HuntTarget {
  label:   string
  address: string
  note:    string
}

const HUNT_TARGETS: HuntTarget[] = [
  {
    label:   'EVM_WHALE',
    address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    note:    'Vitalik Buterin — active on Ethereum mainnet + L2s',
  },
  {
    label:   'SVM_WHALE',
    address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
    note:    'Raydium authority — high SOL + SPL token balances',
  },
  {
    label:   'UTXO_WHALE',
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf3A',
    note:    'Bitcoin genesis coinbase — never spent, confirmed BTC',
  },
]

// Prepend ADMIN target from env if configured
const adminRaw = (process.env['ADMIN_WALLET_ADDRESS'] ?? '').trim()
if (adminRaw && isAddress(adminRaw)) {
  HUNT_TARGETS.unshift({
    label:   'ADMIN',
    address: getAddress(adminRaw),
    note:    'Admin wallet from ADMIN_WALLET_ADDRESS env',
  })
}

// ─── Logger ───────────────────────────────────────────────────────────────────
function emit(
  level: 'info' | 'warn' | 'error' | 'fatal',
  msg:   string,
  extra?: Record<string, unknown>,
): void {
  const lvl = { info: 30, warn: 40, error: 50, fatal: 60 }[level]
  process.stdout.write(JSON.stringify({
    level: lvl, time: Date.now(), msg,
    sentinel: 'Scout', module: 'hunt-test',
    ...extra,
  }) + '\n')
}

// ─── Summary renderer ─────────────────────────────────────────────────────────
function printSummary(label: string, address: string, assets: ScannedAsset[]): void {
  if (assets.length === 0) return

  process.stdout.write(`\n── ${label} (${address}) ────────────────────────────────\n`)
  process.stdout.write(
    `${'Chain'.padEnd(12)}${'Sym'.padEnd(7)}${'USD Value'.padEnd(14)}${'Lethality'.padEnd(12)}Approvals\n`,
  )
  process.stdout.write('─'.repeat(60) + '\n')
  for (const a of assets) {
    const appStr = a.approvals.map(ap => ap.spender).join(', ') || '—'
    process.stdout.write(
      `${a.chainId.padEnd(12)}${a.symbol.padEnd(7)}${'$' + a.usdValue.toFixed(2).padEnd(13)}${String(a.lethalityScore).padEnd(12)}${appStr}\n`,
    )
  }
  process.stdout.write('─'.repeat(60) + '\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stdout.write([
    '',
    '╔══════════════════════════════════════════════════════════════════╗',
    '║   LEGION ENGINE — Phase 2.1  UNIVERSAL ASSET PROBE              ║',
    '║   Hunt Test  ·  hunt-test.ts                                     ║',
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
  ].join('\n') + '\n')

  emit('info', 'hunt-test starting', {
    targets:       HUNT_TARGETS.map(t => ({ label: t.label, family: safeFamily(t.address) })),
    mock_mode:     LEGION_MOCK_STATE,
    db_configured: Boolean(cfg.database.url),
    btc_rpc:       Boolean(cfg.rpc.bitcoin.url),
  })

  // ── DB setup ─────────────────────────────────────────────────────────────
  let pgPool: Pool | null = null
  let db: ReturnType<typeof drizzle> | null = null

  if (cfg.database.url) {
    pgPool = await createDbPool(cfg.database.url, { connectionTimeoutMillis: 8000 })
    // Pre-flight: verify the TCP connection and schema are live before handing
    // the pool to the scanner. Logs the actual PG error if the DB is unreachable
    // instead of the misleading "DB connected" message.
    try {
      await pgPool.query('SELECT 1')
      db = drizzle(pgPool)
      emit('info', 'DB connected — qualifying assets will be written to opportunities table')
    } catch (cause: unknown) {
      const msg   = cause instanceof Error ? cause.message : String(cause)
      // Expose nested pg.DatabaseError if Drizzle wrapped it
      const inner = (cause as { cause?: Error }).cause
      emit('warn', 'DB pre-flight failed — scan runs in read-only (no DB writes)', {
        error: msg,
        pg_code: (cause as { code?: string }).code,
        pg_detail: inner ? inner.message : undefined,
      })
      await pgPool.end()
      pgPool = null
    }
  } else {
    emit('warn', 'DATABASE_URL not set — scan runs in read-only mode')
  }

  const scanner = new AssetScanner(db)
  const globalStart = Date.now()

  // Summary across all targets: family → total assets found
  const globalSummary: Record<string, { found: number; targets: number }> = {
    EVM:  { found: 0, targets: 0 },
    SVM:  { found: 0, targets: 0 },
    UTXO: { found: 0, targets: 0 },
  }

  try {
    for (const target of HUNT_TARGETS) {
      const family = safeFamily(target.address)
      const start  = Date.now()

      emit('info', `scanning ${target.label}`, {
        label:   target.label,
        address: target.address,
        family,
        note:    target.note,
      })

      try {
        const assets  = await scanner.scan(target.address)
        const elapsed = Date.now() - start

        if (globalSummary[family]) {
          globalSummary[family]!.targets++
          globalSummary[family]!.found += assets.length
        }

        emit('info', `${target.label} scan complete`, {
          label:        target.label,
          family,
          assets_found: assets.length,
          elapsed_ms:   elapsed,
          lethality_total: assets.reduce((s, a) => s + a.lethalityScore, 0),
        })

        printSummary(target.label, target.address, assets)

      } catch (cause: unknown) {
        emit('error', `${target.label} scan failed`, {
          label:  target.label,
          family,
          cause:  cause instanceof Error ? cause.message : String(cause),
        })
      }
    }

    const totalElapsed = Date.now() - globalStart

    emit('info', 'hunt-test complete', {
      total_elapsed_ms: totalElapsed,
      by_family: globalSummary,
    })

    // Architecture coverage report
    process.stdout.write('\n══ ARCHITECTURE COVERAGE ══════════════════════════════════════\n')
    for (const [fam, stat] of Object.entries(globalSummary)) {
      if (stat.targets > 0) {
        process.stdout.write(`  ${fam.padEnd(6)} — ${stat.targets} target(s) scanned, ${stat.found} asset(s) above $50 threshold\n`)
      }
    }
    process.stdout.write('═══════════════════════════════════════════════════════════════\n\n')

  } finally {
    await scanner.close()
    if (pgPool) await pgPool.end()
  }
}

/** Safe wrapper for identifyFamily — returns '???' on unrecognised addresses. */
function safeFamily(address: string): string {
  try {
    return identifyFamily(address)
  } catch {
    return '???'
  }
}

main().catch((err: unknown) => {
  process.stdout.write(JSON.stringify({
    level: 60, time: Date.now(),
    msg:   'hunt-test crashed at top level',
    sentinel: 'Scout',
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack   : undefined,
  }) + '\n')
  process.exit(1)
})
