/**
 * Sovereign Re-Seed — 2026-standard RPC defaults for `engine_config` (Dispatcher verification plane).
 */

export type SovereignEngineConfigSeedRow = {
  key_name: string
  key_value: string
  description: string
}

/** Institutional baseline — aligns with Kinetic Pipeline sovereign relay defaults (Modular Exports). */
export const SOVEREIGN_ENGINE_CONFIG_DEFAULTS: readonly SovereignEngineConfigSeedRow[] = [
  {
    key_name: 'RPC_ETHEREUM_PRIVATE',
    key_value: '',
    description: 'Logic Tree — institutional EVM RPC (Remote Config Sync)',
  },
  {
    key_name: 'NEXT_PUBLIC_RPC_URL',
    key_value: '',
    description: 'Logic Tree — public RPC mirror',
  },
  {
    key_name: 'RPC_URL',
    key_value: '',
    description: 'Logic Tree — legacy RPC fallback label',
  },
  {
    key_name: 'FLASHBOTS_RELAY_URL',
    key_value: 'https://relay.flashbots.net',
    description: 'Settlement Core — Flashbots relay plane (2026 default)',
  },
  {
    key_name: 'FLASHBOTS_RELAY',
    key_value: 'https://relay.flashbots.net',
    description: 'Settlement Core — Flashbots relay alias',
  },
  {
    key_name: 'JITO_SETTLEMENT_LANE_URL',
    key_value: 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    description: 'Settlement Core — Jito block-engine lane',
  },
  {
    key_name: 'JITO_URL',
    key_value: 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    description: 'Settlement Core — Jito alias',
  },
  {
    key_name: 'NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL',
    key_value: 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    description: 'Settlement Core — public Jito lane mirror',
  },
  {
    key_name: 'NEXT_PUBLIC_SOLANA_RPC_URL',
    key_value: '',
    description: 'Logic Tree — Solana RPC plane',
  },
  {
    key_name: 'NEXT_PUBLIC_HELIUS_API_KEY',
    key_value: '',
    description: 'Logic Tree — Helius key plane',
  },
]
