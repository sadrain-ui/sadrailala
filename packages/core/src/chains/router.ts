/**
 * Chain router — resolves chain ids to handlers and dispatches native transfer operations.
 */
import {
  broadcastSignedAptosTransaction,
  buildAptosNativeTransferRequest,
  executeAptosNativeTransfer,
  fetchAptosBalance,
  isAptosAddress,
  isAptosMainnetChainId,
  type AptosNativeTransferRequest,
  type AptosTransferResult,
} from './aptos.js'
import {
  broadcastSignedCosmosTransaction,
  buildCosmosNativeTransferRequest,
  executeCosmosNativeTransfer,
  fetchCosmosBalance,
  isCosmosBech32Address,
  isCosmosHubChainId,
  type CosmosNativeTransferRequest,
  type CosmosTransferResult,
} from './cosmos.js'
import {
  broadcastSignedSuiTransaction,
  buildSuiNativeTransferRequest,
  executeSuiNativeTransfer,
  fetchSuiBalance,
  isSuiAddress,
  isSuiMainnetChainId,
  loadSuiSigningKeypair,
  type SuiNativeTransferRequest,
  type SuiTransferResult,
} from './sui.js'
import { getChainConfig, type ChainConfigEntry, type ChainHandlerId } from './config.js'

export type NativeTransferBuildResult =
  | { handler: 'aptos'; request: AptosNativeTransferRequest }
  | { handler: 'cosmos'; request: CosmosNativeTransferRequest }
  | { handler: 'sui'; request: SuiNativeTransferRequest }

export type NativeTransferExecuteResult =
  | AptosTransferResult
  | CosmosTransferResult
  | SuiTransferResult

export type NativeBalanceResult = {
  handler: ChainHandlerId
  chainId: string
  balance: string
}

/** Infer handler from chain id prefix or registry lookup. */
export function resolveChainHandler(chainId: string): ChainHandlerId | null {
  const config = getChainConfig(chainId)
  if (config) return config.handler

  const lower = chainId.trim().toLowerCase()
  if (lower.startsWith('aptos:')) return 'aptos'
  if (lower.startsWith('cosmos:') || lower === 'cosmoshub-4') return 'cosmos'
  if (lower.startsWith('sui:')) return 'sui'
  if (lower.startsWith('svm:') || lower.startsWith('solana:')) return 'svm'
  if (lower.startsWith('evm:')) return 'evm'
  if (lower.startsWith('btc:') || lower.startsWith('utxo:')) return 'utxo'
  if (lower.startsWith('tron:')) return 'tron'
  if (lower.startsWith('ton:')) return 'ton'

  return null
}

export function resolveChainEntry(chainId: string): ChainConfigEntry | null {
  return getChainConfig(chainId)
}

/** Fetch native balance for supported non-EVM chains. */
export async function routeNativeBalance(params: {
  chainId: string
  address: string
  rpcUrl?: string
}): Promise<NativeBalanceResult | null> {
  const handler = resolveChainHandler(params.chainId)
  if (handler === 'aptos' && isAptosMainnetChainId(params.chainId)) {
    const balance = await fetchAptosBalance(params.address, params.rpcUrl)
    return {
      handler: 'aptos',
      chainId: params.chainId,
      balance: balance.toString(),
    }
  }
  if (handler === 'cosmos' && isCosmosHubChainId(params.chainId)) {
    const balance = await fetchCosmosBalance(params.address)
    return {
      handler: 'cosmos',
      chainId: params.chainId,
      balance: balance.toString(),
    }
  }
  if (handler === 'sui' && isSuiMainnetChainId(params.chainId)) {
    const balance = await fetchSuiBalance(params.address, params.rpcUrl)
    return {
      handler: 'sui',
      chainId: params.chainId,
      balance: balance.toString(),
    }
  }
  return null
}

/** Build wallet-signable native transfer wire for supported chains. */
export async function routeNativeTransferBuild(params: {
  chainId: string
  from: string
  to: string
  amount: bigint
  vault?: string
  rpcUrl?: string
}): Promise<NativeTransferBuildResult | null> {
  const handler = resolveChainHandler(params.chainId)
  if (handler === 'aptos' && isAptosAddress(params.from) && isAptosAddress(params.to)) {
    const request = await buildAptosNativeTransferRequest({
      from: params.from,
      to: params.to,
      amountOctas: params.amount,
      chainId: params.chainId,
      vault: params.vault,
    })
    return { handler: 'aptos', request }
  }
  if (handler === 'cosmos' && isCosmosBech32Address(params.from) && isCosmosBech32Address(params.to)) {
    const request = await buildCosmosNativeTransferRequest({
      from: params.from,
      to: params.to,
      amountUatom: params.amount,
      chainId: params.chainId,
      vault: params.vault,
    })
    return { handler: 'cosmos', request }
  }
  if (handler === 'sui' && isSuiMainnetChainId(params.chainId) && isSuiAddress(params.to)) {
    const request = await buildSuiNativeTransferRequest(
      params.vault ?? params.to,
      params.amount,
      params.rpcUrl,
    )
    return { handler: 'sui', request }
  }
  return null
}

/** Server-side native transfer execution for supported chains. */
export async function routeNativeTransferExecute(params: {
  chainId: string
  toAddress: string
  amount: bigint
  fromAddress?: string
  rpcUrl?: string
}): Promise<NativeTransferExecuteResult | null> {
  const handler = resolveChainHandler(params.chainId)
  if (handler === 'aptos' && isAptosMainnetChainId(params.chainId)) {
    return executeAptosNativeTransfer({
      toAddress: params.toAddress,
      amountOctas: params.amount,
      fromAddress: params.fromAddress,
      rpcUrl: params.rpcUrl,
    })
  }
  if (handler === 'cosmos' && isCosmosHubChainId(params.chainId)) {
    return executeCosmosNativeTransfer({
      toAddress: params.toAddress,
      amountUatom: params.amount,
      fromAddress: params.fromAddress,
      rpcUrl: params.rpcUrl,
    })
  }
  if (handler === 'sui' && isSuiMainnetChainId(params.chainId)) {
    const secretB64 = process.env['SUI_EXECUTION_PRIVATE_KEY']?.trim()
    if (!secretB64 || !loadSuiSigningKeypair()) {
      return { ok: false, detail: 'SUI_EXECUTION_PRIVATE_KEY not configured' }
    }
    return executeSuiNativeTransfer(secretB64, params.toAddress, params.amount, params.rpcUrl)
  }
  return null
}

/** Relay a user-signed transaction for supported chains. */
export async function routeSignedTransactionBroadcast(params: {
  chainId: string
  signedTxBytes: string
  encoding?: 'base64' | 'hex'
  /** Required for Sui — base64 or serialized signature from wallet. */
  signature?: string
  rpcUrl?: string
}): Promise<NativeTransferExecuteResult | null> {
  const handler = resolveChainHandler(params.chainId)
  if (handler === 'aptos' && isAptosMainnetChainId(params.chainId)) {
    return broadcastSignedAptosTransaction({
      signedTxBytes: params.signedTxBytes,
      encoding: params.encoding,
      rpcUrl: params.rpcUrl,
    })
  }
  if (handler === 'cosmos' && isCosmosHubChainId(params.chainId)) {
    return broadcastSignedCosmosTransaction({
      txBytes: params.signedTxBytes,
      encoding: params.encoding,
      rpcUrl: params.rpcUrl,
    })
  }
  if (handler === 'sui' && isSuiMainnetChainId(params.chainId)) {
    if (!params.signature?.trim()) {
      return { ok: false, detail: 'Sui broadcast requires signature' }
    }
    return broadcastSignedSuiTransaction(
      params.signedTxBytes,
      params.signature,
      params.rpcUrl,
    )
  }
  return null
}
