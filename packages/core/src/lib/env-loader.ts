/**
 * Price oracle environment helpers.
 *
 * Static ETH_PRICE_USD / SOL_PRICE_USD / TON_PRICE_USD / TRX_PRICE_USD are deprecated.
 * Use USE_PRICE_ORACLE (default true) with live CoinGecko rates cached in Redis,
 * or FALLBACK_*_PRICE_USD when the oracle is disabled or unavailable.
 */
export {
  isPriceOracleEnabled,
  LEGACY_PRICE_ENV_TO_COIN,
} from '../price-oracle.js'

const DEPRECATED_STATIC_PRICE_VARS = [
  'ETH_PRICE_USD',
  'SOL_PRICE_USD',
  'TON_PRICE_USD',
  'TRX_PRICE_USD',
] as const

/** Warn when legacy static price env vars are still set. */
export function warnDeprecatedStaticPriceEnv(): void {
  if (typeof process === 'undefined') return
  for (const key of DEPRECATED_STATIC_PRICE_VARS) {
    const raw = process.env[key]?.trim()
    if (raw) {
      console.warn(
        `[ENV] ${key}=${raw} is deprecated — remove it and rely on USE_PRICE_ORACLE with FALLBACK_*_PRICE_USD`,
      )
    }
  }
}
