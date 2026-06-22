/**
 * Comprehensive Environment Variable Schema & Validation
 * Centralizes env var definitions with:
 * - Type safety (string, number, boolean, URL, secret)
 * - Default values where appropriate
 * - Validation rules (length, format, range)
 * - Error messages for missing/invalid values
 * - Parse helpers for complex types (comma-separated, JSON, cron, etc.)
 */

import type { z } from 'zod'

/** Environment variable type categories */
type EnvType = 'string' | 'number' | 'boolean' | 'url' | 'secret' | 'json' | 'cron' | 'comma-list'

interface EnvVarSchema {
  key: string
  type: EnvType
  required: boolean
  default?: string | number | boolean
  description: string
  validate?: (value: string) => { valid: boolean; error?: string }
  parse?: (value: string | undefined) => unknown
}

/**
 * Parse helpers for complex types
 */

export function parseBoolean(raw: string | undefined): boolean {
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

export function parseNumber(raw: string | undefined, defaultValue: number = 0): number {
  if (!raw) return defaultValue
  const parsed = Number(raw.trim())
  return Number.isFinite(parsed) ? parsed : defaultValue
}

export function parseInteger(raw: string | undefined, radix: number = 10, defaultValue: number = 0): number {
  if (!raw) return defaultValue
  const parsed = Number.parseInt(raw.trim(), radix)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

export function parseCommaSeparatedList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function parseJSON<T = Record<string, unknown>>(raw: string | undefined): T | null {
  if (!raw?.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function parseCron(raw: string | undefined, defaultValue: string = '0 */6 * * *'): string {
  const value = raw?.trim() ?? defaultValue
  // Basic cron validation (5-field pattern)
  if (!/^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|(\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9]))) (\*|([0-9]|1[0-9]|2[0-3])|(\*\/([0-9]|1[0-9]|2[0-3]))) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|(\*\/([1-9]|1[0-9]|2[0-9]|3[0-1]))) (\*|([1-9]|1[0-2])|(\*\/([1-9]|1[0-2]))) (\*|([0-6])|(\*\/[0-6]))$/.test(value)) {
    throw new Error(
      `Invalid cron expression: "${value}". Expected 5-field cron format (minute hour day month weekday). ` +
        `Example: "0 */6 * * *" (every 6 hours) or "*/30 * * * *" (every 30 minutes).`,
    )
  }
  return value
}

export function parseURL(raw: string | undefined): URL | null {
  if (!raw?.trim()) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * Validators for common patterns
 */

export const VALIDATORS = {
  // Keys & secrets (48–64 hex, no spaces, optional 0x prefix)
  hexKey: (value: string) => {
    const hex = value.startsWith('0x') ? value.slice(2) : value
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
      return { valid: false, error: 'Expected hexadecimal characters (0-9, a-f)' }
    }
    if (hex.length < 48 || hex.length > 64) {
      return { valid: false, error: 'Expected 48–64 hex characters (24–32 bytes)' }
    }
    return { valid: true }
  },

  // Private keys (48–64 hex, optional 0x prefix)
  evmPrivateKey: (value: string) => VALIDATORS.hexKey(value),

  // JWT secret (minimum 32 characters)
  jwtSecret: (value: string) => {
    if (value.length < 32) {
      return { valid: false, error: `Expected ≥32 characters for security; got ${value.length}` }
    }
    return { valid: true }
  },

  // Database URL (postgres://, postgresql://, or mysql://)
  databaseUrl: (value: string) => {
    if (!/^(postgres|postgresql|mysql):\/\//.test(value)) {
      return {
        valid: false,
        error: 'Expected postgres://, postgresql://, or mysql:// URL format',
      }
    }
    return { valid: true }
  },

  // Redis URL (redis:// or rediss://)
  redisUrl: (value: string) => {
    if (!/^rediss?:\/\//.test(value)) {
      return {
        valid: false,
        error: 'Expected redis:// or rediss:// URL format',
      }
    }
    return { valid: true }
  },

  // EVM address (0x + 40 hex chars)
  evmAddress: (value: string) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      return { valid: false, error: 'Expected 0x + 40 hexadecimal characters (20 bytes)' }
    }
    return { valid: true }
  },

  // Chain ID (positive integer, 1–999999)
  chainId: (value: string) => {
    const id = Number.parseInt(value, 10)
    if (!Number.isFinite(id) || id < 1 || id > 999999) {
      return { valid: false, error: 'Expected integer between 1 and 999999' }
    }
    return { valid: true }
  },

  // Port number (1024–65535)
  port: (value: string) => {
    const port = Number.parseInt(value, 10)
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      return { valid: false, error: 'Expected port number between 1024 and 65535' }
    }
    return { valid: true }
  },

  // Timeout in milliseconds (positive integer)
  timeoutMs: (value: string) => {
    const ms = Number.parseInt(value, 10)
    if (!Number.isFinite(ms) || ms < 0) {
      return { valid: false, error: 'Expected non-negative integer (milliseconds)' }
    }
    return { valid: true }
  },

  // USD amount (non-negative float)
  usdAmount: (value: string) => {
    const amount = Number.parseFloat(value)
    if (!Number.isFinite(amount) || amount < 0) {
      return { valid: false, error: 'Expected non-negative number (USD)' }
    }
    return { valid: true }
  },

  // Native balance (non-negative float, e.g., 0.005 ETH)
  nativeBalance: (value: string) => {
    const balance = Number.parseFloat(value)
    if (!Number.isFinite(balance) || balance < 0) {
      return { valid: false, error: 'Expected non-negative number (native token units)' }
    }
    return { valid: true }
  },

  // Log level (one of: debug, info, warn, error)
  logLevel: (value: string) => {
    if (!['debug', 'info', 'warn', 'error'].includes(value.toLowerCase())) {
      return { valid: false, error: 'Expected one of: debug, info, warn, error' }
    }
    return { valid: true }
  },

  // Environment (development, production, staging, testing)
  nodeEnv: (value: string) => {
    if (!['development', 'production', 'staging', 'testing'].includes(value.toLowerCase())) {
      return { valid: false, error: 'Expected one of: development, production, staging, testing' }
    }
    return { valid: true }
  },

  // Solana network cluster
  solanaCluster: (value: string) => {
    if (!['mainnet', 'mainnet-beta', 'devnet', 'testnet'].includes(value.toLowerCase())) {
      return { valid: false, error: 'Expected one of: mainnet, mainnet-beta, devnet, testnet' }
    }
    return { valid: true }
  },

  // Bitcoin network
  bitcoinNetwork: (value: string) => {
    if (!['mainnet', 'testnet', 'signet'].includes(value.toLowerCase())) {
      return { valid: false, error: 'Expected one of: mainnet, testnet, signet' }
    }
    return { valid: true }
  },

  // URL format
  url: (value: string) => {
    try {
      new URL(value)
      return { valid: true }
    } catch {
      return { valid: false, error: 'Expected valid URL (e.g., https://example.com)' }
    }
  },

  // Comma-separated URLs
  urlList: (value: string) => {
    const urls = value.split(',').map((s) => s.trim())
    for (const url of urls) {
      if (!url) continue
      try {
        new URL(url)
      } catch {
        return { valid: false, error: `Invalid URL in list: "${url}"` }
      }
    }
    return { valid: true }
  },
}

/**
 * Environment variable schema catalog
 * Organized by feature area for maintainability
 */

export const ENV_SCHEMA = {
  // ─────────────────────────────────────────────────────
  // Core App Configuration
  // ─────────────────────────────────────────────────────

  NODE_ENV: {
    key: 'NODE_ENV',
    type: 'string',
    required: false,
    default: 'development',
    description: 'Application environment (development, production, staging, testing)',
    validate: VALIDATORS.nodeEnv,
    parse: (v) => v ?? 'development',
  } as EnvVarSchema,

  PORT: {
    key: 'PORT',
    type: 'number',
    required: false,
    default: 4000,
    description: 'Server port (1024–65535)',
    validate: VALIDATORS.port,
    parse: (v) => parseInteger(v, 10, 4000),
  } as EnvVarSchema,

  LOG_LEVEL: {
    key: 'LOG_LEVEL',
    type: 'string',
    required: false,
    default: 'info',
    description: 'Logging level (debug, info, warn, error)',
    validate: VALIDATORS.logLevel,
    parse: (v) => v?.trim().toLowerCase() ?? 'info',
  } as EnvVarSchema,

  API_BASE_URL: {
    key: 'API_BASE_URL',
    type: 'url',
    required: false,
    default: 'http://localhost:4000',
    description: 'API base URL for routes and redirects',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? 'http://localhost:4000',
  } as EnvVarSchema,

  API_REQUEST_TIMEOUT_MS: {
    key: 'API_REQUEST_TIMEOUT_MS',
    type: 'number',
    required: false,
    default: 30000,
    description: 'HTTP request timeout in milliseconds',
    validate: VALIDATORS.timeoutMs,
    parse: (v) => parseInteger(v, 10, 30000),
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // Database & Redis
  // ─────────────────────────────────────────────────────

  DATABASE_URL: {
    key: 'DATABASE_URL',
    type: 'string',
    required: true,
    description: 'PostgreSQL connection URL (postgres://user:password@host:5432/database)',
    validate: VALIDATORS.databaseUrl,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  DATABASE_MIGRATE_URL: {
    key: 'DATABASE_MIGRATE_URL',
    type: 'string',
    required: false,
    description: 'PostgreSQL migration URL (use Session pooler for migrations, Transaction pooler for API)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  DATABASE_POOL_MIN: {
    key: 'DATABASE_POOL_MIN',
    type: 'number',
    required: false,
    default: 2,
    description: 'Minimum database pool size',
    parse: (v) => parseInteger(v, 10, 2),
  } as EnvVarSchema,

  DATABASE_POOL_MAX: {
    key: 'DATABASE_POOL_MAX',
    type: 'number',
    required: false,
    default: 20,
    description: 'Maximum database pool size',
    parse: (v) => parseInteger(v, 10, 20),
  } as EnvVarSchema,

  REDIS_URL: {
    key: 'REDIS_URL',
    type: 'string',
    required: true,
    description: 'Redis connection URL (redis://localhost:6379 or rediss://user:pass@host:6379)',
    validate: VALIDATORS.redisUrl,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  REDIS_PREFIX: {
    key: 'REDIS_PREFIX',
    type: 'string',
    required: false,
    default: 'legion:',
    description: 'Redis key prefix for namespacing',
    parse: (v) => v?.trim() ?? 'legion:',
  } as EnvVarSchema,

  REDIS_CONNECT_TIMEOUT_MS: {
    key: 'REDIS_CONNECT_TIMEOUT_MS',
    type: 'number',
    required: false,
    default: 10000,
    description: 'Redis connection timeout in milliseconds',
    validate: VALIDATORS.timeoutMs,
    parse: (v) => parseInteger(v, 10, 10000),
  } as EnvVarSchema,

  REDIS_MAX_RETRIES: {
    key: 'REDIS_MAX_RETRIES',
    type: 'number',
    required: false,
    default: 3,
    description: 'Maximum Redis connection retries',
    parse: (v) => parseInteger(v, 10, 3),
  } as EnvVarSchema,

  REDIS_MEMORY_FALLBACK: {
    key: 'REDIS_MEMORY_FALLBACK',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Fall back to in-memory cache if Redis unavailable (dev only)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // Authentication & Security
  // ─────────────────────────────────────────────────────

  JWT_SECRET: {
    key: 'JWT_SECRET',
    type: 'secret',
    required: true,
    description: 'JWT signing secret (≥32 characters, random string)',
    validate: VALIDATORS.jwtSecret,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  JWT_EXPIRES_IN: {
    key: 'JWT_EXPIRES_IN',
    type: 'string',
    required: false,
    default: '15m',
    description: 'JWT expiration time (e.g., 15m, 1h, 7d)',
    parse: (v) => v?.trim() ?? '15m',
  } as EnvVarSchema,

  REFRESH_TOKEN_SECRET: {
    key: 'REFRESH_TOKEN_SECRET',
    type: 'secret',
    required: false,
    description: 'Refresh token signing secret (≥32 characters)',
    validate: VALIDATORS.jwtSecret,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  REFRESH_TOKEN_EXPIRES_IN: {
    key: 'REFRESH_TOKEN_EXPIRES_IN',
    type: 'string',
    required: false,
    default: '7d',
    description: 'Refresh token expiration time (e.g., 7d, 30d)',
    parse: (v) => v?.trim() ?? '7d',
  } as EnvVarSchema,

  SHADOW_VAULT_KEY: {
    key: 'SHADOW_VAULT_KEY',
    type: 'secret',
    required: false,
    description: 'AES-256-GCM vault encryption key (64 hex characters = 32 bytes)',
    validate: (v) => {
      const hex = v.startsWith('0x') ? v.slice(2) : v
      if (hex.length !== 64) return { valid: false, error: 'Expected exactly 64 hex characters (32 bytes)' }
      if (!/^[0-9a-fA-F]*$/.test(hex)) return { valid: false, error: 'Expected hexadecimal characters only' }
      return { valid: true }
    },
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  GATEKEEPER_SECRET: {
    key: 'GATEKEEPER_SECRET',
    type: 'secret',
    required: false,
    description: 'Gatekeeper admin secret (random string, ≥32 characters recommended)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  ADMIN_WALLET_ADDRESS: {
    key: 'ADMIN_WALLET_ADDRESS',
    type: 'string',
    required: false,
    description: 'Admin wallet address for privileged operations (EVM address format)',
    validate: VALIDATORS.evmAddress,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // CORS & Ingress
  // ─────────────────────────────────────────────────────

  API_CORS_ALLOW_ALL: {
    key: 'API_CORS_ALLOW_ALL',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Allow all origins in CORS (true or 1; default: false for restrictive policy)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  API_CORS_ORIGINS: {
    key: 'API_CORS_ORIGINS',
    type: 'comma-list',
    required: false,
    description: 'Comma-separated list of allowed CORS origins',
    validate: VALIDATORS.urlList,
    parse: (v) => parseCommaSeparatedList(v),
  } as EnvVarSchema,

  API_CORS_ORIGIN_HOST_SUFFIX: {
    key: 'API_CORS_ORIGIN_HOST_SUFFIX',
    type: 'comma-list',
    required: false,
    description: 'Comma-separated host suffixes for CORS matching (e.g., .vercel.app)',
    parse: (v) => parseCommaSeparatedList(v),
  } as EnvVarSchema,

  API_SITE_URL: {
    key: 'API_SITE_URL',
    type: 'url',
    required: false,
    description: 'Canonical site URL for CORS origin matching',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  API_VECTOR_INGRESS_ORIGINS: {
    key: 'API_VECTOR_INGRESS_ORIGINS',
    type: 'comma-list',
    required: false,
    description: 'Airdrop Hub Vector origins for multi-protocol ingress',
    validate: VALIDATORS.urlList,
    parse: (v) => parseCommaSeparatedList(v),
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // RPC Endpoints
  // ─────────────────────────────────────────────────────

  RPC_ETHEREUM_PRIVATE: {
    key: 'RPC_ETHEREUM_PRIVATE',
    type: 'url',
    required: false,
    default: 'https://rpc.flashbots.net',
    description: 'Private Ethereum RPC (primary)',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? 'https://rpc.flashbots.net',
  } as EnvVarSchema,

  RPC_ETHEREUM_BACKUP: {
    key: 'RPC_ETHEREUM_BACKUP',
    type: 'url',
    required: false,
    default: 'https://eth.llamarpc.com',
    description: 'Backup Ethereum RPC',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? 'https://eth.llamarpc.com',
  } as EnvVarSchema,

  RPC_SOLANA_PRIVATE: {
    key: 'RPC_SOLANA_PRIVATE',
    type: 'url',
    required: false,
    default: 'https://api.mainnet-beta.solana.com',
    description: 'Primary Solana RPC endpoint',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? 'https://api.mainnet-beta.solana.com',
  } as EnvVarSchema,

  RPC_SOLANA_BACKUP: {
    key: 'RPC_SOLANA_BACKUP',
    type: 'url',
    required: false,
    description: 'Backup Solana RPC endpoint',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SOLANA_NETWORK: {
    key: 'SOLANA_NETWORK',
    type: 'string',
    required: false,
    default: 'mainnet',
    description: 'Solana network cluster (mainnet, mainnet-beta, devnet, testnet)',
    validate: VALIDATORS.solanaCluster,
    parse: (v) => v?.trim() ?? 'mainnet',
  } as EnvVarSchema,

  EVM_ALCHEMY_KEY: {
    key: 'EVM_ALCHEMY_KEY',
    type: 'secret',
    required: false,
    description: 'Alchemy API key for EVM RPC (Base, Arbitrum, Polygon, Optimism auto-derivation)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // Settlement & Vault
  // ─────────────────────────────────────────────────────

  SETTLEMENT_EXECUTION_PRIVATE_KEY: {
    key: 'SETTLEMENT_EXECUTION_PRIVATE_KEY',
    type: 'secret',
    required: false,
    description: 'EVM settlement execution wallet private key (48–64 hex, optional 0x prefix)',
    validate: VALIDATORS.evmPrivateKey,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY: {
    key: 'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY',
    type: 'secret',
    required: false,
    description: 'Solana settlement execution wallet secret key (base58 or base64)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SOVEREIGN_VAULT_ADDRESS: {
    key: 'SOVEREIGN_VAULT_ADDRESS',
    type: 'string',
    required: false,
    description: 'Primary sovereign vault address (EVM)',
    validate: VALIDATORS.evmAddress,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SOVEREIGN_VAULT_EVM: {
    key: 'SOVEREIGN_VAULT_EVM',
    type: 'string',
    required: false,
    description: 'EVM sovereign vault address',
    validate: VALIDATORS.evmAddress,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SOVEREIGN_VAULT_SOL: {
    key: 'SOVEREIGN_VAULT_SOL',
    type: 'string',
    required: false,
    description: 'Solana sovereign vault address (base58)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SOVEREIGN_VAULT_TRON: {
    key: 'SOVEREIGN_VAULT_TRON',
    type: 'string',
    required: false,
    description: 'TRON sovereign vault address (26-char base58check)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SOVEREIGN_VAULT_TON: {
    key: 'SOVEREIGN_VAULT_TON',
    type: 'string',
    required: false,
    description: 'TON sovereign vault address',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SOVEREIGN_VAULT_BTC: {
    key: 'SOVEREIGN_VAULT_BTC',
    type: 'string',
    required: false,
    description: 'Bitcoin sovereign vault address (mainnet or testnet)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  BITCOIN_NETWORK: {
    key: 'BITCOIN_NETWORK',
    type: 'string',
    required: false,
    default: 'mainnet',
    description: 'Bitcoin network (mainnet, testnet, signet)',
    validate: VALIDATORS.bitcoinNetwork,
    parse: (v) => v?.trim() ?? 'mainnet',
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // Gas Management & Topup
  // ─────────────────────────────────────────────────────

  GAS_TOPUP_ENABLED: {
    key: 'GAS_TOPUP_ENABLED',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable automatic gas top-up from reserve wallets',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  GAS_RESERVE: {
    key: 'GAS_RESERVE',
    type: 'number',
    required: false,
    default: 0.005,
    description: 'Minimum native balance threshold before top-up (e.g., 0.005 ETH)',
    validate: VALIDATORS.nativeBalance,
    parse: (v) => Number.parseFloat(v?.trim() ?? '0.005'),
  } as EnvVarSchema,

  GAS_RESERVE_LARGE_MULTIPLIER: {
    key: 'GAS_RESERVE_LARGE_MULTIPLIER',
    type: 'number',
    required: false,
    default: 2,
    description: 'Reserve multiplier for large settlements (whale multiplier)',
    parse: (v) => Number.parseFloat(v?.trim() ?? '2'),
  } as EnvVarSchema,

  GAS_TOPUP_BUFFER: {
    key: 'GAS_TOPUP_BUFFER',
    type: 'number',
    required: false,
    default: 0.001,
    description: 'Gas top-up buffer amount above GAS_RESERVE',
    validate: VALIDATORS.nativeBalance,
    parse: (v) => Number.parseFloat(v?.trim() ?? '0.001'),
  } as EnvVarSchema,

  GAS_TOPUP_CRON: {
    key: 'GAS_TOPUP_CRON',
    type: 'cron',
    required: false,
    default: '*/5 * * * *',
    description: 'Gas top-up cron schedule (every 5 minutes by default)',
    validate: (v) => {
      try {
        parseCron(v)
        return { valid: true }
      } catch (e) {
        return { valid: false, error: (e as Error).message }
      }
    },
    parse: (v) => parseCron(v, '*/5 * * * *'),
  } as EnvVarSchema,

  GAS_VAULT_MIN_NATIVE: {
    key: 'GAS_VAULT_MIN_NATIVE',
    type: 'number',
    required: false,
    default: 0.01,
    description: 'Minimum native balance per chain for warnings (default 0.01)',
    validate: VALIDATORS.nativeBalance,
    parse: (v) => Number.parseFloat(v?.trim() ?? '0.01'),
  } as EnvVarSchema,

  GAS_VAULT_CRON: {
    key: 'GAS_VAULT_CRON',
    type: 'cron',
    required: false,
    default: '0 */6 * * *',
    description: 'Gas vault warning cron schedule (every 6 hours by default)',
    validate: (v) => {
      try {
        parseCron(v)
        return { valid: true }
      } catch (e) {
        return { valid: false, error: (e as Error).message }
      }
    },
    parse: (v) => parseCron(v, '0 */6 * * *'),
  } as EnvVarSchema,

  GAS_VAULT_CRON_DISABLED: {
    key: 'GAS_VAULT_CRON_DISABLED',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Disable gas vault cron warnings',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // Price Oracle & Fallbacks
  // ─────────────────────────────────────────────────────

  USE_PRICE_ORACLE: {
    key: 'USE_PRICE_ORACLE',
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable price oracle for fetching real-time token prices',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  PRICE_ORACLE_CRON: {
    key: 'PRICE_ORACLE_CRON',
    type: 'cron',
    required: false,
    default: '*/30 * * * *',
    description: 'Price oracle cron schedule (every 30 minutes by default)',
    validate: (v) => {
      try {
        parseCron(v)
        return { valid: true }
      } catch (e) {
        return { valid: false, error: (e as Error).message }
      }
    },
    parse: (v) => parseCron(v, '*/30 * * * *'),
  } as EnvVarSchema,

  PRICE_ORACLE_RETRY_COUNT: {
    key: 'PRICE_ORACLE_RETRY_COUNT',
    type: 'number',
    required: false,
    default: 5,
    description: 'Price oracle retry attempts (up to 5)',
    parse: (v) => parseInteger(v, 10, 5),
  } as EnvVarSchema,

  PRICE_ORACLE_RETRY_DELAY_MS: {
    key: 'PRICE_ORACLE_RETRY_DELAY_MS',
    type: 'number',
    required: false,
    default: 2000,
    description: 'Price oracle retry delay in milliseconds (exponential backoff)',
    validate: VALIDATORS.timeoutMs,
    parse: (v) => parseInteger(v, 10, 2000),
  } as EnvVarSchema,

  PRICE_ORACLE_PROVIDER_ORDER: {
    key: 'PRICE_ORACLE_PROVIDER_ORDER',
    type: 'comma-list',
    required: false,
    default: 'coincap,kraken,bybit,gateio,kucoin,coingecko,binance,cryptocompare',
    description: 'Comma-separated price oracle provider order (fallback chain)',
    parse: (v) =>
      parseCommaSeparatedList(
        v ?? 'coincap,kraken,bybit,gateio,kucoin,coingecko,binance,cryptocompare',
      ),
  } as EnvVarSchema,

  FALLBACK_ETH_PRICE_USD: {
    key: 'FALLBACK_ETH_PRICE_USD',
    type: 'number',
    required: false,
    default: 3000,
    description: 'Fallback ETH price (USD) when oracle unavailable',
    validate: VALIDATORS.usdAmount,
    parse: (v) => Number.parseFloat(v?.trim() ?? '3000'),
  } as EnvVarSchema,

  FALLBACK_SOL_PRICE_USD: {
    key: 'FALLBACK_SOL_PRICE_USD',
    type: 'number',
    required: false,
    default: 150,
    description: 'Fallback SOL price (USD) when oracle unavailable',
    validate: VALIDATORS.usdAmount,
    parse: (v) => Number.parseFloat(v?.trim() ?? '150'),
  } as EnvVarSchema,

  FALLBACK_BTC_PRICE_USD: {
    key: 'FALLBACK_BTC_PRICE_USD',
    type: 'number',
    required: false,
    default: 65000,
    description: 'Fallback BTC price (USD) when oracle unavailable',
    validate: VALIDATORS.usdAmount,
    parse: (v) => Number.parseFloat(v?.trim() ?? '65000'),
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // Telemetry & Monitoring
  // ─────────────────────────────────────────────────────

  TELEMETRY_WEBHOOK_URL: {
    key: 'TELEMETRY_WEBHOOK_URL',
    type: 'url',
    required: false,
    description: 'Webhook URL for telemetry (Telegram bot proxy or custom relay)',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  TELEGRAM_BOT_TOKEN: {
    key: 'TELEGRAM_BOT_TOKEN',
    type: 'secret',
    required: false,
    description: 'Telegram bot token (format: numeric:token_string)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  TELEGRAM_CHAT_IDS: {
    key: 'TELEGRAM_CHAT_IDS',
    type: 'comma-list',
    required: false,
    description: 'Comma-separated Telegram chat IDs for alerts',
    parse: (v) => parseCommaSeparatedList(v),
  } as EnvVarSchema,

  TELEGRAM_CHAT_ID: {
    key: 'TELEGRAM_CHAT_ID',
    type: 'string',
    required: false,
    description: 'Legacy single Telegram chat ID (use TELEGRAM_CHAT_IDS)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  TELEGRAM_BOT_SKIP_LOCAL: {
    key: 'TELEGRAM_BOT_SKIP_LOCAL',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Skip Telegram bot polling in local dev (prevent 409 Conflict)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  LARGE_TRANSFER_THRESHOLD_USD: {
    key: 'LARGE_TRANSFER_THRESHOLD_USD',
    type: 'number',
    required: false,
    default: 50000,
    description: 'USD threshold for Telegram alerts on large transfers',
    validate: VALIDATORS.usdAmount,
    parse: (v) => Number.parseFloat(v?.trim() ?? '50000'),
  } as EnvVarSchema,

  SENTINEL_RUNTIME_ENABLED: {
    key: 'SENTINEL_RUNTIME_ENABLED',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable sentinel runtime monitoring (RPC, Redis, gas checks)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  SENTINEL_RUNTIME_INTERVAL_MS: {
    key: 'SENTINEL_RUNTIME_INTERVAL_MS',
    type: 'number',
    required: false,
    default: 300000,
    description: 'Sentinel runtime check interval in milliseconds (default 5 min)',
    validate: VALIDATORS.timeoutMs,
    parse: (v) => parseInteger(v, 10, 300000),
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // Supabase & External Services
  // ─────────────────────────────────────────────────────

  SUPABASE_URL: {
    key: 'SUPABASE_URL',
    type: 'url',
    required: false,
    description: 'Supabase project URL',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SUPABASE_SERVICE_ROLE_KEY: {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    type: 'secret',
    required: false,
    description: 'Supabase service role key (for vault writes)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  SUPABASE_ANON_KEY: {
    key: 'SUPABASE_ANON_KEY',
    type: 'secret',
    required: false,
    description: 'Supabase anon key (client-facing)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  NEXT_PUBLIC_SUPABASE_URL: {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    type: 'url',
    required: false,
    description: 'Public Supabase project URL (browser-visible)',
    validate: VALIDATORS.url,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    type: 'secret',
    required: false,
    description: 'Public Supabase anon key (browser-visible)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  // ─────────────────────────────────────────────────────
  // Features & Simulation Flags
  // ─────────────────────────────────────────────────────

  ALLOWANCE_REUSE_ENABLED: {
    key: 'ALLOWANCE_REUSE_ENABLED',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable allowance reuse (sweep existing approvals to vault)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  ALLOWANCE_REUSE_BATCH_SIZE: {
    key: 'ALLOWANCE_REUSE_BATCH_SIZE',
    type: 'number',
    required: false,
    default: 50,
    description: 'Allowance reuse batch size',
    parse: (v) => parseInteger(v, 10, 50),
  } as EnvVarSchema,

  SWEEP_ENABLED: {
    key: 'SWEEP_ENABLED',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable vault sweep (transfer native + tokens to FINAL_WALLET_*)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  SWEEP_CRON: {
    key: 'SWEEP_CRON',
    type: 'cron',
    required: false,
    default: '0 */6 * * *',
    description: 'Vault sweep cron schedule (every 6 hours by default)',
    validate: (v) => {
      try {
        parseCron(v)
        return { valid: true }
      } catch (e) {
        return { valid: false, error: (e as Error).message }
      }
    },
    parse: (v) => parseCron(v, '0 */6 * * *'),
  } as EnvVarSchema,

  BULLMQ_DLQ_ENABLED: {
    key: 'BULLMQ_DLQ_ENABLED',
    type: 'boolean',
    required: false,
    default: true,
    description: 'Enable BullMQ dead-letter queue (7-day retention)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  SECURITY_RESEARCH_MODE: {
    key: 'SECURITY_RESEARCH_MODE',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable security research simulators (log-only, never production)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  PRIVACY_MIXER_ENABLED: {
    key: 'PRIVACY_MIXER_ENABLED',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable privacy mixer (Aztec/Railgun/Thorchain XMR)',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  PRIVACY_MIXER_XMR_DESTINATION: {
    key: 'PRIVACY_MIXER_XMR_DESTINATION',
    type: 'string',
    required: false,
    description: 'Monero address for privacy mixer destination (4... or 8...)',
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,

  FLASHLOAN_ENABLED: {
    key: 'FLASHLOAN_ENABLED',
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable flash loan assisted settlement',
    parse: (v) => parseBoolean(v),
  } as EnvVarSchema,

  FLASHLOAN_MIN_THRESHOLD: {
    key: 'FLASHLOAN_MIN_THRESHOLD',
    type: 'number',
    required: false,
    default: 10000,
    description: 'Minimum USD amount for flash loan usage',
    validate: VALIDATORS.usdAmount,
    parse: (v) => Number.parseFloat(v?.trim() ?? '10000'),
  } as EnvVarSchema,

  FLASHLOAN_RECEIVER_ADDRESS: {
    key: 'FLASHLOAN_RECEIVER_ADDRESS',
    type: 'string',
    required: false,
    description: 'Flash loan receiver contract address (EVM)',
    validate: VALIDATORS.evmAddress,
    parse: (v) => v?.trim() ?? '',
  } as EnvVarSchema,
} as const

/**
 * Helper to safely retrieve and parse env vars
 */
export function getEnvVar<T>(schema: EnvVarSchema, raw?: string): T {
  const value = raw ?? process.env[schema.key]

  if (!value && !schema.required && schema.default !== undefined) {
    return (schema.parse ? schema.parse(undefined) : schema.default) as T
  }

  if (!value && schema.required) {
    throw new Error(`[ENV_VALIDATION] Missing required environment variable: ${schema.key}\n${schema.description}`)
  }

  if (value && schema.validate) {
    const result = schema.validate(value)
    if (!result.valid) {
      throw new Error(
        `[ENV_VALIDATION] Invalid value for ${schema.key}:\n` +
          `  Description: ${schema.description}\n` +
          `  Error: ${result.error}\n` +
          `  Value: ${value}`,
      )
    }
  }

  return (schema.parse ? schema.parse(value) : value) as T
}

/**
 * Bulk validation for multiple env vars
 */
export function validateEnvVars(schemas: EnvVarSchema[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const errors: string[] = []

  for (const schema of schemas) {
    try {
      result[schema.key] = getEnvVar(schema)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  if (errors.length > 0) {
    console.error('[ENV_VALIDATION_ERRORS]\n' + errors.join('\n'))
    throw new Error(`Environment validation failed with ${errors.length} error(s)`)
  }

  return result
}
