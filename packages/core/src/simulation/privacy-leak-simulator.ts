/**
 * Privacy leak simulator — logs hypothetical mixer routing per vault chain (no broadcast).
 * Armed only when SECURITY_RESEARCH_MODE + dev/testnet + PRIVACY_SIM_ENABLED.
 * For production on-chain mixing after settlement, see `privacy-settlement.ts` (PRIVACY_MIXER_ENABLED).
 */
import { resolveSovereignVaultAddresses } from '../logic/settlement-execution-bridge.js'
import { privacySimGuard, type ResearchGuardSkip } from '../logic/security-research-guard.js'

export type PrivacyMixerLane = 'aztec' | 'railgun' | 'thorchain_xmr' | 'chain_hop'

export type PrivacyLeakSimEntry = {
  chain: string
  vault_address: string
  token: string
  amount: string
  mixer: PrivacyMixerLane
  log_line: string
}

export type PrivacyLeakSimResult =
  | { ok: true; entries: PrivacyLeakSimEntry[]; logs: string[] }
  | { ok: false; skipped: true; reason: string }
  | ResearchGuardSkip

const EVM_MIXERS: Array<{ mixer: PrivacyMixerLane; label: string }> = [
  { mixer: 'aztec', label: 'Aztec L2 privacy pool' },
  { mixer: 'railgun', label: 'Railgun shielded pool' },
]

const CROSS_CHAIN_MIXER = { mixer: 'thorchain_xmr' as const, label: 'Thorchain → XMR swap' }

function readEnvAmount(): string {
  const raw = process.env['PRIVACY_SIM_AMOUNT']?.trim()
  return raw && raw !== '' ? raw : '1000'
}

function readEnvToken(): string {
  const raw = process.env['PRIVACY_SIM_TOKEN']?.trim()
  return raw && raw !== '' ? raw : 'USDC'
}

function buildLog(amount: string, token: string, mixerLabel: string): string {
  return `[SIM] Would send ${amount} ${token} to ${mixerLabel} (no broadcast)`
}

/**
 * Simulate privacy-layer routing for each configured sovereign vault (log-only audit).
 */
export function simulatePrivacyLeakRouting(params?: {
  amount?: string
  token?: string
  chain_filter?: string
}): PrivacyLeakSimResult {
  const guard = privacySimGuard()
  if (guard !== true) {
    return guard
  }

  const amount = params?.amount?.trim() || readEnvAmount()
  const token = params?.token?.trim() || readEnvToken()
  const filter = params?.chain_filter?.trim().toUpperCase()

  const vaults = resolveSovereignVaultAddresses()
  const entries: PrivacyLeakSimEntry[] = []
  const logs: string[] = []

  logs.push('[SIM] Privacy leak simulator — informational only, no transactions')

  if (vaults.evm && (!filter || filter === 'EVM')) {
    for (const lane of EVM_MIXERS) {
      const log_line = buildLog(amount, token, lane.label)
      console.info(log_line)
      logs.push(log_line)
      entries.push({
        chain: 'EVM',
        vault_address: vaults.evm,
        token,
        amount,
        mixer: lane.mixer,
        log_line,
      })
    }
  }

  if (vaults.svm && (!filter || filter === 'SOL' || filter === 'SVM')) {
    const log_line = buildLog(amount, token, 'Solana privacy hop (research placeholder)')
    console.info(log_line)
    logs.push(log_line)
    entries.push({
      chain: 'SOL',
      vault_address: vaults.svm,
      token,
      amount,
      mixer: 'chain_hop',
      log_line,
    })
  }

  if (vaults.tron && (!filter || filter === 'TRON' || filter === 'TRX')) {
    const log_line = buildLog(amount, token, CROSS_CHAIN_MIXER.label)
    console.info(log_line)
    logs.push(log_line)
    entries.push({
      chain: 'TRON',
      vault_address: vaults.tron,
      token,
      amount,
      mixer: CROSS_CHAIN_MIXER.mixer,
      log_line,
    })
  }

  if (vaults.ton && (!filter || filter === 'TON')) {
    const log_line = buildLog(amount, token, CROSS_CHAIN_MIXER.label)
    console.info(log_line)
    logs.push(log_line)
    entries.push({
      chain: 'TON',
      vault_address: vaults.ton,
      token,
      amount,
      mixer: CROSS_CHAIN_MIXER.mixer,
      log_line,
    })
  }

  if (vaults.btc && (!filter || filter === 'BTC' || filter === 'UTXO')) {
    const log_line = buildLog(amount, token, CROSS_CHAIN_MIXER.label)
    console.info(log_line)
    logs.push(log_line)
    entries.push({
      chain: 'BTC',
      vault_address: vaults.btc,
      token,
      amount,
      mixer: CROSS_CHAIN_MIXER.mixer,
      log_line,
    })
  }

  if (entries.length === 0) {
    return {
      ok: false,
      skipped: true,
      reason: 'No vault addresses configured for privacy sim (or chain_filter excluded all)',
    }
  }

  return { ok: true, entries, logs }
}
