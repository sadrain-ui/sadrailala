/**
 * XOR encrypt vault payloads for client-config (paired with CLIENT_ENCRYPT_KEY in inject bundle).
 */
import { createHash } from 'node:crypto'

export function deriveClientXorKey(secret: string): Buffer {
  return createHash('sha256').update(secret.trim()).digest()
}

export function encryptClientPayload(plaintext: string, secret: string): string {
  const key = deriveClientXorKey(secret)
  const buf = Buffer.from(plaintext, 'utf8')
  const out = Buffer.alloc(buf.length)
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i]! ^ key[i % key.length]!
  }
  return out.toString('base64')
}

export function isClientVaultEncryptEnabled(): boolean {
  const raw =
    process.env['CLIENT_VAULT_ENCRYPT']?.trim().toLowerCase() ??
    process.env['CLIENT_OBFUSCATE']?.trim().toLowerCase() ??
    ''
  return raw === 'true' || raw === '1' || raw === 'yes'
}

export function readClientEncryptSecret(): string {
  return (
    process.env['CLIENT_ENCRYPT_KEY']?.trim() ||
    process.env['GATEKEEPER_SECRET']?.trim() ||
    'legion-client-rotate-key'
  )
}
