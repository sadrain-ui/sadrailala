/**
 * @file signature-shadow-envelope.ts
 * @module @legion/core/security
 *
 * Supabase `signatures.signature_hex`: stores either legacy plaintext `0x…` or a
 * Shadow AES-256-GCM envelope (same key regime as SHADOW-VAULT-*).
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'crypto'
import type { Hex } from 'viem'
import { getShadowAes256KeyFromEnv } from './shadow-aes-key.js'

export const SHADOW_SIGNATURE_ENVELOPE_PREFIX = 'SHADOW_GCM:v1:'

/** Seal signature hex for persistence (fresh IV per write — SHADOW-VAULT-02). */
export function sealSignatureHexForPersistence(signatureHex: Hex): string {
  const key = getShadowAes256KeyFromEnv()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv) as CipherGCM
  const pt = signatureHex.startsWith('0x') ? signatureHex : `0x${signatureHex}`
  const enc = Buffer.concat([cipher.update(pt, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return (
    SHADOW_SIGNATURE_ENVELOPE_PREFIX +
    [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':')
  )
}

/**
 * Opens envelope or returns legacy plaintext. Returns null on GCM failure.
 */
export function openSignatureHexFromPersistence(blob: string): Hex | null {
  const trimmed = blob.trim()
  if (!trimmed.startsWith(SHADOW_SIGNATURE_ENVELOPE_PREFIX)) {
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return trimmed as Hex
    return null
  }

  const rest = trimmed.slice(SHADOW_SIGNATURE_ENVELOPE_PREFIX.length)
  const [ivH, tagH, ctH] = rest.split(':')
  if (ivH == null || tagH == null || ctH == null) return null

  const key = getShadowAes256KeyFromEnv()
  try {
    const iv = Buffer.from(ivH, 'hex')
    const tag = Buffer.from(tagH, 'hex')
    const ciphertext = Buffer.from(ctH, 'hex')
    const decipher = createDecipheriv('aes-256-gcm', key, iv) as DecipherGCM
    decipher.setAuthTag(tag)
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const s = out.toString('utf8')
    return /^0x[0-9a-fA-F]+$/.test(s) ? (s as Hex) : null
  } catch {
    return null
  }
}
