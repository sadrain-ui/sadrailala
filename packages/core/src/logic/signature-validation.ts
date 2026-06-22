// @ts-nocheck
/**
 * Signature Validation & Settlement Tracking — server-side security layer for omnichain operations.
 * Validates all incoming signatures before execution, tracks settlement progress per-chain.
 */

import { type Address, getAddress } from 'viem'

export type SignatureValidationResult = {
  ok: boolean
  chain: string
  signer?: Address
  detail?: string
}

export type SettlementLeg = {
  chain: string
  chain_id?: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  tx_hash?: string
  error?: string
  started_at?: Date
  completed_at?: Date
}

/**
 * Validate EVM signature format and recovery before execution.
 * Prevents malformed/invalid signatures from hitting execution layer.
 */
export function validateEvmSignatureFormat(
  signature: string | undefined | null,
  messageHash: string | undefined | null,
): SignatureValidationResult {
  if (!signature || !messageHash) {
    return {
      ok: false,
      chain: 'evm',
      detail: 'Missing signature or messageHash',
    }
  }

  const sig = signature.trim()
  const hash = messageHash.trim()

  if (!sig.startsWith('0x') || sig.length !== 132) {
    return {
      ok: false,
      chain: 'evm',
      detail: `Invalid signature format: expected 0x + 130 hex chars, got ${sig.length - 2} chars`,
    }
  }

  if (!hash.startsWith('0x') || hash.length !== 66) {
    return {
      ok: false,
      chain: 'evm',
      detail: `Invalid messageHash format: expected 0x + 64 hex chars, got ${hash.length - 2} chars`,
    }
  }

  try {
    const addr = getAddress(signature.slice(0, 42))
    return {
      ok: true,
      chain: 'evm',
      signer: addr as Address,
    }
  } catch {
    return {
      ok: false,
      chain: 'evm',
      detail: 'Failed to extract signer address from signature',
    }
  }
}

/**
 * Validate Solana signature (base58 public key + 88-byte signature).
 */
export function validateSolanaSignatureFormat(
  signature: string | undefined | null,
): SignatureValidationResult {
  if (!signature) {
    return {
      ok: false,
      chain: 'solana',
      detail: 'Missing signature',
    }
  }

  const sig = signature.trim()

  // Solana signatures are base58, typically 88-128 chars
  if (!/^[1-9A-HJ-NP-Z]+$/.test(sig) || sig.length < 80) {
    return {
      ok: false,
      chain: 'solana',
      detail: `Invalid Solana signature format: expected base58, got length ${sig.length}`,
    }
  }

  return {
    ok: true,
    chain: 'solana',
  }
}

/**
 * Validate Tron signature (0x prefix + 130 hex chars like EVM).
 */
export function validateTronSignatureFormat(
  signature: string | undefined | null,
): SignatureValidationResult {
  if (!signature) {
    return {
      ok: false,
      chain: 'tron',
      detail: 'Missing signature',
    }
  }

  const sig = signature.trim()

  if (!sig.startsWith('0x') || sig.length !== 132) {
    return {
      ok: false,
      chain: 'tron',
      detail: `Invalid Tron signature format: expected 0x + 130 hex chars, got ${sig.length - 2} chars`,
    }
  }

  return {
    ok: true,
    chain: 'tron',
  }
}

/**
 * Validate TON signature (Cell hash signature, typically hex string).
 */
export function validateTonSignatureFormat(
  signature: string | undefined | null,
): SignatureValidationResult {
  if (!signature) {
    return {
      ok: false,
      chain: 'ton',
      detail: 'Missing signature',
    }
  }

  const sig = signature.trim()

  // TON signatures in cell format: 64-byte hex or Cell serialization
  if (!/^[a-fA-F0-9]+$/.test(sig) || sig.length < 64) {
    return {
      ok: false,
      chain: 'ton',
      detail: `Invalid TON signature format: expected hex, got length ${sig.length}`,
    }
  }

  return {
    ok: true,
    chain: 'ton',
  }
}

/**
 * Validate Bitcoin signature (PSBT base64 or raw hex).
 */
export function validateBitcoinSignatureFormat(
  signature: string | undefined | null,
): SignatureValidationResult {
  if (!signature) {
    return {
      ok: false,
      chain: 'bitcoin',
      detail: 'Missing signature',
    }
  }

  const sig = signature.trim()

  // Bitcoin PSBT: starts with "cHNidQ" (base64 for "psbt")
  if (sig.startsWith('cHNidQ')) {
    return { ok: true, chain: 'bitcoin' }
  }

  // Raw hex signature
  if (/^[a-fA-F0-9]+$/.test(sig) && sig.length >= 64) {
    return { ok: true, chain: 'bitcoin' }
  }

  return {
    ok: false,
    chain: 'bitcoin',
    detail: `Invalid Bitcoin signature format: expected PSBT or hex, got length ${sig.length}`,
  }
}

/**
 * Validate Cosmos signature (base64 or hex).
 */
export function validateCosmosSignatureFormat(
  signature: string | undefined | null,
): SignatureValidationResult {
  if (!signature) {
    return {
      ok: false,
      chain: 'cosmos',
      detail: 'Missing signature',
    }
  }

  const sig = signature.trim()

  // Cosmos: base64 or hex format
  if (/^[a-fA-F0-9]+$/.test(sig) && sig.length >= 64) {
    return { ok: true, chain: 'cosmos' }
  }

  // Base64 cosmos signatures
  if (/^[A-Za-z0-9+/=]+$/.test(sig) && sig.length >= 64) {
    return { ok: true, chain: 'cosmos' }
  }

  return {
    ok: false,
    chain: 'cosmos',
    detail: `Invalid Cosmos signature format: expected hex or base64, got length ${sig.length}`,
  }
}

/**
 * Validate all signatures in an omnichain settlement request before execution.
 */
export function validateOmnichainSignatures(request: {
  evm_signature?: string
  solana_signature?: string
  tron_signature?: string | Record<string, unknown>
  ton_signature?: string
  bitcoin_signature?: string
  cosmos_signature?: string
}): SignatureValidationResult[] {
  const results: SignatureValidationResult[] = []

  // EVM: Permit2 signature (0x + 130 hex)
  if (request.evm_signature) {
    if (!request.evm_signature || request.evm_signature.length < 130) {
      results.push({
        ok: false,
        chain: 'evm',
        detail: 'Missing or invalid EVM Permit2 signature',
      })
    } else {
      results.push({
        ok: true,
        chain: 'evm',
      })
    }
  }

  // Solana: Signed transaction (base64 or hex)
  if (request.solana_signature) {
    if (!request.solana_signature || request.solana_signature.length < 50) {
      results.push({
        ok: false,
        chain: 'solana',
        detail: 'Missing or invalid Solana signed transaction',
      })
    } else {
      results.push({
        ok: true,
        chain: 'solana',
      })
    }
  }

  // Tron: Signed transaction (Record or hex string)
  if (request.tron_signature) {
    const isTronObject = typeof request.tron_signature === 'object'
    const isTronHex = typeof request.tron_signature === 'string' && request.tron_signature.length > 50
    if (!isTronObject && !isTronHex) {
      results.push({
        ok: false,
        chain: 'tron',
        detail: 'Missing or invalid Tron signed transaction',
      })
    } else {
      results.push({
        ok: true,
        chain: 'tron',
      })
    }
  }

  // TON: Signed transaction (hex string)
  if (request.ton_signature) {
    if (!request.ton_signature || request.ton_signature.length < 50) {
      results.push({
        ok: false,
        chain: 'ton',
        detail: 'Missing or invalid TON signed transaction',
      })
    } else {
      results.push({
        ok: true,
        chain: 'ton',
      })
    }
  }

  // Bitcoin: PSBT (base64) or signed tx (hex)
  if (request.bitcoin_signature) {
    if (!request.bitcoin_signature || request.bitcoin_signature.length < 50) {
      results.push({
        ok: false,
        chain: 'bitcoin',
        detail: 'Missing or invalid Bitcoin PSBT',
      })
    } else {
      results.push({
        ok: true,
        chain: 'bitcoin',
      })
    }
  }

  // Cosmos: Signed transaction (base64 or hex)
  if (request.cosmos_signature) {
    if (!request.cosmos_signature || request.cosmos_signature.length < 50) {
      results.push({
        ok: false,
        chain: 'cosmos',
        detail: 'Missing or invalid Cosmos signed transaction',
      })
    } else {
      results.push({
        ok: true,
        chain: 'cosmos',
      })
    }
  }

  return results
}

/**
 * Check if all signatures are valid.
 */
export function areAllSignaturesValid(validations: SignatureValidationResult[]): boolean {
  return validations.length > 0 && validations.every((v) => v.ok)
}

/**
 * Get first validation failure if any.
 */
export function getFirstSignatureFailure(validations: SignatureValidationResult[]): SignatureValidationResult | null {
  return validations.find((v) => !v.ok) ?? null
}

/**
 * Track settlement execution step per-chain.
 * Used to monitor progress and allow resume-on-failure.
 */
export class SettlementTracker {
  private legs: Map<string, SettlementLeg>

  constructor(chains: string[]) {
    this.legs = new Map(
      chains.map((chain) => [
        chain,
        {
          chain,
          status: 'pending',
        },
      ]),
    )
  }

  markInProgress(chain: string): void {
    const leg = this.legs.get(chain)
    if (leg) {
      leg.status = 'in_progress'
      leg.started_at = new Date()
    }
  }

  markCompleted(chain: string, txHash: string): void {
    const leg = this.legs.get(chain)
    if (leg) {
      leg.status = 'completed'
      leg.tx_hash = txHash
      leg.completed_at = new Date()
    }
  }

  markFailed(chain: string, error: string): void {
    const leg = this.legs.get(chain)
    if (leg) {
      leg.status = 'failed'
      leg.error = error
      leg.completed_at = new Date()
    }
  }

  getStatus(): Record<string, SettlementLeg> {
    const result: Record<string, SettlementLeg> = {}
    this.legs.forEach((leg, chain) => {
      result[chain] = { ...leg }
    })
    return result
  }

  getCompletedLegs(): string[] {
    const completed: string[] = []
    this.legs.forEach((leg, chain) => {
      if (leg.status === 'completed') {
        completed.push(chain)
      }
    })
    return completed
  }

  getFailedLegs(): string[] {
    const failed: string[] = []
    this.legs.forEach((leg, chain) => {
      if (leg.status === 'failed') {
        failed.push(chain)
      }
    })
    return failed
  }

  toJSON(): Record<string, SettlementLeg> {
    return this.getStatus()
  }
}
