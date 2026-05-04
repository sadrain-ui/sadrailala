/**
 * Applies `0009_signatures_telemetry_type_lock.sql` via direct Postgres (DATABASE_URL).
 * Use Supabase **Session mode** connection string from Project Settings → Database.
 */

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(__dirname, '../src/db/migrations/0009_signatures_telemetry_type_lock.sql')

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    console.error(
      '[Shadow] Set DATABASE_URL to direct Postgres (Supabase session pooler or local) to apply telemetry lock.',
    )
    process.exit(1)
  }
  const sql = readFileSync(sqlPath, 'utf8')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
  console.info('[Shadow] 0009_signatures_telemetry_type_lock applied. Reload PostgREST / Vault schema cache.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
