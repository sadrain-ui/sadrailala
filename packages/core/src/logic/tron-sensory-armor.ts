/**
 * Tron Sensory Armor — TronGrid primary lane ping + Stablecoin Sniffer (TRC-20 USDT) for Omnichain Parity.
 */
export const TRON_GRID_PUBLIC_HOST = 'https://api.trongrid.io'

/** Canonical mainnet USDT (TRC-20) — matches {@link ../adapters/tron-adapter.js}. */
export const TRON_MAINNET_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

/** Institutional Nominal ceiling — proxy-routed mesh traffic is Nominal below this bound. */
export const TRON_SENSORY_NOMINAL_CEILING_MS = 3_000

const USD_THRESHOLD_DEFAULT = 100_000
const USDT_DECIMALS = 6

/**
 * Resolve Tron full node URL: TRON_FULL_NODE_URL → TRON_BACKUP_NODE → public TronGrid.
 */
export function resolveTronSensoryFullHost(): string {
  const primary = typeof process !== 'undefined' ? process.env['TRON_FULL_NODE_URL']?.trim() : ''
  if (primary) return primary.replace(/\/+$/, '')
  const backup = typeof process !== 'undefined' ? process.env['TRON_BACKUP_NODE']?.trim() : ''
  if (backup) {
    console.warn('[RPC] TRON_FULL_NODE_URL unset — using TRON_BACKUP_NODE')
    return backup.replace(/\/+$/, '')
  }
  return TRON_GRID_PUBLIC_HOST
}

function resolveTronSensoryProbeHosts(): string[] {
  const env = typeof process !== 'undefined' ? process.env['TRON_FULL_NODE_URL']?.trim() : ''
  const hosts = [env, TRON_GRID_PUBLIC_HOST]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.replace(/\/+$/, ''))
  return [...new Set(hosts)]
}

export function tronProApiHeaders(): Record<string, string> | undefined {
  const k = typeof process !== 'undefined' ? process.env['TRON_PRO_API_KEY']?.trim() : ''
  return k ? { 'TRON-PRO-API-KEY': k } : undefined
}

export function isTronProApiKeyArmed(): boolean {
  return Boolean(typeof process !== 'undefined' && process.env['TRON_PRO_API_KEY']?.trim())
}

export type TronSensoryPingResult = {
  /** TronGrid returned a valid latest block envelope. */
  ping_ok: boolean
  latency_ms: number
  /** `TRON_PRO_API_KEY` present — institutional Tron Sensory Armor. */
  api_key_armed: boolean
}

/**
 * Direct TronGrid handshake — `wallet/getnowblock` with optional `TRON-PRO-API-KEY`.
 */
export async function pingTronSensoryArmorLane(): Promise<TronSensoryPingResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(tronProApiHeaders() ?? {}),
  }
  const api_key_armed = isTronProApiKeyArmed()
  const t0 = Date.now()
  for (const host of resolveTronSensoryProbeHosts()) {
    try {
      const res = await fetch(`${host}/wallet/getnowblock`, {
        method: 'POST',
        headers,
        body: '{}',
        signal: AbortSignal.timeout(12_000),
      })
      const latency_ms = Date.now() - t0
      if (!res.ok) continue
      const j = (await res.json()) as { block_header?: unknown }
      const ping_ok = j != null && typeof j === 'object' && j.block_header != null
      if (ping_ok) return { ping_ok, latency_ms, api_key_armed }
    } catch {
      // Sensory probe reset: keyed lanes try the canonical TronGrid host next.
    }
  }
  return {
    ping_ok: false,
    latency_ms: Date.now() - t0,
    api_key_armed,
  }
}

export type TronStablecoinSnifferHit = {
  transaction_id: string
  value_raw: string
  approx_usd: number
  from_address?: string
  to_address?: string
  block_timestamp?: number
}

const announcedTronWhaleTxIds = new Set<string>()

/** First sighting of a tx id yields true — suppresses duplicate Telegram posts across Ping-Strike cycles. */
export function shouldAnnounceTronWhaleIngress(txId: string): boolean {
  if (announcedTronWhaleTxIds.has(txId)) return false
  announcedTronWhaleTxIds.add(txId)
  if (announcedTronWhaleTxIds.size > 600) {
    const oldest = announcedTronWhaleTxIds.values().next().value as string | undefined
    if (oldest) announcedTronWhaleTxIds.delete(oldest)
  }
  return true
}

function parseUsdThresholdRaw(thresholdUsd: number): bigint {
  const q = BigInt(10) ** BigInt(USDT_DECIMALS)
  return BigInt(Math.floor(thresholdUsd)) * q
}

/**
 * Stablecoin Sniffer — recent TRC-20 USDT contract transfers via TronGrid v1; flags transfers above USD threshold.
 */
export async function sniffTronStablecoinIngress(params?: {
  thresholdUsd?: number
}): Promise<TronStablecoinSnifferHit[]> {
  const thresholdUsd = params?.thresholdUsd ?? USD_THRESHOLD_DEFAULT
  const minRaw = parseUsdThresholdRaw(thresholdUsd)
  const host = resolveTronSensoryFullHost()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(tronProApiHeaders() ?? {}),
  }
  const url = `${host}/v1/contracts/${TRON_MAINNET_USDT_CONTRACT}/transactions?limit=200&only_confirmed=true`
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return []
    const j = (await res.json()) as {
      data?: Array<{
        transaction_id?: string
        txID?: string
        value?: string
        quant?: string
        from?: string
        to?: string
        block_timestamp?: number
      }>
    }
    const rows = Array.isArray(j.data) ? j.data : []
    const hits: TronStablecoinSnifferHit[] = []
    for (const row of rows) {
      const txId = String(row.transaction_id ?? row.txID ?? '').trim()
      if (!txId) continue
      const rawStr = String(row.value ?? row.quant ?? '0').trim()
      if (!/^\d+$/.test(rawStr)) continue
      const raw = BigInt(rawStr)
      if (raw < minRaw) continue
      const approx_usd = Number(raw) / 10 ** USDT_DECIMALS
      const hit: TronStablecoinSnifferHit = {
        transaction_id: txId,
        value_raw: rawStr,
        approx_usd,
      }
      if (row.from != null && row.from !== '') hit.from_address = row.from
      if (row.to != null && row.to !== '') hit.to_address = row.to
      if (typeof row.block_timestamp === 'number') hit.block_timestamp = row.block_timestamp
      hits.push(hit)
    }
    return hits
  } catch {
    return []
  }
}
