/**
 * Live USD price oracle — CoinGecko simple price API + Redis cache.
 *
 * Env:
 *   USE_PRICE_ORACLE=true          — enable cron + Redis cache (default: true)
 *   REDIS_URL                      — required when oracle enabled in production
 *   PRICE_ORACLE_CRON              — cron expression (default: every 5 minutes)
 *   COINGECKO_SIMPLE_PRICE_URL     — optional API override
 *   FALLBACK_{ETH,SOL,TON,TRX,BTC}_PRICE_USD — static fallback when oracle/redis/API unavailable
 */
import cron from 'node-cron'
import IoRedis from 'ioredis'

import {
  createResilientRedisClient,
  resolveEffectiveRedisUrl,
  type RedisPingClient,
} from './lib/redis-wrapper.js'

type PriceOracleRedisClient = RedisPingClient & {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>
  pipeline(): {
    set(key: string, value: string, mode: 'EX', ttl: number): void
    exec(): Promise<unknown>
  }
}

const RedisCtor = IoRedis as unknown as new (
  url: string,
  options?: Record<string, unknown>,
) => PriceOracleRedisClient

export const PRICE_ORACLE_COINS = [
  'ethereum',
  'solana',
  'the-open-network',
  'tron',
  'bitcoin',
] as const

export type PriceOracleCoinId = (typeof PRICE_ORACLE_COINS)[number]

const DEFAULT_COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,the-open-network,tron&vs_currencies=usd'

const DEFAULT_CRON = '*/5 * * * *'
const REDIS_KEY_PREFIX = 'price:'
const REDIS_TTL_SEC = 600

type TelegramNotifier = (text: string) => Promise<void>

let cronTask: cron.ScheduledTask | null = null
let redisClient: PriceOracleRedisClient | null = null
let telegramNotifier: TelegramNotifier | null = null
let inFlightFetch: Promise<void> | null = null

function readEnv(key: string): string | undefined {
  if (typeof process === 'undefined') return undefined
  const raw = process.env[key]?.trim()
  return raw || undefined
}

function isTruthyEnv(key: string, defaultValue = true): boolean {
  const raw = readEnv(key)
  if (raw == null) return defaultValue
  const v = raw.toLowerCase()
  if (v === 'false' || v === '0' || v === 'no') return false
  if (v === 'true' || v === '1' || v === 'yes') return true
  return defaultValue
}

/** When false, cron is skipped and consumers use FALLBACK_* env only. */
export function isPriceOracleEnabled(): boolean {
  return isTruthyEnv('USE_PRICE_ORACLE', true)
}

export function registerPriceOracleTelegramLogger(notify: TelegramNotifier): void {
  telegramNotifier = notify
}

function redisKey(coinId: string): string {
  return `${REDIS_KEY_PREFIX}${coinId.trim().toLowerCase()}`
}

function resolveCoingeckoUrl(coinIds?: string[]): string {
  const override = readEnv('COINGECKO_SIMPLE_PRICE_URL')
  if (override) return override
  if (coinIds && coinIds.length > 0) {
    const ids = coinIds.map((id) => encodeURIComponent(id)).join(',')
    return `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
  }
  return DEFAULT_COINGECKO_URL
}

function parseFallbackUsd(envKey: string, defaultUsd: number): number {
  const raw = readEnv(envKey)
  if (!raw) return defaultUsd
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : defaultUsd
}

const FALLBACK_BY_COIN: Record<string, { env: string; defaultUsd: number }> = {
  ethereum: { env: 'FALLBACK_ETH_PRICE_USD', defaultUsd: 3000 },
  solana: { env: 'FALLBACK_SOL_PRICE_USD', defaultUsd: 150 },
  'the-open-network': { env: 'FALLBACK_TON_PRICE_USD', defaultUsd: 5 },
  tron: { env: 'FALLBACK_TRX_PRICE_USD', defaultUsd: 0.1 },
  bitcoin: { env: 'FALLBACK_BTC_PRICE_USD', defaultUsd: 65_000 },
}

/** @deprecated Static ETH_PRICE_USD etc. — use getPrice() instead. */
export const LEGACY_PRICE_ENV_TO_COIN: Record<string, PriceOracleCoinId | 'bitcoin'> = {
  ETH_PRICE_USD: 'ethereum',
  SOL_PRICE_USD: 'solana',
  TON_PRICE_USD: 'the-open-network',
  TRX_PRICE_USD: 'tron',
  BTC_PRICE_USD: 'bitcoin',
}

async function notifyOracleError(message: string): Promise<void> {
  console.warn(`[PRICE_ORACLE] ${message}`)
  if (telegramNotifier) {
    try {
      await telegramNotifier(`⚠️ <b>Price oracle</b>\n${message}`)
    } catch {
      /* non-fatal */
    }
  }
}

async function getRedisClient(): Promise<PriceOracleRedisClient | null> {
  if (redisClient) return redisClient
  const url = resolveEffectiveRedisUrl()
  if (!url) return null
  try {
    redisClient = createResilientRedisClient(RedisCtor, url)
    await redisClient.connect()
    return redisClient
  } catch (e) {
    await notifyOracleError(
      `Redis connect failed: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

async function storePrices(prices: Record<string, number>): Promise<void> {
  const client = await getRedisClient()
  if (!client) return
  const pipeline = client.pipeline()
  for (const [coinId, usd] of Object.entries(prices)) {
    if (Number.isFinite(usd) && usd > 0) {
      pipeline.set(redisKey(coinId), String(usd), 'EX', REDIS_TTL_SEC)
    }
  }
  await pipeline.exec()
}

async function fetchPricesFromApi(coinIds?: string[]): Promise<Record<string, number>> {
  const url = resolveCoingeckoUrl(coinIds)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    throw new Error(`CoinGecko HTTP ${response.status}`)
  }
  const data = (await response.json()) as Record<string, { usd?: number }>
  const out: Record<string, number> = {}
  for (const [id, row] of Object.entries(data)) {
    const usd = row?.usd
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
      out[id] = usd
    }
  }
  return out
}

async function refreshTrackedPrices(): Promise<void> {
  if (inFlightFetch) {
    await inFlightFetch
    return
  }
  inFlightFetch = (async () => {
    try {
      const prices = await fetchPricesFromApi([...PRICE_ORACLE_COINS])
      if (Object.keys(prices).length === 0) {
        await notifyOracleError('CoinGecko returned no usable USD prices')
        return
      }
      await storePrices(prices)
      console.info(
        `[PRICE_ORACLE] Updated ${Object.keys(prices).length} prices: ${Object.entries(prices)
          .map(([k, v]) => `${k}=$${v}`)
          .join(', ')}`,
      )
    } catch (e) {
      await notifyOracleError(
        `Fetch failed (existing Redis prices retained): ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      inFlightFetch = null
    }
  })()
  await inFlightFetch
}

/**
 * Read USD price from Redis; on cache miss optionally fetch once from CoinGecko.
 * Returns null when unavailable (callers should use getPriceWithFallback).
 */
export async function getPrice(coinId: string): Promise<number | null> {
  const id = coinId.trim().toLowerCase()
  if (!id) return null

  if (!isPriceOracleEnabled()) {
    const fb = FALLBACK_BY_COIN[id]
    return fb ? parseFallbackUsd(fb.env, fb.defaultUsd) : null
  }

  const client = await getRedisClient()
  if (client) {
    try {
      const cached = await client.get(redisKey(id))
      if (cached) {
        const n = Number.parseFloat(cached)
        if (Number.isFinite(n) && n > 0) return n
      }
    } catch (e) {
      console.warn('[PRICE_ORACLE] Redis read failed:', e instanceof Error ? e.message : String(e))
    }
  }

  try {
    const fetched = await fetchPricesFromApi([id])
    const usd = fetched[id]
    if (usd != null && usd > 0) {
      await storePrices({ [id]: usd })
      return usd
    }
  } catch (e) {
    console.warn('[PRICE_ORACLE] On-demand fetch failed:', e instanceof Error ? e.message : String(e))
  }

  return null
}

/** Resolve price with FALLBACK_* env and hardcoded default. */
export async function getPriceWithFallback(coinId: string, defaultUsd?: number): Promise<number> {
  const id = coinId.trim().toLowerCase()
  const meta = FALLBACK_BY_COIN[id]
  const fallback = parseFallbackUsd(meta?.env ?? '', defaultUsd ?? meta?.defaultUsd ?? 0)

  const live = await getPrice(id)
  if (live != null && live > 0) return live
  return fallback > 0 ? fallback : 0
}

/** Convenience bundle for scout / fusion routes. */
export async function getOracleRatesUsd(): Promise<{
  eth: number
  sol: number
  trx: number
  ton: number
  btc: number
}> {
  const [eth, sol, trx, ton, btc] = await Promise.all([
    getPriceWithFallback('ethereum', 3000),
    getPriceWithFallback('solana', 150),
    getPriceWithFallback('tron', 0.1),
    getPriceWithFallback('the-open-network', 5),
    getPriceWithFallback('bitcoin', 65_000),
  ])
  return { eth, sol, trx, ton, btc }
}

function resolveCronExpression(): string {
  const raw = readEnv('PRICE_ORACLE_CRON')
  return raw && cron.validate(raw) ? raw : DEFAULT_CRON
}

/** Start periodic CoinGecko → Redis price refresh (every 5 minutes by default). */
export function startPriceOracle(): void {
  if (!isPriceOracleEnabled()) {
    console.info('[PRICE_ORACLE] Disabled (USE_PRICE_ORACLE=false)')
    return
  }
  if (cronTask) {
    console.info('[PRICE_ORACLE] Already running')
    return
  }

  const expression = resolveCronExpression()
  cronTask = cron.schedule(
    expression,
    () => {
      void refreshTrackedPrices()
    },
    { timezone: 'UTC' },
  )

  console.info(`[PRICE_ORACLE] Started (cron=${expression} UTC)`)
  void refreshTrackedPrices()
}

/** Stop cron and close Redis connection. */
export async function stopPriceOracle(): Promise<void> {
  if (cronTask) {
    cronTask.stop()
    cronTask = null
  }
  if (redisClient) {
    try {
      await redisClient.quit()
    } catch {
      redisClient.disconnect()
    }
    redisClient = null
  }
  console.info('[PRICE_ORACLE] Stopped')
}
