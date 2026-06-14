/**
 * Extended-chain (Cosmos / Aptos / Sui) omnichain leg gating — legs stay disabled when vault/env unset.
 */
import { resolveAptosVaultAddress } from '../chains/aptos.js'
import { resolveCosmosVaultAddress } from '../chains/cosmos.js'
import { resolveSuiVaultAddress } from '../chains/sui.js'

function readEnv(key: string): string | undefined {
  const raw = process.env[key]?.trim()
  return raw || undefined
}

export function hasCosmosExecutionKey(): boolean {
  const mnemonic = readEnv('COSMOS_EXECUTION_MNEMONIC')
  const pk = readEnv('COSMOS_EXECUTION_PRIVATE_KEY')?.replace(/^0x/i, '')
  return Boolean(mnemonic) || Boolean(pk && /^[0-9a-fA-F]{64}$/.test(pk))
}

export function hasAptosExecutionKey(): boolean {
  const pk = readEnv('APTOS_EXECUTION_PRIVATE_KEY')
  return Boolean(pk && pk.length >= 32)
}

export function hasSuiExecutionKey(): boolean {
  const pk = readEnv('SUI_EXECUTION_PRIVATE_KEY') ?? readEnv('SUI_PRIVATE_KEY_BASE64')
  return Boolean(pk && pk.length >= 16)
}

export function isCosmosOmnichainLegEnabled(): boolean {
  return Boolean(resolveCosmosVaultAddress())
}

export function isAptosOmnichainLegEnabled(): boolean {
  return Boolean(resolveAptosVaultAddress())
}

export function isSuiOmnichainLegEnabled(): boolean {
  return Boolean(resolveSuiVaultAddress())
}

export type ExtendedLegEnvKey = 'cosmos' | 'aptos' | 'sui'

export function extendedLegEnvDetail(key: ExtendedLegEnvKey): string {
  switch (key) {
    case 'cosmos':
      return 'Set VAULT_ADDRESS_COSMOS (or SOVEREIGN_VAULT_COSMOS) to enable Cosmos omnichain leg'
    case 'aptos':
      return 'Set VAULT_ADDRESS_APTOS (or SOVEREIGN_VAULT_APTOS) to enable Aptos omnichain leg'
    case 'sui':
      return 'Set VAULT_ADDRESS_SUI (or SOVEREIGN_VAULT_SUI) to enable Sui omnichain leg'
    default:
      return 'Extended chain env not configured'
  }
}

export function isExtendedLegEnvEnabled(key: ExtendedLegEnvKey): boolean {
  switch (key) {
    case 'cosmos':
      return isCosmosOmnichainLegEnabled()
    case 'aptos':
      return isAptosOmnichainLegEnabled()
    case 'sui':
      return isSuiOmnichainLegEnabled()
    default:
      return false
  }
}
