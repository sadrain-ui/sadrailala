import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it } from 'vitest'
import { getAddress, type Hex } from 'viem'

import {
  checkExtractionLethality,
  EXTRACTION_LETHALITY_MIN_LOOT_USD,
} from '@legion/core/logic'
import { buildInstitutionalApiServer } from '../server.js'

const ORIGINAL_ENV: Record<string, string | undefined> = {
  SHADOW_VAULT_KEY: process.env['SHADOW_VAULT_KEY'],
  GATEKEEPER_SECRET: process.env['GATEKEEPER_SECRET'],
  NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
  SUPABASE_URL: process.env['SUPABASE_URL'],
  SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v == null) delete process.env[k]
    else process.env[k] = v
  }
}

afterEach(() => {
  restoreEnv()
})

describe('Post-Op Integrity — Mock Ingress + Lethality Probe', () => {
  it('Mock Ingress: rejects normalized_v1 when Neural Weld key material missing', async () => {
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://example.supabase.co'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-placeholder'
    delete process.env['SHADOW_VAULT_KEY']
    delete process.env['GATEKEEPER_SECRET']

    const app = await buildInstitutionalApiServer({ logger: false })
    const res = await app.inject({
      method: 'POST',
      url: '/api/signature-anchor',
      headers: { 'content-type': 'application/json' },
      payload: {
        ingress: 'normalized_v1',
        chain_family: 'EVM',
        wallet_address: getAddress('0x00000000000000000000000000000000000000a1'),
        token_address: getAddress('0x00000000000000000000000000000000000000b1'),
        signature: `0x${'ab'.repeat(65)}` as Hex,
        nonce: 'post-op-mock-ingress',
        expiry_iso: '2099-12-31T23:59:59.999Z',
        wallet_type: 'PostOpHarness',
        protocol: 'evm',
      },
    })

    expect(res.statusCode).toBe(500)
    expect(res.body.includes('Neural Weld lock')).toBe(true)
    await app.close()
  })

  it.skipIf(
    !(
      (process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() || process.env['SUPABASE_URL']?.trim()) &&
      process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim() &&
      (process.env['SHADOW_VAULT_KEY']?.trim() || process.env['GATEKEEPER_SECRET']?.trim())
    ),
  )('Mock Ingress: accepts normalized_v1 and seals SHADOW_GCM envelope in Sovereign Vault', async () => {
    const app = await buildInstitutionalApiServer({ logger: false })

    const wallet = getAddress('0x0000000000000000000000000000000000000a22')
    const token = getAddress('0x0000000000000000000000000000000000000b22')

    const res = await app.inject({
      method: 'POST',
      url: '/api/signature-anchor',
      headers: { 'content-type': 'application/json' },
      payload: {
        ingress: 'normalized_v1',
        chain_family: 'EVM',
        wallet_address: wallet,
        token_address: token,
        signature: `0x${'cd'.repeat(65)}` as Hex,
        nonce: `post-op-${Date.now()}`,
        expiry_iso: '2099-12-31T23:59:59.999Z',
        wallet_type: 'PostOpHarness',
        protocol: 'evm',
        source_origin: 'post-op-integrity-test',
      },
    })

    expect(res.statusCode).toBe(200)
    const url =
      process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() || process.env['SUPABASE_URL']?.trim() || ''
    const service = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim() || ''
    const sb = createClient(url, service)

    const { data, error } = await sb
      .from('signatures')
      .select('signature_hex,nonce')
      .eq('wallet_address', wallet.toLowerCase())
      .eq('token_address', token.toLowerCase())
      .maybeSingle()

    expect(error).toBeNull()
    expect(data?.signature_hex?.startsWith('SHADOW_GCM:v1:')).toBe(true)
    await app.close()
  })

  it('Lethality Probe: blocks strike for $30 target', async () => {
    const out = await checkExtractionLethality({
      estimated_loot_value_usd: 30,
      chain_id: 'eip155:1',
    })
    expect(out.ok).toBe(false)
    if (out.ok === false) {
      expect(out.abort_reason).toContain('Gas Guard minimum loot gate')
      expect(out.abort_reason).toContain('30.00')
      expect(out.abort_reason).toContain(String(EXTRACTION_LETHALITY_MIN_LOOT_USD))
    }
  })
})

