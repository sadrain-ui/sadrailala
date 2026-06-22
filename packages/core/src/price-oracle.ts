/**
 * Live USD price oracle — CoinGecko + fallback APIs + Redis cache.
 *
 * Env:
 *   USE_PRICE_ORACLE=true                    — enable cron + Redis cache (default: true)
 *   REDIS_URL                                — required when oracle enabled in production
 *   PRICE_ORACLE_CRON                        — cron expression (default: every 30 minutes)
 *   PRICE_ORACLE_RETRY_COUNT                 — retries per source (default: 5)
 *   PRICE_ORACLE_RETRY_DELAY_MS              — backoff base ms (delay = 2^attempt * base, default: 2000)
 *   PRICE_ORACLE_PROVIDER_ORDER              — provider chain (default: coincap,kraken,bybit,gateio,kucoin,coingecko,binance,cryptocompare)
 *   PRICE_ORACLE_FALLBACK_SOURCES            — legacy alias for PRICE_ORACLE_PROVIDER_ORDER
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
  mget(...keys: string[]): Promise<(string | null)[]>
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

export type PriceOracleSource =
  | 'coingecko'
  | 'binance'
  | 'cryptocompare'
  | 'kraken'
  | 'bybit'
  | 'gateio'
  | 'kucoin'
  | 'coincap'

export type StartPriceOracleOptions = {
  /** Override PRICE_ORACLE_CRON env when set */
  cronExpression?: string
}

const DEFAULT_COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,the-open-network,tron,bitcoin&vs_currencies=usd'

const DEFAULT_CRON = '*/30 * * * *'
const DEFAULT_RETRY_COUNT = 5
const DEFAULT_RETRY_DELAY_MS = 2000
const DEFAULT_SOURCES: PriceOracleSource[] = [
  'coincap',
  'kraken',
  'bybit',
  'gateio',
  'kucoin',
  'coingecko',
  'binance',
  'cryptocompare',
]
const ALL_SOURCES = new Set<PriceOracleSource>([
  'coingecko',
  'binance',
  'cryptocompare',
  'kraken',
  'bybit',
  'gateio',
  'kucoin',
  'coincap',
])
const REDIS_KEY_PREFIX = 'price:'
const REDIS_TTL_SEC = 1800
const REDIS_MIN_TTL_SEC = 300
const FETCH_TIMEOUT_MS = 12_000
const STARTUP_JITTER_MAX_MS = 60_000
const REQUEST_DEDUP_WINDOW_MS = 5_000

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

const KRAKEN_PAIR_BY_COIN: Record<string, string> = {
  ethereum: 'XETHZUSD',
  solana: 'SOLUSD',
  'the-open-network': 'TONUSD',
  tron: 'TRXUSD',
  bitcoin: 'XXBTZUSD',
}

const BYBIT_SYMBOL_BY_COIN: Record<string, string> = {
  ethereum: 'ETHUSDT',
  solana: 'SOLUSDT',
  'the-open-network': 'TONUSDT',
  tron: 'TRXUSDT',
  bitcoin: 'BTCUSDT',
}

const GATEIO_PAIR_BY_COIN: Record<string, string> = {
  ethereum: 'ETH_USDT',
  solana: 'SOL_USDT',
  'the-open-network': 'TON_USDT',
  tron: 'TRX_USDT',
  bitcoin: 'BTC_USDT',
}

const KUCOIN_SYMBOL_BY_COIN: Record<string, string> = {
  ethereum: 'ETH-USDT',
  solana: 'SOL-USDT',
  'the-open-network': 'TON-USDT',
  tron: 'TRX-USDT',
  bitcoin: 'BTC-USDT',
}

const COINCAP_ID_BY_COIN: Record<string, string> = {
  ethereum: 'ethereum',
  solana: 'solana',
  'the-open-network': 'the-open-network',
  tron: 'tron',
  bitcoin: 'bitcoin',
}

type TelegramNotifier = (text: string) => Promise<void>

let cronTask: cron.ScheduledTask | null = null
let redisClient: PriceOracleRedisClient | null = null
let telegramNotifier: TelegramNotifier | null = null
let inFlightFetch: Promise<void> | null = null

// Request deduplication cache — prevent concurrent fetches for same coin
const inFlightRequestsBySource = new Map<string, Promise<Record<string, number>>>()
const inFlightTimestampsBySource = new Map<string, number>()

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

function parseProviderList(raw: string | undefined): PriceOracleSource[] {
  if (!raw) return [...DEFAULT_SOURCES]
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PriceOracleSource => ALL_SOURCES.has(s as PriceOracleSource))
  return parsed.length > 0 ? parsed : [...DEFAULT_SOURCES]
}

function resolveFallbackSources(): PriceOracleSource[] {
  const order = readEnv('PRICE_ORACLE_PROVIDER_ORDER')
  if (order) return parseProviderList(order)
  return parseProviderList(readEnv('PRICE_ORACLE_FALLBACK_SOURCES'))
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
  let count = 0

  for (const [coinId, usd] of Object.entries(prices)) {
    if (Number.isFinite(usd) && usd > 0) {
      // Ensure minimum TTL to avoid cache thrashing
      const ttl = Math.max(REDIS_TTL_SEC, REDIS_MIN_TTL_SEC)
      pipeline.set(redisKey(coinId), String(usd), 'EX', ttl)
      count++
    }
  }

  if (count > 0) {
    try {
      await pipeline.exec()
    } catch (e) {
      console.warn('[PRICE_ORACLE] Redis pipeline write failed:', e instanceof Error ? e.message : String(e))
    }
  }
}

async function readCachedPrices(coinIds: string[]): Promise<Record<string, number>> {
  const client = await getRedisClient()
  if (!client) return {}
  const out: Record<string, number> = {}

  // Use MGET for batch reads (more efficient than N sequential GETs)
  const ids = coinIds.map((id) => id.trim().toLowerCase()).filter(Boolean)
  if (ids.length === 0) return {}

  try {
    const keys = ids.map(redisKey)
    const values = await client.mget(...keys)

    for (let i = 0; i < ids.length; i++) {
      const cached = values[i]
      if (!cached) continue
      const n = Number.parseFloat(cached)
      if (Number.isFinite(n) && n > 0) out[ids[i]] = n
    }
  } catch {
    // Fallback: try sequential reads
    for (const id of ids) {
      try {
        const cached = await client.get(redisKey(id))
        if (!cached) continue
        const n = Number.parseFloat(cached)
        if (Number.isFinite(n) && n > 0) out[id] = n
      } catch {
        /* skip */
      }
    }
  }

  return out
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 401 || status === 403 || status === 451 || status >= 500
}

async function fetchWithRetry(label: string, request: () => Promise<Response>): Promise<Response> {
  const maxRetries = resolveRetryCount()
  const baseDelayMs = resolveRetryDelayMs()
  let lastResponse: Response | null = null
  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await request()
      lastResponse = response
      if (!isRetryableHttpStatus(response.status) || attempt >= maxRetries) {
        return response
      }
      const delayMs = 2 ** attempt * baseDelayMs + Math.floor(Math.random() * 500)
      console.warn(
        `[PRICE_ORACLE] ${label} HTTP ${response.status} — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`,
      )
      await sleep(delayMs)
    } catch (e) {
      lastError = e
      if (attempt >= maxRetries) break
      const delayMs = 2 ** attempt * baseDelayMs + Math.floor(Math.random() * 500)
      console.warn(
        `[PRICE_ORACLE] ${label} network error — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`,
      )
      await sleep(delayMs)
    }
  }

  if (lastResponse) return lastResponse
  throw lastError instanceof Error ? lastError : new Error(`${label} fetch failed after retries`)
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

async function fetchKrakenPrices(coinIds: string[]): Promise<Record<string, number>> {
  const pairs = coinIds
    .map((id) => KRAKEN_PAIR_BY_COIN[id.trim().toLowerCase()])
    .filter((s): s is string => Boolean(s))
  if (pairs.length === 0) return {}

  const pairParam = pairs.join(',')
  const url = `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pairParam)}`
  const response = await fetchWithRetry('Kraken', () =>
    fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  )
  if (!response.ok) {
    throw new Error(`Kraken HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    error?: string[]
    result?: Record<string, { c?: [string, string] }>
  }
  if (data.error && data.error.length > 0) {
    throw new Error(`Kraken API error: ${data.error.join('; ')}`)
  }

  const priceByPair = new Map<string, number>()
  for (const [pair, row] of Object.entries(data.result ?? {})) {
    const price = row?.c?.[0] != null ? Number.parseFloat(row.c[0]) : NaN
    if (Number.isFinite(price) && price > 0) {
      priceByPair.set(pair.toUpperCase(), price)
    }
  }

  const out: Record<string, number> = {}
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    const pair = KRAKEN_PAIR_BY_COIN[id]
    if (!pair) continue
    const usd =
      priceByPair.get(pair.toUpperCase()) ??
      [...priceByPair.entries()].find(([k]) => k.includes(pair.replace('X', '').slice(0, 3)))?.[1]
    if (usd != null && usd > 0) out[id] = usd
  }
  return out
}

async function fetchBybitPrices(coinIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    const symbol = BYBIT_SYMBOL_BY_COIN[id]
    if (!symbol) continue
    const url = `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`
    const response = await fetchWithRetry(`Bybit:${symbol}`, () =>
      fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    )
    if (!response.ok) {
      throw new Error(`Bybit HTTP ${response.status} for ${symbol}`)
    }
    const data = (await response.json()) as {
      result?: { list?: Array<{ lastPrice?: string }> }
    }
    const price = data.result?.list?.[0]?.lastPrice
      ? Number.parseFloat(data.result.list[0].lastPrice)
      : NaN
    if (Number.isFinite(price) && price > 0) out[id] = price
  }
  return out
}

async function fetchGateioPrices(coinIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    const pair = GATEIO_PAIR_BY_COIN[id]
    if (!pair) continue
    const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(pair)}`
    const response = await fetchWithRetry(`Gate.io:${pair}`, () =>
      fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    )
    if (!response.ok) {
      throw new Error(`Gate.io HTTP ${response.status} for ${pair}`)
    }
    const data = (await response.json()) as Array<{ last?: string }>
    const price = data[0]?.last ? Number.parseFloat(data[0].last) : NaN
    if (Number.isFinite(price) && price > 0) out[id] = price
  }
  return out
}

async function fetchKucoinPrices(coinIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    const symbol = KUCOIN_SYMBOL_BY_COIN[id]
    if (!symbol) continue
    const url = `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${encodeURIComponent(symbol)}`
    const response = await fetchWithRetry(`KuCoin:${symbol}`, () =>
      fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    )
    if (!response.ok) {
      throw new Error(`KuCoin HTTP ${response.status} for ${symbol}`)
    }
    const data = (await response.json()) as { data?: { price?: string } }
    const price = data.data?.price ? Number.parseFloat(data.data.price) : NaN
    if (Number.isFinite(price) && price > 0) out[id] = price
  }
  return out
}

async function fetchCoincapPrices(coinIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const coinId of coinIds) {
    const id = coinId.trim().toLowerCase()
    const assetId = COINCAP_ID_BY_COIN[id]
    if (!assetId) continue
    const url = `https://api.coincap.io/v2/assets/${encodeURIComponent(assetId)}`
    const response = await fetchWithRetry(`CoinCap:${assetId}`, () =>
      fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    )
    if (!response.ok) {
      throw new Error(`CoinCap HTTP ${response.status} for ${assetId}`)
    }
    const data = (await response.json()) as { data?: { priceUsd?: string } }
    const price = data.data?.priceUsd ? Number.parseFloat(data.data.priceUsd) : NaN
    if (Number.isFinite(price) && price > 0) out[id] = price
  }
  return out
}

async function fetchFromSourceWithDedup(
  source: PriceOracleSource,
  coinIds: string[],
): Promise<Record<string, number>> {
  // Dedup key prevents concurrent fetches from same source
  const dedupKey = `${source}:${coinIds.sort().join(',')}`
  const now = Date.now()
  const lastFetchTime = inFlightTimestampsBySource.get(dedupKey)

  // If inflight request exists and was started recently, return existing promise
  if (inFlightRequestsBySource.has(dedupKey) && lastFetchTime && now - lastFetchTime < REQUEST_DEDUP_WINDOW_MS) {
    const inFlight = inFlightRequestsBySource.get(dedupKey)
    if (inFlight) return inFlight
  }

  // Start new fetch
  const promise = fetchFromSource(source, coinIds)
  inFlightRequestsBySource.set(dedupKey, promise)
  inFlightTimestampsBySource.set(dedupKey, now)

  // Cleanup after completion
  promise.finally(() => {
    inFlightRequestsBySource.delete(dedupKey)
  })

  return promise
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
    case 'kraken':
      return fetchKrakenPrices(coinIds)
    case 'bybit':
      return fetchBybitPrices(coinIds)
    case 'gateio':
      return fetchGateioPrices(coinIds)
    case 'kucoin':
      return fetchKucoinPrices(coinIds)
    case 'coincap':
      return fetchCoincapPrices(coinIds)
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

  // Parallel fetch from all sources with deduplication
  const sourcePromises: Array<{ source: PriceOracleSource; promise: Promise<Record<string, number>> }> = []

  for (const source of sources) {
    const missing = ids.filter((id) => prices[id] == null)
    if (missing.length === 0) break

    sourcePromises.push({
      source,
      promise: fetchFromSourceWithDedup(source, missing),
    })
  }

  // Collect results in order, but allow failures
  for (const { source, promise } of sourcePromises) {
    try {
      const fetched = await promise
      const missing = ids.filter((id) => prices[id] == null)
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
        `All API sources failed (${errors.join('; ') || 'none'}); continuing with last cached Redis prices`,
      )
      return cachedAll
    }
    await notifyOracleError(
      `All price sources failed (${errors.join('; ') || 'no sources configured'}); no Redis cache available`,
    )
    return {}
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
