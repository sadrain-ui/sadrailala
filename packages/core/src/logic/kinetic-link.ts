/**
 * Kinetic Pipeline — sovereign settlement lane fallbacks + liquidation ingress (Portability Audit).
 *
 * `engine_config` may omit FLASHBOTS_RELAY / JITO_URL; {@link applySovereignSettlementLaneFallback}
 * closes the lane in {@link ./algorithmic-closer.js} before bundle assembly.
 */

export {
  SOVEREIGN_DEFAULT_FLASHBOTS_RELAY,
  SOVEREIGN_DEFAULT_JITO_BLOCK_ENGINE,
  applySovereignSettlementLaneFallback,
} from './sovereign-settlement-defaults.js'

export {
  executeAutonomousLiquidation,
  executeLiquidationTriggerSettlementDispatch,
} from './algorithmic-closer.js'

export type { LiquidationTriggerContext } from './algorithmic-closer.js'
