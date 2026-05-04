/**
 * @file shadow-aes-key.ts
 * @module @legion/core/security
 * @sentinel Shadow + Gatekeeper
 *
 * Shared AES-256 key material for Shadow-class envelopes (SHADOW-VAULT-03).
 * Used by ShadowStore disk vault and Signature Anchor persistence (Supabase).
 */

import { createHash } from 'crypto'

function emitShadowWarn(msg: string): void {
  process.stdout.write(
    JSON.stringify({
      level: 40,
      time: Date.now(),
      msg,
      sentinel: 'Shadow',
      module: 'security/shadow-aes-key',
    }) + '\n',
  )
}

/**
 * 32-byte AES-256 key: SHADOW_VAULT_KEY (hex 64) or SHA-256(GATEKEEPER_SECRET).
 * Mirrors shadow-store SHADOW-VAULT-03 / SHADOW-VAULT-02 consumers.
 */
export function getShadowAes256KeyFromEnv(): Buffer {
  const explicit = process.env['SHADOW_VAULT_KEY']
  if (explicit && explicit.length === 64) {
    try {
      return Buffer.from(explicit, 'hex')
    } catch {
      /* fall through */
    }
  }

  const secret =
    process.env['GATEKEEPER_SECRET'] ?? 'legion-shadow-default-DO-NOT-USE-IN-PROD'
  if (!process.env['GATEKEEPER_SECRET']) {
    emitShadowWarn(
      'SHADOW_VAULT_KEY and GATEKEEPER_SECRET absent — using unsafe derivation fallback. Set SHADOW_VAULT_KEY (64 hex chars) for production Signature Anchor encryption.',
    )
  }
  return createHash('sha256').update(secret, 'utf8').digest()
}
