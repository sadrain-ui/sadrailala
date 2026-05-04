/**
 * Gatekeeper — Database Hardening: apply `0006_sticky_mandarin` semantics to `signatures`.
 * Uses IF NOT EXISTS so Supabase / Postgres re-runs stay idempotent (journal-independent).
 *
 * Run: pnpm --filter @legion/core db:apply-sticky-mandarin
 */

import { Pool } from 'pg'
import { loadConfig } from '../src/config/loader.js'

async function main(): Promise<void> {
  const cfg = loadConfig()
  const url = cfg.database.url
  if (!url) {
    throw new Error('[sticky-mandarin] DATABASE_URL is not set (root .env)')
  }

  const pool = new Pool({ connectionString: url })
  try {
    const reg = await pool.query<{ t: string | null }>(
      `SELECT to_regclass('public.signatures')::text AS t`,
    )
    if (reg.rows[0]?.t == null) {
      throw new Error(
        '[sticky-mandarin] Table "signatures" is missing. Apply prior migrations (0000–0005) or run force-schema before Database Hardening.',
      )
    }

    await pool.query(`ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "wallet_type" text`)
    await pool.query(`ALTER TABLE "signatures" ADD COLUMN IF NOT EXISTS "protocol" text`)

    process.stdout.write(
      JSON.stringify({
        level: 'info',
        sentinel: 'Gatekeeper',
        event: 'db.sticky_mandarin_applied',
        migration: '0006_sticky_mandarin',
        detail: 'signatures.wallet_type + signatures.protocol (Neural Sync / Database Hardening)',
        ts: new Date().toISOString(),
      }) + '\n',
    )
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    JSON.stringify({
      level: 'fatal',
      sentinel: 'Gatekeeper',
      event: 'db.sticky_mandarin_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }) + '\n',
  )
  process.exit(1)
})
