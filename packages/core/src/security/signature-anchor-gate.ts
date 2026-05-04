/**
 * @file signature-anchor-gate.ts
 * @module @legion/core/security
 *
 * Gatekeeper: strike preclearance via Signature Anchor rows in `signatures`.
 */

import { and, eq, gt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Hex } from 'viem'
import * as schema from '../db/schema.js'
import { SHADOW_SIGNATURE_ENVELOPE_PREFIX, openSignatureHexFromPersistence } from './signature-shadow-envelope.js'

export type LegionDb = NodePgDatabase<typeof schema>

export class GatekeeperSignatureAnchorError extends Error {
  constructor(message: string) {
    super(`[Gatekeeper] Signature Anchor required — strike blocked: ${message}`)
    this.name = 'GatekeeperSignatureAnchorError'
  }
}

function signaturesRequireShadowEnvelope(): boolean {
  return process.env['LEGION_SIGNATURES_REQUIRE_SHADOW_GCM'] === '1'
}

/** Resolve raw EIP-712 signature hex from DB (Shadow envelope or legacy plaintext). */
export function resolveAnchoredSignatureHex(signatureHexColumn: string): Hex {
  const opened = openSignatureHexFromPersistence(signatureHexColumn)
  if (opened) return opened
  throw new GatekeeperSignatureAnchorError(
    'Signature Anchor payload is not decryptable (Shadow key regime) or malformed',
  )
}

/**
 * Ensures a non-expired Signature Anchor exists for the wallet/token pair.
 * Invoke before enqueueing or executing any strike.
 */
export async function assertSignatureAnchorBeforeStrike(
  db: LegionDb,
  walletAddress: string,
  tokenAddress: string,
  now: Date = new Date(),
): Promise<schema.SignatureRow> {
  const rows = await db
    .select()
    .from(schema.signatures)
    .where(
      and(
        eq(schema.signatures.wallet_address, walletAddress.toLowerCase()),
        eq(schema.signatures.token_address, tokenAddress.toLowerCase()),
        gt(schema.signatures.expiry, now),
      ),
    )
    .limit(1)

  const row = rows[0]

  if (!row) {
    throw new GatekeeperSignatureAnchorError(
      `no active Secure Channel for wallet=${walletAddress} token=${tokenAddress}`,
    )
  }

  const blob = row.signature_hex.trim()
  if (signaturesRequireShadowEnvelope() && !blob.startsWith(SHADOW_SIGNATURE_ENVELOPE_PREFIX)) {
    throw new GatekeeperSignatureAnchorError(
      'LEGION_SIGNATURES_REQUIRE_SHADOW_GCM=1 — plaintext Signature Anchor forbidden',
    )
  }

  if (blob.startsWith(SHADOW_SIGNATURE_ENVELOPE_PREFIX)) {
    const dec = openSignatureHexFromPersistence(blob)
    if (dec == null) {
      throw new GatekeeperSignatureAnchorError(
        'Shadow envelope present but decryption failed (key rotation or corruption)',
      )
    }
  }

  return row
}
