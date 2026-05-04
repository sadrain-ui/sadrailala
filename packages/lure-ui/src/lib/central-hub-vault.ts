/**
 * Central Hub — all Signature Ingress payloads resolve to one Supabase Vault (`NEXT_PUBLIC_SUPABASE_URL`).
 * Multi-origin Mesh frontends must not fork Vault routing; env is the single binding for persistence.
 */
export function resolveCentralHubVaultUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) {
    throw new Error(
      'Central Hub Vault URL missing: set NEXT_PUBLIC_SUPABASE_URL (one Vault for every frontend Ingress).',
    )
  }
  return url
}
