/**
 * Database Anchor — native pg connection parsing for Host Resolution.
 */
import { Pool, type PoolConfig } from 'pg'

/**
 * Host Resolution path for DATABASE_URL.
 * Keeps the raw URL intact so `pg` performs authoritative parsing.
 */
export function resolveDatabaseAnchorConnectionString(raw: string): string {
  let s = raw.trim()
  while (s.toUpperCase().startsWith('DATABASE_URL=')) {
    s = s.slice('DATABASE_URL='.length).trim()
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

/** Telemetry helper only; does not affect actual `pg` parsing. */
export function resolveDatabaseAnchorHost(raw: string): string {
  const s = resolveDatabaseAnchorConnectionString(raw)
  if (!s) return '(unset)'
  try {
    const u = new URL(s)
    if (u.hostname && u.hostname.toLowerCase() !== 'base') return u.hostname
  } catch {
    // Preserve native pg parsing path below.
  }
  return '(unresolved)'
}

export function createDatabaseAnchorPool(
  rawConnectionString: string,
  overrides: Omit<PoolConfig, 'connectionString'> = {},
): Pool {
  return new Pool({
    connectionString: resolveDatabaseAnchorConnectionString(rawConnectionString),
    ...overrides,
  })
}
