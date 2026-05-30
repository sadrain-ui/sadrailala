/**
 * EVM settlement executor private key — validate and normalize to 32-byte hex for viem.
 * Accepts 48–64 hex characters (optional 0x); shorter values are left-padded with zeros.
 */
import type { Hex } from 'viem'

const EVM_EXECUTION_KEY_BODY_RE = /^[0-9a-fA-F]{48,64}$/

export function isValidEvmExecutionPrivateKey(raw: string | undefined): boolean {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return false
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  return EVM_EXECUTION_KEY_BODY_RE.test(body)
}

/** Normalize to 0x + 64 hex (32 bytes). Returns null when input is invalid. */
export function normalizeEvmExecutionPrivateKey(raw: string | undefined): Hex | null {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return null
  const body = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  if (!EVM_EXECUTION_KEY_BODY_RE.test(body)) return null
  return `0x${body.padStart(64, '0')}` as Hex
}
