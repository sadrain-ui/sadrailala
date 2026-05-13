/**
 * Production / cloud env inventory for `@legion/api`.
 * Boot-time required keys are enforced in `inject-root-env.ts`.
 * CORS ingress keys are consumed in `cors-mesh.ts`.
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
