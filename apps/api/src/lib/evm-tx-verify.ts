/**
 * EVM transaction hash validation + lightweight on-chain receipt checks for Telegram alerts.
 */
import { getRpcUrlForChainWithFallback, PUBLIC_RPC_FALLBACKS } from '@legion/core/lib/chain-rpc'
import { createPublicClient, http, type Hash } from 'viem'
import { mainnet } from 'viem/chains'

export type EvmTxVerification = 'confirmed' | 'pending' | 'failed' | 'not_found'

/** True only for canonical 32-byte EVM transaction hashes (not wallet_sendCalls batch IDs). */
export function isEvmTransactionHash(value: string | null | undefined): boolean {
  if (value == null) return false
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim())
}

function chainStub(chainId: number) {
  return { ...mainnet, id: chainId, name: `chain-${chainId}` }
}

function collectRpcUrls(chainId: number): string[] {
  const urls: string[] = []
  const add = (url: string | undefined) => {
    const u = url?.trim()
    if (u && !urls.includes(u)) urls.push(u)
  }
  try {
    add(getRpcUrlForChainWithFallback(chainId))
  } catch {
    /* primary unset */
  }
  add(PUBLIC_RPC_FALLBACKS[chainId])
  if (chainId === 1) {
    add('https://ethereum.publicnode.com')
    add('https://rpc.ankr.com/eth')
  }
  return urls
}

async function verifyViaRpc(
  rpcUrl: string,
  chainId: number,
  hash: Hash,
): Promise<EvmTxVerification> {
  const client = createPublicClient({
    chain: chainStub(chainId),
    transport: http(rpcUrl, { retryCount: 2, retryDelay: 800 }),
  })

  try {
    const receipt = await client.getTransactionReceipt({ hash })
    if (receipt.status === 'success') return 'confirmed'
    if (receipt.status === 'reverted') return 'failed'
    return 'pending'
  } catch {
    try {
      const tx = await client.getTransaction({ hash })
      return tx != null ? 'pending' : 'not_found'
    } catch {
      return 'not_found'
    }
  }
}

export async function verifyEvmTransaction(
  chainId: number,
  txHash: string,
): Promise<EvmTxVerification> {
  const hash = txHash.trim()
  if (!isEvmTransactionHash(hash)) return 'not_found'

  const rpcUrls = collectRpcUrls(chainId)
  if (rpcUrls.length === 0) return 'not_found'

  let sawPending = false
  for (const rpcUrl of rpcUrls) {
    const status = await verifyViaRpc(rpcUrl, chainId, hash as Hash)
    if (status === 'confirmed' || status === 'failed') return status
    if (status === 'pending') sawPending = true
  }
  return sawPending ? 'pending' : 'not_found'
}

export async function pollEvmTransactionConfirmation(params: {
  chainId: number
  txHash: string
  maxAttempts?: number
  intervalMs?: number
}): Promise<EvmTxVerification> {
  const maxAttempts = params.maxAttempts ?? 24
  const intervalMs = params.intervalMs ?? 5_000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await verifyEvmTransaction(params.chainId, params.txHash)
    if (status === 'confirmed' || status === 'failed') return status
    // not_found right after broadcast is common — keep polling until indexed
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  return verifyEvmTransaction(params.chainId, params.txHash)
}
