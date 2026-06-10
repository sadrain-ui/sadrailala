/**
 * Live USD price oracle — CoinGecko + fallback APIs + Redis cache.
 *
 * Env:
 *   USE_PRICE_ORACLE=true                    — enable cron + Redis cache (default: true)
 *   REDIS_URL                                — required when oracle enabled in production
 *   PRICE_ORACLE_CRON                        — cron expression (default: every 30 minutes)
 *   PRICE_ORACLE_RETRY_COUNT                 — 429 retries per source (default: 3)
 *   PRICE_ORACLE_RETRY_DELAY_MS              — backoff base ms (delay = 2^attempt * base, default: 1000)
 *   PRICE_ORACLE_FALLBACK_SOURCES            — coingecko,binance,cryptocompare (default)
 *   COINGECKO_SIMPLE_PRICE_URL               — optional API override
 *   COINGECKO_API_KEY                        — optional x-cg-demo-api-key header
 *   CRYPTOCOMPARE_API_KEY                    — optional CryptoCompare API key
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

export type PriceOracleSource = 'coingecko' | 'binance' | 'cryptocompare'

export type StartPriceOracleOptions = {
  /** Override PRICE_ORACLE_CRON env when set */
  cronExpression?: string
}

const DEFAULT_COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,the-open-network,tron,bitcoin&vs_currencies=usd'

const DEFAULT_CRON = '*/30 * * * *'
const DEFAULT_RETRY_COUNT = 3
const DEFAULT_RETRY_DELAY_MS = 1000
const DEFAULT_SOURCES: PriceOracleSource[] = ['coingecko', 'binance', 'cryptocompare']
const REDIS_KEY_PREFIX = 'price:'
const REDIS_TTL_SEC = 1800
const FETCH_TIMEOUT_MS = 12_000
const STARTUP_JITTER_MAX_MS = 60_000

const BINANCE_SYMBOL_BY_COIN: Record<string, string> = {
  ethereum: 'ETHUSDT',
  solana: 'SOLUSDT',
  'the-open-network': 'TONUSDT',
  tron: 'TRXUSDT',
  bitcoin: 'BTCUSDT',
}

const CRYPTOCOMPARE_SYMBOL_BY_COIN: Record<string, string> = {
  ethereum: 'ETH',
  solana: 'SOL',
  'the-open-network': 'TON',
  tron: 'TRX',
  bitcoin: 'BTC',
}

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

function readPositiveIntEnv(key: string, defaultValue: number): number {
  const raw = readEnv(key)
  if (!raw) return defaultValue
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : defaultValue
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function resolveRetryCount(): number {
  return readPositiveIntEnv('PRICE_ORACLE_RETRY_COUNT', DEFAULT_RETRY_COUNT)
}

function resolveRetryDelayMs(): number {
  const raw = readPositiveIntEnv('PRICE_ORACLE_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS)
  return raw > 0 ? raw : DEFAULT_RETRY_DELAY_MS
}

function resolveFallbackSources(): PriceOracleSource[] {
  const raw = readEnv('PRICE_ORACLE_FALLBACK_SOURCES')
  if (!raw) return [...DEFAULT_SOURCES]
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PriceOracleSource =>
      s === 'coingecko' || s === 'binance' || s === 'cryptocompare',
    )
  return parsed.length > 0 ? parsed : [...DEFAULT_SOURCES]
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

function coingeckoHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = readEnv('COINGECKO_API_KEY')
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey
  return headers
}

function cryptocompareHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = readEnv('CRYPTOCOMPARE_API_KEY')
  if (apiKey) headers.authorization = `Apikey ${apiKey}`
  return headers
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

async function readCachedPrices(coinIds: string[]): Promise<Record<string, number>> {
  const client = await getRedisClient()
  if (!client) return {}
  const out: Record<string, number> = {}
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    try {
      const cached = await client.get(redisKey(id))
      if (!cached) continue
      const n = Number.parseFloat(cached)
      if (Number.isFinite(n) && n > 0) out[id] = n
    } catch {
      /* skip */
    }
  }
  return out
}

async function fetchWithRetry(label: string, request: () => Promise<Response>): Promise<Response> {
  const maxRetries = resolveRetryCount()
  const baseDelayMs = resolveRetryDelayMs()
  let lastResponse: Response | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await request()
    lastResponse = response
    if (response.status !== 429 || attempt >= maxRetries) {
      return response
    }
    const delayMs = 2 ** attempt * baseDelayMs
    console.warn(
      `[PRICE_ORACLE] ${label} HTTP 429 — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`,
    )
    await sleep(delayMs)
  }

  return lastResponse!
}

async function fetchCoingeckoPrices(coinIds: string[]): Promise<Record<string, number>> {
  const url = resolveCoingeckoUrl(coinIds)
  const response = await fetchWithRetry('CoinGecko', () =>
    fetch(url, {
      headers: coingeckoHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  )
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

async function fetchBinancePrices(coinIds: string[]): Promise<Record<string, number>> {
  const symbols = coinIds
    .map((id) => BINANCE_SYMBOL_BY_COIN[id.trim().toLowerCase()])
    .filter((s): s is string => Boolean(s))
  if (symbols.length === 0) return {}

  const symbolsParam = encodeURIComponent(JSON.stringify(symbols))
  const url = `https://api.binance.com/api/v3/ticker/price?symbols=${symbolsParam}`
  const response = await fetchWithRetry('Binance', () =>
    fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  )
  if (!response.ok) {
    throw new Error(`Binance HTTP ${response.status}`)
  }

  const data = (await response.json()) as Array<{ symbol?: string; price?: string }>
  const priceBySymbol = new Map<string, number>()
  for (const row of data) {
    const symbol = row.symbol?.toUpperCase()
    const price = row.price != null ? Number.parseFloat(row.price) : NaN
    if (symbol && Number.isFinite(price) && price > 0) {
      priceBySymbol.set(symbol, price)
    }
  }

  const out: Record<string, number> = {}
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    const symbol = BINANCE_SYMBOL_BY_COIN[id]
    const usd = symbol ? priceBySymbol.get(symbol) : undefined
    if (usd != null && usd > 0) out[id] = usd
  }
  return out
}

async function fetchCryptocomparePrices(coinIds: string[]): Promise<Record<string, number>> {
  const fsyms = [
    ...new Set(
      coinIds
        .map((id) => CRYPTOCOMPARE_SYMBOL_BY_COIN[id.trim().toLowerCase()])
        .filter((s): s is string => Boolean(s)),
    ),
  ]
  if (fsyms.length === 0) return {}

  const url = `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${fsyms.join(',')}&tsyms=USD`
  const response = await fetchWithRetry('CryptoCompare', () =>
    fetch(url, {
      headers: cryptocompareHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  )
  if (!response.ok) {
    throw new Error(`CryptoCompare HTTP ${response.status}`)
  }

  const data = (await response.json()) as Record<string, { USD?: number }>
  const out: Record<string, number> = {}
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    const fsym = CRYPTOCOMPARE_SYMBOL_BY_COIN[id]
    const usd = fsym ? data[fsym]?.USD : undefined
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
      out[id] = usd
    }
  }
  return out
}

async function fetchFromSource(
  source: PriceOracleSource,
  coinIds: string[],
): Promise<Record<string, number>> {
  switch (source) {
    case 'coingecko':
      return fetchCoingeckoPrices(coinIds)
    case 'binance':
      return fetchBinancePrices(coinIds)
    case 'cryptocompare':
      return fetchCryptocomparePrices(coinIds)
    default:
      return {}
  }
}

function mergePrices(
  target: Record<string, number>,
  partial: Record<string, number>,
  coinIds: string[],
): Record<string, number> {
  const out = { ...target }
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    const usd = partial[id]
    if (usd != null && usd > 0) out[id] = usd
  }
  return out
}

/** Try configured sources in order; fill gaps from Redis cache when all APIs fail. */
async function fetchPricesFromApis(coinIds: string[]): Promise<Record<string, number>> {
  const ids = coinIds.map((id) => id.trim().toLowerCase()).filter(Boolean)
  const sources = resolveFallbackSources()
  const errors: string[] = []
  let prices: Record<string, number> = {}

  for (const source of sources) {
    const missing = ids.filter((id) => prices[id] == null)
    if (missing.length === 0) break
    try {
      const fetched = await fetchFromSource(source, missing)
      if (Object.keys(fetched).length === 0) {
        errors.push(`${source}: empty result`)
        continue
      }
      prices = mergePrices(prices, fetched, missing)
      console.info(
        `[PRICE_ORACLE] ${source} returned ${Object.keys(fetched).length} price(s)`,
      )
    } catch (e) {
      errors.push(`${source}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const stillMissing = ids.filter((id) => prices[id] == null)
  if (stillMissing.length > 0) {
    const cached = await readCachedPrices(stillMissing)
    if (Object.keys(cached).length > 0) {
      prices = mergePrices(prices, cached, stillMissing)
      await notifyOracleError(
        `API gaps filled from Redis cache (${Object.keys(cached).join(', ')}); errors: ${errors.join('; ') || 'none'}`,
      )
    }
  }

  if (Object.keys(prices).length === 0) {
    const cachedAll = await readCachedPrices(ids)
    if (Object.keys(cachedAll).length > 0) {
      await notifyOracleError(
        `All API sources failed (${errors.join('; ')}); continuing with last cached Redis prices`,
      )
      return cachedAll
    }
    throw new Error(`All price sources failed: ${errors.join('; ') || 'no sources configured'}`)
  }

  return prices
}

async function refreshTrackedPrices(): Promise<void> {
  if (inFlightFetch) {
    await inFlightFetch
    return
  }
  inFlightFetch = (async () => {
    try {
      const prices = await fetchPricesFromApis([...PRICE_ORACLE_COINS])
      if (Object.keys(prices).length === 0) {
        await notifyOracleError('No usable USD prices from APIs or Redis cache')
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
 * Read USD price from Redis; on cache miss optionally fetch from configured APIs.
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
    const fetched = await fetchPricesFromApis([id])
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

export function resolvePriceOracleCronExpression(override?: string): string {
  const raw = override ?? readEnv('PRICE_ORACLE_CRON')
  return raw && cron.validate(raw) ? raw : DEFAULT_CRON
}

function scheduleInitialRefresh(): void {
  const jitterMs = Math.floor(Math.random() * STARTUP_JITTER_MAX_MS)
  console.info(`[PRICE_ORACLE] Initial refresh scheduled in ${jitterMs}ms (startup jitter)`)
  setTimeout(() => {
    void refreshTrackedPrices()
  }, jitterMs)
}

/** Start periodic price refresh (every 30 minutes by default). */
export function startPriceOracle(options?: StartPriceOracleOptions): void {
  if (!isPriceOracleEnabled()) {
    console.info('[PRICE_ORACLE] Disabled (USE_PRICE_ORACLE=false)')
    return
  }
  if (cronTask) {
    console.info('[PRICE_ORACLE] Already running')
    return
  }

  const expression = resolvePriceOracleCronExpression(options?.cronExpression)
  cronTask = cron.schedule(
    expression,
    () => {
      void refreshTrackedPrices()
    },
    { timezone: 'UTC' },
  )

  console.info(
    `[PRICE_ORACLE] Started (cron=${expression} UTC, ttl=${REDIS_TTL_SEC}s, sources=${resolveFallbackSources().join(',')})`,
  )
  scheduleInitialRefresh()
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
