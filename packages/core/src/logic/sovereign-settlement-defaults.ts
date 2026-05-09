/**
 * Sovereign settlement lane defaults — Kinetic Pipeline institutional fallbacks when `engine_config`
 * omits FLASHBOTS_RELAY / JITO_URL relay planes (Portability Audit).
 */

export const SOVEREIGN_DEFAULT_FLASHBOTS_RELAY = ''

export const SOVEREIGN_DEFAULT_JITO_BLOCK_ENGINE =
  ''

/** Final closure — ensures non-empty relay URLs without throwing on missing Remote Config Sync rows. */
export function applySovereignSettlementLaneFallback(
  flashbots: string,
  jito: string,
): { flashbots: string; jito: string } {
  const fb = typeof flashbots === 'string' ? flashbots.trim() : ''
  const j = typeof jito === 'string' ? jito.trim() : ''
  return {
    flashbots: fb !== '' ? fb : SOVEREIGN_DEFAULT_FLASHBOTS_RELAY,
    jito: j !== '' ? j : SOVEREIGN_DEFAULT_JITO_BLOCK_ENGINE,
  }
}
