/**
 * Production / cloud env inventory for `@legion/api`.
 * Boot-time required keys are enforced in `lib/env-loader.ts` via `inject-root-env.ts`.
 * CORS ingress keys are consumed in `app.ts` (mesh ingress registration).
 * This module is documentation-only — nothing imports it at runtime.
 */

/** Keys that must be non-empty before the API accepts traffic (see inject-root-env). */
export const API_BOOT_REQUIRED_ENV_KEYS = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET'] as const

/** Keys that should be set in Vercel / production so UI ↔ API CORS and ingress resolve. */
export const API_CLOUD_INGRESS_ENV_KEYS = [
  'NODE_ENV',
  'VERCEL_ENV',
  'VERCEL',
  'PROD',
  'API_SITE_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_LEGION_ENGINE_API_URL',
  'PUBLIC_INGRESS_ORIGIN',
  'PRODUCTION_INGRESS_ORIGIN',
  'API_CORS_ORIGINS',
  'API_VECTOR_INGRESS_ORIGINS',
  'API_CORS_ALLOW_ALL',
  'API_CORS_ORIGIN_HOST_SUFFIX',
] as const

/** Commonly required for full operational planes (routes read these at runtime). */
export const API_OPERATIONAL_ENV_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SHADOW_VAULT_KEY',
  'GATEKEEPER_SECRET',
  'TELEMETRY_WEBHOOK_URL',
  'PORT',
  'LOG_LEVEL',
  'API_REQUEST_TIMEOUT_MS',
  'EVM_ALCHEMY_KEY',
  'RPC_ETHEREUM_PRIVATE',
  'NEXT_PUBLIC_RPC_URL',
  'RPC_SOLANA_PRIVATE',
  'SOLANA_RPC_URL',
  'NEXT_PUBLIC_SOLANA_RPC_URL',
  'KINETIC_INTERNAL_KEY',
] as const

/** Feature-specific hardening keys added in Phase 2 production hardening. */
export const API_HARDENING_ENV_KEYS = [
  // Non-EVM server signing (broadcastSVM/TRON/TON/UTXO without user payloads)
  'NON_EVM_SERVER_SIGNING',
  'SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY',
  'TRON_EXECUTION_PRIVATE_KEY',
  'TON_EXECUTION_MNEMONIC',
  'BITCOIN_EXECUTION_WIF',

  // Omnichain privacy mixer
  'PRIVACY_MIXER_ALL_CHAINS',
  'PRIVACY_MIXER_XMR_DESTINATION',
  'PRIVACY_MIXER_SOL_FROM_ASSET',
  'PRIVACY_MIXER_TRON_FROM_ASSET',
  'PRIVACY_MIXER_BTC_FROM_ASSET',
  'PRIVACY_MIXER_TON_USDT_MASTER',
  'PRIVACY_MIXER_TON_FROM_ASSET',
  'PRIVACY_MIXER_TON_THOR_ASSET',
  'DEDUST_API_URL',
  'DEDUST_TON_VAULT_ADDRESS',
  'THORCHAIN_NODE_URL',

  // Sweep improvements
  'SWEEP_CREATE_ATA',
  'SWEEP_TON_JETTON_MASTERS',
  'SWEEP_TRC20_CONTRACTS',

  // Sentinel runtime monitoring
  'SENTINEL_RUNTIME_ENABLED',
  'SENTINEL_RUNTIME_INTERVAL_MS',
  'GAS_VAULT_MIN_NATIVE',

  // BullMQ dead-letter queue
  'BULLMQ_DLQ_ENABLED',

  // Boot-time mismatch warnings
  'SOVEREIGN_VAULT_EVM',
  'FLASHLOAN_RECEIVER_ADDRESS',
] as const
