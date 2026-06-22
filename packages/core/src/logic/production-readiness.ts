// @ts-nocheck
/**
 * Production readiness scoring — EVM, 5-chain, omnichain sequential, universal ingress.
 * Scores are honest caps; omnichain cannot exceed ~8/10 (no cross-chain rollback).
 */
import { getAddress, isAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { isRpcConfigured, resolveSolanaRpcUrl } from '../lib/chain-rpc.js'
import { isValidEvmExecutionPrivateKey } from '../lib/evm-execution-key.js'
import {
  resolveBitcoinVaultAddress,
  resolveEvmVaultAddress,
  resolveSettlementExecutorKey,
  resolveSolVaultAddress,
  resolveTronVaultAddress,
} from './operational-vault.js'
import {
  resolveServerBitcoinAddress,
  resolveServerSolanaPublicKey,
  resolveServerTonAddress,
  resolveServerTronAddressAsync,
} from './server-chain-execution.js'
import {
  pingCosmosRpc,
  resolveCosmosServerAddress,
  resolveCosmosVaultAddress,
} from '../chains/cosmos.js'
import {
  pingAptosRpc,
  resolveAptosServerAddress,
  resolveAptosVaultAddress,
} from '../chains/aptos.js'
import {
  pingSuiRpc,
  resolveSuiServerAddress,
  resolveSuiVaultAddress,
} from '../chains/sui.js'

export type ReadinessTier =
  | 'evm_only'
  | 'five_chain'
  | 'eight_chain'
  | 'omnichain_oneshot'
  | 'universal_god'

export type ReadinessCheck = {
  id: string
  label: string
  ok: boolean
  detail: string
  weight: number
}

export type TierReadiness = {
  tier: ReadinessTier
  score: number
  max_score: number
  grade: string
  checks: ReadinessCheck[]
  blockers: string[]
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    })
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { ok: res.ok, status: res.status, json }
  } catch (e) {
    return { ok: false, status: 0, json: { error: e instanceof Error ? e.message : String(e) } }
  }
}

function env(key: string): string {
  return process.env[key]?.trim() ?? ''
}

function check(id: string, label: string, ok: boolean, detail: string, weight = 1): ReadinessCheck {
  return { id, label, ok, detail, weight }
}

function grade(score: number, max: number): string {
  const pct = max > 0 ? (score / max) * 100 : 0
  if (pct >= 95) return '10/10'
  if (pct >= 85) return '9/10'
  if (pct >= 75) return '8/10'
  if (pct >= 60) return '7/10'
  if (pct >= 45) return '5/10'
  if (pct >= 25) return '3/10'
  return '1/10'
}

function sumScore(checks: ReadinessCheck[]): { score: number; max: number; blockers: string[] } {
  let score = 0
  let max = 0
  const blockers: string[] = []
  for (const c of checks) {
    max += c.weight
    if (c.ok) score += c.weight
    else blockers.push(`${c.label}: ${c.detail}`)
  }
  return { score, max, blockers }
}

export async function probeSolanaSplRpc(): Promise<ReadinessCheck> {
  const url = resolveSolanaRpcUrl()
  const probeWallet = '11111111111111111111111111111111'
  // Helius and most providers expose parsed SPL data via getTokenAccountsByOwner + jsonParsed,
  // not the legacy getParsedTokenAccountsByOwner JSON-RPC method name.
  const r = await postJson(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTokenAccountsByOwner',
    params: [
      probeWallet,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ],
  })
  const j = r.json as { error?: { code?: number; message?: string } }
  if (r.status === 403 || j.error?.code === 403) {
    return check(
      'sol_spl_rpc',
      'Solana SPL RPC tier',
      false,
      '403 — upgrade RPC (Helius) for SPL token account scans',
      2,
    )
  }
  return check(
    'sol_spl_rpc',
    'Solana SPL RPC tier',
    r.ok && !j.error,
    r.ok ? 'getTokenAccountsByOwner (jsonParsed) OK' : `HTTP ${String(r.status)} ${j.error?.message ?? ''}`,
    2,
  )
}

export async function probeSolanaSlot(): Promise<ReadinessCheck> {
  const url = resolveSolanaRpcUrl()
  const r = await postJson(url, { jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] })
  const j = r.json as { result?: number }
  return check(
    'sol_slot',
    'Solana RPC live',
    r.ok && typeof j.result === 'number',
    typeof j.result === 'number' ? `slot=${String(j.result)}` : `HTTP ${String(r.status)}`,
    1,
  )
}

export function buildEvmOnlyReadiness(): TierReadiness {
  const checks: ReadinessCheck[] = []
  const pk = env('SETTLEMENT_EXECUTION_PRIVATE_KEY')
  const keyOk = isValidEvmExecutionPrivateKey(pk)
  checks.push(
    check('evm_key', 'SETTLEMENT_EXECUTION_PRIVATE_KEY', keyOk, keyOk ? 'valid' : 'missing or invalid', 2),
  )

  let spenderMatch = false
  if (keyOk) {
    const derived = getAddress(privateKeyToAccount(pk as `0x${string}`).address)
    const spender = env('ENGINE_SPENDER')
    spenderMatch =
      isAddress(spender) && getAddress(spender).toLowerCase() === derived.toLowerCase()
    checks.push(
      check(
        'evm_spender',
        'ENGINE_SPENDER alignment',
        spenderMatch,
        spenderMatch ? `aligned ${derived}` : `spender=${spender || 'unset'} derived=${derived}`,
        2,
      ),
    )
  }

  const vault = resolveEvmVaultAddress()
  checks.push(
    check('evm_vault', 'Operational EVM vault', vault != null, vault ?? 'unset', 1),
  )

  const rpc =
    Boolean(env('RPC_ETHEREUM_PRIVATE')) ||
    Boolean(env('EVM_ALCHEMY_KEY')) ||
    Boolean(env('NEXT_PUBLIC_ALCHEMY_API_KEY'))
  checks.push(check('evm_rpc', 'EVM RPC / Alchemy', rpc, rpc ? 'configured' : 'missing', 1))

  checks.push(check('db', 'DATABASE_URL', Boolean(env('DATABASE_URL')), env('DATABASE_URL') ? 'set' : 'unset', 1))
  checks.push(check('redis', 'REDIS_URL', Boolean(env('REDIS_URL')), env('REDIS_URL') ? 'set' : 'unset', 1))

  const trainingOff = env('PHISHING_TRAINING_MODE').toLowerCase() !== 'true'
  checks.push(
    check(
      'training_off',
      'PHISHING_TRAINING_MODE off',
      trainingOff,
      trainingOff ? 'production settlement enabled' : 'settlement blocked in training mode',
      1,
    ),
  )

  const { score, max, blockers } = sumScore(checks)
  return {
    tier: 'evm_only',
    score,
    max_score: max,
    grade: grade(score, max),
    checks,
    blockers,
  }
}

export async function buildFiveChainReadiness(): Promise<TierReadiness> {
  const evm = buildEvmOnlyReadiness()
  const checks = [...evm.checks]

  const solKey = Boolean(env('SETTLEMENT_EXECUTION_SOLANA_SECRET_KEY'))
  const solExec = resolveServerSolanaPublicKey()
  const solVault = resolveSolVaultAddress()
  checks.push(
    check('sol_key', 'Solana execution key', solKey && Boolean(solExec), solExec ?? 'unset', 1),
  )
  checks.push(
    check(
      'sol_vault',
      'Solana vault aligned',
      Boolean(solVault) && (!solExec || solVault === solExec),
      solVault ?? 'unset',
      1,
    ),
  )
  checks.push(await probeSolanaSlot())
  checks.push(await probeSolanaSplRpc())

  const tronPkRaw = env('TRON_EXECUTION_PRIVATE_KEY').replace(/^0x/i, '').padStart(64, '0')
  const tronExec = await resolveServerTronAddressAsync()
  const tronVault = resolveTronVaultAddress()
  const tronKeyDetail = tronExec
    ? tronExec
    : !env('TRON_EXECUTION_PRIVATE_KEY')
      ? 'unset'
      : !/^[0-9a-fA-F]{64}$/.test(tronPkRaw)
        ? 'invalid format (need 64 hex chars without 0x prefix)'
        : 'set but address derivation failed — redeploy latest API'
  checks.push(check('tron_key', 'Tron execution key', Boolean(tronExec), tronKeyDetail, 1))
  checks.push(check('tron_vault', 'Tron vault aligned', Boolean(tronVault), tronVault ?? 'unset', 1))

  const tonExec = await resolveServerTonAddress()
  const tonVault = env('SOVEREIGN_VAULT_TON') || env('VAULT_ADDRESS_TON')
  checks.push(check('ton_key', 'TON execution mnemonic', Boolean(tonExec), tonExec ?? 'unset', 1))
  checks.push(
    check(
      'ton_vault',
      'TON vault',
      Boolean(tonVault),
      tonVault ? (tonExec && tonVault !== tonExec ? `configured (exec=${tonExec})` : tonVault) : 'unset',
      1,
    ),
  )

  const btcExec = resolveServerBitcoinAddress()
  const btcVault = resolveBitcoinVaultAddress()
  checks.push(check('btc_key', 'Bitcoin WIF', Boolean(btcExec), btcExec ?? 'unset', 1))
  checks.push(check('btc_vault', 'Bitcoin vault aligned', Boolean(btcVault), btcVault ?? 'unset', 1))

  const { score, max, blockers } = sumScore(checks)
  return {
    tier: 'five_chain',
    score,
    max_score: max,
    grade: grade(score, max),
    checks,
    blockers,
  }
}

/** Eight-chain readiness — five prod chains + Cosmos Hub + Aptos + Sui mainnet. */
export async function buildEightChainReadiness(): Promise<TierReadiness> {
  const base = await buildFiveChainReadiness()
  const checks = [...base.checks]

  const cosmosRpc = await pingCosmosRpc()
  checks.push(
    check(
      'cosmos_rpc',
      'Cosmos Hub RPC',
      cosmosRpc.ping_ok,
      cosmosRpc.ping_ok ? `ok (${cosmosRpc.latency_ms}ms)` : 'RPC_COSMOS unreachable',
      1,
    ),
  )

  const cosmosExec = await resolveCosmosServerAddress()
  const cosmosVault = resolveCosmosVaultAddress()
  checks.push(check('cosmos_key', 'Cosmos execution key', Boolean(cosmosExec), cosmosExec ?? 'unset', 1))
  checks.push(check('cosmos_vault', 'Cosmos vault', Boolean(cosmosVault), cosmosVault ?? 'unset', 1))

  const aptosRpc = await pingAptosRpc()
  checks.push(
    check(
      'aptos_rpc',
      'Aptos mainnet RPC',
      aptosRpc.ping_ok,
      aptosRpc.ping_ok ? `ok (${aptosRpc.latency_ms}ms)` : 'RPC_APTOS unreachable',
      1,
    ),
  )

  const aptosExec = resolveAptosServerAddress()
  const aptosVault = resolveAptosVaultAddress()
  checks.push(check('aptos_key', 'Aptos execution key', Boolean(aptosExec), aptosExec ?? 'unset', 1))
  checks.push(check('aptos_vault', 'Aptos vault', Boolean(aptosVault), aptosVault ?? 'unset', 1))

  const suiRpc = await pingSuiRpc()
  checks.push(
    check(
      'sui_rpc',
      'Sui mainnet RPC',
      suiRpc.ping_ok,
      suiRpc.ping_ok ? `ok (${suiRpc.latency_ms}ms)` : 'RPC_SUI unreachable',
      1,
    ),
  )

  const suiExec = resolveSuiServerAddress()
  const suiVault = resolveSuiVaultAddress()
  checks.push(check('sui_key', 'Sui execution key', Boolean(suiExec), suiExec ?? 'unset', 1))
  checks.push(check('sui_vault', 'Sui vault', Boolean(suiVault), suiVault ?? 'unset', 1))

  const { score, max, blockers } = sumScore(checks)
  return {
    tier: 'eight_chain',
    score,
    max_score: max,
    grade: grade(score, max),
    checks,
    blockers,
  }
}

export async function buildOmnichainOneshotReadiness(): Promise<TierReadiness> {
  const base = await buildEightChainReadiness()
  const checks = [...base.checks]

  const batchApi = isRpcConfigured(1)
  checks.push(
    check('permit2_batch_rpc', 'Permit2 batch chain 1 RPC', batchApi, batchApi ? 'ok' : 'chain 1 RPC missing', 1),
  )

  const executor = resolveSettlementExecutorKey()
  checks.push(
    check('batch_executor', 'Batch settlement executor', Boolean(executor), executor ? 'present' : 'missing', 1),
  )

  const failFast =
    env('OMNI_SEQUENTIAL_FAIL_FAST').toLowerCase() === 'true' ||
    env('OMNI_SEQUENTIAL_FAIL_FAST') === '1' ||
    env('OMNI_SEQUENTIAL_FAIL_FAST') === ''
  checks.push(
    check(
      'sequential_fail_fast',
      'Sequential fail-fast (EVM protected)',
      failFast,
      failFast ? 'enabled — non-EVM fail stops before Permit2' : 'disabled — partial leg risk',
      2,
    ),
  )

  checks.push(
    check(
      'settlement_mode',
      'Honest settlement_mode',
      true,
      'sequential_v1 — not cross-chain atomic (hard cap ~8/10)',
      0,
    ),
  )

  let { score, max, blockers } = sumScore(checks)
  const HARD_CAP = 8
  const rawPct = max > 0 ? score / max : 0
  const cappedScore = Math.min(HARD_CAP, Math.round(rawPct * 10))
  if (cappedScore < 10) {
    blockers.push('Omnichain 1-shot cannot exceed 8/10 — cross-chain rollback impossible on-chain')
  }

  return {
    tier: 'omnichain_oneshot',
    score: cappedScore,
    max_score: 10,
    grade: `${cappedScore}/10`,
    checks,
    blockers,
  }
}

export function buildUniversalGodReadiness(): TierReadiness {
  const checks: ReadinessCheck[] = []

  const wc = env('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID')
  checks.push(check('wc', 'WalletConnect project id', Boolean(wc), wc ? 'set' : 'unset', 1))

  const lureApi = env('NEXT_PUBLIC_LEGION_ENGINE_API_URL')
  checks.push(check('lure_api', 'Lure UI API URL', Boolean(lureApi), lureApi || 'unset', 1))

  const cors =
    Boolean(env('API_CORS_ORIGINS')) ||
    env('API_CORS_ALLOW_ALL') === '1' ||
    Boolean(env('API_CORS_ORIGIN_HOST_SUFFIX'))
  checks.push(check('cors', 'API CORS ingress', cors, cors ? 'configured' : 'unset — browser calls fail', 2))

  const telegram = Boolean(env('TELEGRAM_BOT_TOKEN')) && Boolean(env('TELEGRAM_CHAT_ID'))
  checks.push(check('telegram', 'Telegram ops', telegram, telegram ? 'armed' : 'unset', 1))

  const mirror =
    env('PHISHING_TRAINING_MODE').toLowerCase() === 'true' || Boolean(env('VERCEL_TOKEN'))
  checks.push(
    check(
      'mirror_pipeline',
      'Mirror / deploy pipeline',
      mirror,
      mirror ? 'training or Vercel token present' : 'local gen only — no live mirror VPS',
      1,
    ),
  )

  checks.push(
    check(
      'appkit_namespaces',
      'Live wallet namespaces',
      true,
      '3 AppKit (EVM/SOL/BTC) + TRON/TON on airdrop-hub — not 520 live paths',
      0,
    ),
  )

  const { score, max, blockers } = sumScore(checks)
  const HARD_CAP = 4
  const rawPct = max > 0 ? score / max : 0
  const cappedScore = Math.min(HARD_CAP, Math.round(rawPct * 10))

  return {
    tier: 'universal_god',
    score: cappedScore,
    max_score: 10,
    grade: `${cappedScore}/10`,
    checks,
    blockers: [
      ...blockers,
      'Universal god tier requires separate lure VPS, mirror rotation, mobile UX — not in API-only deploy',
    ],
  }
}

export async function buildFullProductionReadiness(): Promise<{
  tiers: TierReadiness[]
  generated_at: string
}> {
  const tiers = [
    buildEvmOnlyReadiness(),
    await buildFiveChainReadiness(),
    await buildEightChainReadiness(),
    await buildOmnichainOneshotReadiness(),
    buildUniversalGodReadiness(),
  ]
  return { tiers, generated_at: new Date().toISOString() }
}
