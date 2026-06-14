/**
 * Tier-2 unit tests — scout schemas, settlement formatters, extended-chain gating, ops flags.
 */
import { describe, expect, it } from 'vitest'
import {
  buildOperatorFlagsSnapshot,
  findDisabledExtendedLegWarnings,
  isOperatorFlagEnabled,
  listOmnichainLegs,
  OPERATOR_FEATURE_FLAGS,
} from '@legion/core'
import {
  formatSettlementAmount,
  settlementStatusLabel,
  truncateWalletAddress,
} from '../lib/settlement-history.js'
import { scoutIngressBodySchema, rankedScoutBodySchema } from '../lib/schemas.js'

describe('scout ingress schemas', () => {
  it('accepts source_page and active_chain_tab', () => {
    const parsed = scoutIngressBodySchema.safeParse({
      user_address: '0xbe3cebae5728C07F39416f0dC1d0165d2972db12',
      chain_id: 1,
      chain_family: 'EVM',
      wallet_type: 'MetaMask',
      source_page: 'https://mirror.example.com/swap',
      active_chain_tab: 'evm',
      connected_wallets: ['evm', 'sol'],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.source_page).toContain('mirror.example.com')
      expect(parsed.data.active_chain_tab).toBe('evm')
    }
  })

  it('ranked scout schema accepts wallet fields', () => {
    const partial = rankedScoutBodySchema.safeParse({ chain_family: 'EVM' })
    expect(partial.success).toBe(true)
    const ok = rankedScoutBodySchema.safeParse({
      wallet_address: '0xbe3cebae5728C07F39416f0dC1d0165d2972db12',
      chain_family: 'EVM',
    })
    expect(ok.success).toBe(true)
  })
})

describe('settlement history formatters', () => {
  it('formats native ETH wei', () => {
    const label = formatSettlementAmount('1000000000000000', 'native', 'EVM')
    expect(label).toContain('ETH')
  })

  it('labels settlement status', () => {
    expect(settlementStatusLabel('settled')).toContain('Settled')
    expect(settlementStatusLabel('failed')).toContain('Failed')
    expect(settlementStatusLabel('partial')).toContain('Partial')
  })

  it('truncates long wallet addresses', () => {
    const short = truncateWalletAddress('0xbe3cebae5728C07F39416f0dC1d0165d2972db12')
    expect(short.length).toBeLessThan(20)
    expect(short).toContain('…')
  })
})

describe('extended-chain omnichain gating', () => {
  it('does not list cosmos leg when vault env unset', () => {
    const prev = process.env.VAULT_ADDRESS_COSMOS
    delete process.env.VAULT_ADDRESS_COSMOS
    delete process.env.SOVEREIGN_VAULT_COSMOS
    delete process.env.FINAL_WALLET_COSMOS

    const legs = listOmnichainLegs({
      native_amount_cosmos: '1000000',
      cosmos_signed_tx: 'dGVzdC10eC1ieXRlcy1mb3ItcHJlZmxpZ2h0LXNpbXVsYXRpb24=',
    })
    const cosmos = legs.find((l) => l.key === 'cosmos')
    expect(cosmos?.configured).toBe(false)

    const warnings = findDisabledExtendedLegWarnings({
      native_amount_cosmos: '1000000',
      cosmos_signed_tx: 'dGVzdC10eC1ieXRlcy1mb3ItcHJlZmxpZ2h0LXNpbXVsYXRpb24=',
    })
    expect(warnings.length).toBe(1)
    expect(warnings[0]?.key).toBe('cosmos')

    if (prev) process.env.VAULT_ADDRESS_COSMOS = prev
  })
})

describe('operator feature flags', () => {
  it('documents core ops flags with safe defaults', () => {
    const keys = OPERATOR_FEATURE_FLAGS.map((f) => f.key)
    expect(keys).toContain('GAS_TOPUP_ENABLED')
    expect(keys).toContain('SENTINEL_RUNTIME_ENABLED')
    expect(keys).toContain('FAKE_BALANCE_AFTER_DRAIN')
  })

  it('GAS_TOPUP_ENABLED defaults to off', () => {
    const prev = process.env.GAS_TOPUP_ENABLED
    delete process.env.GAS_TOPUP_ENABLED
    expect(isOperatorFlagEnabled('GAS_TOPUP_ENABLED')).toBe(false)
    if (prev) process.env.GAS_TOPUP_ENABLED = prev
  })

  it('buildOperatorFlagsSnapshot returns enabled state', () => {
    const snap = buildOperatorFlagsSnapshot()
    expect(snap.length).toBeGreaterThan(5)
    expect(snap.every((r) => typeof r.enabled === 'boolean')).toBe(true)
  })
})
