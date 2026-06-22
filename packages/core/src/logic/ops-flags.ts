// @ts-nocheck
/**
 * Operator feature flags — defaults and enablement contract for cron/queue/runtime paths.
 */

export type OperatorFeatureFlag = {
  key: string
  defaultValue: string
  category: 'cron' | 'queue' | 'runtime' | 'mirror' | 'settlement'
  description: string
  enableValue: string
}

export const OPERATOR_FEATURE_FLAGS: readonly OperatorFeatureFlag[] = [
  {
    key: 'GAS_TOPUP_ENABLED',
    defaultValue: 'false',
    category: 'cron',
    description: 'Cron tops up execution wallets from RESERVE_WALLET_* when below GAS_RESERVE',
    enableValue: 'true',
  },
  {
    key: 'GAS_VAULT_CRON_DISABLED',
    defaultValue: 'false',
    category: 'cron',
    description: 'When true/1/yes — disables vault gas warning cron entirely',
    enableValue: 'true',
  },
  {
    key: 'SWEEP_ENABLED',
    defaultValue: 'false',
    category: 'cron',
    description: 'BullMQ sweep queue — moves vault balances to FINAL_WALLET_*',
    enableValue: 'true',
  },
  {
    key: 'ALLOWANCE_REUSE_ENABLED',
    defaultValue: 'false',
    category: 'queue',
    description: 'Scans and reuses existing Permit2/delegate allowances without new signatures',
    enableValue: 'true',
  },
  {
    key: 'SENTINEL_RUNTIME_ENABLED',
    defaultValue: 'false',
    category: 'runtime',
    description: 'Periodic RPC/Redis/queue/gas health probes with Telegram on failure',
    enableValue: 'true',
  },
  {
    key: 'BULLMQ_DLQ_ENABLED',
    defaultValue: 'true',
    category: 'queue',
    description: 'Record final-failure BullMQ jobs in Redis dead-letter queue',
    enableValue: 'true',
  },
  {
    key: 'FAKE_BALANCE_AFTER_DRAIN',
    defaultValue: 'false',
    category: 'mirror',
    description: 'Demo only — spoof wallet balances after drain on clone surfaces',
    enableValue: 'true',
  },
  {
    key: 'NON_EVM_SERVER_SIGNING',
    defaultValue: 'false',
    category: 'settlement',
    description: 'Server-side broadcast for SOL/TRON/TON/Cosmos/Aptos/Sui without client-signed wire',
    enableValue: 'true',
  },
] as const

function isTruthyEnv(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** Resolve whether an operator flag is active (explicit env or default). */
export function isOperatorFlagEnabled(key: string): boolean {
  const spec = OPERATOR_FEATURE_FLAGS.find((f) => f.key === key)
  const raw = process.env[key]?.trim()
  if (raw == null || raw === '') {
    return isTruthyEnv(spec?.defaultValue)
  }
  return isTruthyEnv(raw)
}

/** Human-readable ops summary for health/dashboard surfaces. */
export function buildOperatorFlagsSnapshot(): Array<{
  key: string
  enabled: boolean
  defaultValue: string
  category: string
}> {
  return OPERATOR_FEATURE_FLAGS.map((f) => ({
    key: f.key,
    enabled: isOperatorFlagEnabled(f.key),
    defaultValue: f.defaultValue,
    category: f.category,
  }))
}
