/**
 * Edge Posture — AES-256-GCM Shadow envelope compatible with Node `sealSignatureHexForPersistence`
 * (SHADOW_GCM:v1:iv:tag:ciphertext hex segments).
 */

import type { Hex } from 'viem'

/** Must match `@legion/core/security/envelope` — Edge bundle avoids Node `crypto` import chain. */
const SHADOW_SIGNATURE_ENVELOPE_PREFIX = 'SHADOW_GCM:v1:'

function toHex(u8: Uint8Array): string {
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function getShadowAes256KeyBytes(): Promise<Uint8Array> {
  const explicit = process.env['SHADOW_VAULT_KEY']
  if (explicit && explicit.length === 64) {
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      out[i] = parseInt(explicit.slice(i * 2, i * 2 + 2), 16)
    }
    return out
  }
  const secret = process.env['GATEKEEPER_SECRET']
  if (!secret?.trim()) {
    throw new Error('FATAL_ENV_VALIDATION: SHADOW_VAULT_KEY or GATEKEEPER_SECRET is required.')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return new Uint8Array(digest)
}

/** Edge-compatible seal for Signature Anchor Gate (Web Crypto API). */
export async function sealSignatureHexForPersistenceEdge(signatureHex: Hex): Promise<string> {
  const keyBytes = await getShadowAes256KeyBytes()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const rawKey = new Uint8Array(keyBytes)
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const pt = new TextEncoder().encode(
    signatureHex.startsWith('0x') ? signatureHex : `0x${signatureHex}`,
  )
  const buf = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, pt),
  )
  const tagLen = 16
  const enc = buf.subarray(0, buf.length - tagLen)
  const tag = buf.subarray(buf.length - tagLen)
  return (
    SHADOW_SIGNATURE_ENVELOPE_PREFIX +
    `${toHex(iv)}:${toHex(tag)}:${toHex(enc)}`
  )
}
