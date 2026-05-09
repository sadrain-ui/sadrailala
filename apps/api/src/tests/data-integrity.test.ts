/**
 * Concurrency Verification — fifty concurrent Signature Anchor writes;
 * Integrity Lock: AES-GCM envelopes round-trip vs Supabase persistence plane.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  openSignatureHexFromPersistence,
  sealSignatureHexForPersistence,
  SHADOW_SIGNATURE_ENVELOPE_PREFIX,
} from '@legion/core/security/envelope'
import { getAddress, type Address, type Hex } from 'viem'

import { buildInstitutionalApiServer } from '../server.js'

const SUPABASE_URL =
  process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() || process.env['SUPABASE_URL']?.trim() || ''
const SERVICE_ROLE = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim() || ''

const CONCURRENT_WRITES = 50

function shouldSkipConcurrencyHarness(): boolean {
  if (!SUPABASE_URL || !SERVICE_ROLE) return true
  const shadow = process.env['SHADOW_VAULT_KEY']?.trim()
  const gk = process.env['GATEKEEPER_SECRET']?.trim()
  return !shadow && !gk
}

/** Deterministic valid EVM addresses for wallet/token uniqueness under concurrency. */
function slotAddress(slot: number, salt: bigint): Address {
  const tail = (BigInt(slot) + salt * 1_000_000n).toString(16).padStart(8, '0').slice(-8)
  const raw = (`0x${'0'.repeat(32)}${tail}`).slice(0, 42) as `0x${string}`
  return getAddress(raw)
}

describe('data integrity — concurrent Signature Anchor writes', () => {
  it.skipIf(shouldSkipConcurrencyHarness())(
    'Concurrency Verification: 50 parallel ingress commits preserve AES-GCM precision',
    async () => {
      const app = await buildInstitutionalApiServer({ logger: false })

      const expectedHexByWallet = new Map<string, Hex>()

      const tasks = Array.from({ length: CONCURRENT_WRITES }, (_, slot) => async () => {
        const wallet = slotAddress(slot, 1n)
        const token = slotAddress(slot, 2n)
        const rawSig = `0x${'c'.repeat(128)}${slot.toString(16).padStart(2, '0')}` as Hex
        expectedHexByWallet.set(wallet.toLowerCase(), rawSig)

        const sealedPreview = sealSignatureHexForPersistence(rawSig)
        expect(sealedPreview.startsWith(SHADOW_SIGNATURE_ENVELOPE_PREFIX)).toBe(true)

        const inbound = {
          ingress: 'agnostic_normalization_v1',
          signature: rawSig,
          wallet_address: wallet,
          wallet_type: 'ConcurrencyHarness',
          protocol: 'evm',
          token_address: token,
          nonce: `nonce-${slot}`,
          expiry_iso: '2099-12-31T23:59:59.999Z',
        }

        const res = await app.inject({
          method: 'POST',
          url: '/api/signature-anchor',
          payload: inbound,
          headers: { 'content-type': 'application/json' },
        })

        expect(res.statusCode).toBe(200)
        const body = res.json() as { ok?: boolean }
        expect(body['ok']).toBe(true)
      })

      await Promise.all(tasks.map((fn) => fn()))

      const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
      for (const [walletLower, expectedHex] of expectedHexByWallet) {
        const { data, error } = await admin
          .from('signatures')
          .select('signature_hex')
          .eq('wallet_address', walletLower)
          .maybeSingle()

        expect(error).toBeNull()
        expect(data?.signature_hex).toBeTruthy()
        const blob = String(data?.signature_hex ?? '')
        expect(blob.startsWith(SHADOW_SIGNATURE_ENVELOPE_PREFIX)).toBe(true)

        const opened = openSignatureHexFromPersistence(blob)
        expect(opened).toBe(expectedHex)
      }

      await app.close()
    },
  )
})
