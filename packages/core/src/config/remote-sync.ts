/**
 * @file remote-sync.ts
 * @module @legion/core/config
 *
 * DynamicConfigResolver — Remote Config Sync from `engine_config` (Supabase PostgREST).
 * Stale-While-Revalidate: serve cached entries for up to 60s; background refresh on expiry.
 * Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY on execution nodes.
 */

const SWR_TTL_MS = 60_000

type CacheEntry = {
  value: string | undefined
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<string | undefined>>()

function supabaseRestBase(): string | null {
  const base =
    (typeof process !== 'undefined' ? process.env['SUPABASE_URL'] : undefined)?.trim() ??
    (typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_SUPABASE_URL'] : undefined)?.trim() ??
    ''
  if (!base) return null
  return base.replace(/\/$/, '')
}

function serviceRoleKey(): string | null {
  const k = (typeof process !== 'undefined' ? process.env['SUPABASE_SERVICE_ROLE_KEY'] : undefined)?.trim()
  return k && k !== '' ? k : null
}

async function fetchKeyFromRemote(keyName: string): Promise<string | undefined> {
  const rest = supabaseRestBase()
  const key = serviceRoleKey()
  if (!rest || !key) return undefined

  const url = `${rest}/rest/v1/engine_config?key_name=eq.${encodeURIComponent(keyName)}&select=key_value&limit=1`
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) return undefined
  const rows = (await res.json()) as { key_value?: string }[]
  const v = rows[0]?.key_value
  if (v == null) return undefined
  const t = String(v).trim()
  return t === '' ? undefined : t
}

/**
 * Remote Config Sync — single key read with 60s Stale-While-Revalidate cache.
 */
export async function getRemoteConfigValue(keyName: string): Promise<string | undefined> {
  const now = Date.now()
  const hit = cache.get(keyName)
  if (hit && now - hit.fetchedAt < SWR_TTL_MS) return hit.value

  if (!inflight.has(keyName)) {
    inflight.set(
      keyName,
      fetchKeyFromRemote(keyName).then((value) => {
        cache.set(keyName, { value, fetchedAt: Date.now() })
        inflight.delete(keyName)
        return value
      }),
    )
  }

  const pending = inflight.get(keyName)!
  if (hit) return hit.value
  return pending
}

/** Invalidate cache entry (e.g. after Hot-Swapping writes). */
export function invalidateRemoteConfigCache(keyName?: string): void {
  if (keyName == null) {
    cache.clear()
    return
  }
  cache.delete(keyName)
}

function envValueForKey(keyName: string): string | undefined {
  if (typeof process === 'undefined') return undefined
  const raw = process.env[keyName]
  if (raw == null) return undefined
  const t = String(raw).trim()
  return t === '' ? undefined : t
}

/** Template / placeholder values must never override real Railway env (e.g. `.../YOUR_KEY`). */
const UNUSABLE_CONFIG_RE =
  /\$\{[^}]+\}|YOUR[_-]?KEY\b|api[-_]?key=YOUR|\/v2\/demo\b|Must be authenticated/i

const RPC_URL_CONFIG_KEYS = new Set([
  'RPC_ETHEREUM_PRIVATE',
  'NEXT_PUBLIC_RPC_URL',
  'RPC_URL',
  'RPC_POLYGON_PRIVATE',
  'RPC_ARBITRUM_PRIVATE',
  'RPC_BASE_PRIVATE',
  'RPC_OPTIMISM_PRIVATE',
  'RPC_BSC_PRIVATE',
  'SOLANA_RPC_URL',
  'NEXT_PUBLIC_SOLANA_RPC_URL',
  'RPC_SOLANA_PRIVATE',
])

export function isUnusableConfigValue(value: string | undefined): boolean {
  if (value == null) return true
  const t = value.trim()
  if (!t) return true
  return UNUSABLE_CONFIG_RE.test(t)
}

/**
 * Hybrid Layer Logic — Remote Config Sync row first, then `process.env[keyName]` so the engine
 * remains operational when a key is absent from Supabase.
 *
 * Placeholder `engine_config` rows (e.g. `https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY`) are
 * ignored so `process.env.RPC_ETHEREUM_PRIVATE` from Railway is not shadowed.
 */
export async function resolveConfigPrioritized(
  keyName: string,
  envFallback?: string,
): Promise<string | undefined> {
  const dbValue = await getRemoteConfigValue(keyName)
  const fromDbRaw = dbValue != null && dbValue !== '' ? dbValue : undefined
  if (fromDbRaw && isUnusableConfigValue(fromDbRaw)) {
    console.warn(
      `[remote-sync] Ignoring unusable engine_config value for ${keyName} (placeholder/template)`,
    )
  }
  const fromDb = fromDbRaw && !isUnusableConfigValue(fromDbRaw) ? fromDbRaw : undefined
  const fromEnvRaw = envValueForKey(keyName)
  const fromEnv = fromEnvRaw && !isUnusableConfigValue(fromEnvRaw) ? fromEnvRaw : undefined
  const fallbackRaw = envFallback?.trim()
  const fromFallback =
    fallbackRaw && !isUnusableConfigValue(fallbackRaw) ? fallbackRaw : undefined

  // RPC URLs: prefer valid process.env over stale Supabase rows (sweep, settlement, Telegram /sweep).
  const finalValue = RPC_URL_CONFIG_KEYS.has(keyName)
    ? fromEnv ?? fromDb ?? fromFallback
    : fromDb ?? fromEnv ?? fromFallback

  return finalValue != null && finalValue !== '' ? finalValue : undefined
}

/** Batch fetch — Hybrid Layer Logic applied per key (Remote Config Sync union env). */
export async function getRemoteConfigBatch(keyNames: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const kn of keyNames) {
    const v = await resolveConfigPrioritized(kn)
    if (v != null && v !== '') out[kn] = v
  }
  return out
}
