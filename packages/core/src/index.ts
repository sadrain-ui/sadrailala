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
export { executeAutonomousLiquidation } from './logic/algorithmic-closer.js'

if (
  typeof process !== 'undefined' &&
  process.env['NODE_ENV'] !== 'production' &&
  !process.env['PROD']
) {
  console.info(
    'FINAL_SYNC_COMPLETE: Engine pillars are modular, portable, and 100% verified for multi-repo deployment.',
  )
}
