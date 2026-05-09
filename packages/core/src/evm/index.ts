// Viem-based EVM client factory
// All EVM interactions in Legion Engine go through this module.
import { createPublicClient, createWalletClient, http, type Chain as ViemChain } from 'viem'
import { mainnet, polygon, arbitrum, base } from 'viem/chains'
import type { Chain } from '../types/index'
import {
  LEGION_MESH_EVENT_SETTLEMENT,
  LEGION_MESH_EVENT_WHALE_ALERT,
  legionMeshViemFetchOptions,
} from '../logic/mesh-event'

const VIEM_CHAIN_MAP: Record<Exclude<Chain, 'solana'>, ViemChain> = {
  ethereum: mainnet,
  polygon,
  arbitrum,
  base,
}

export function getPublicClient(chain: Exclude<Chain, 'solana'>, rpcUrl: string) {
  return createPublicClient({
    chain: VIEM_CHAIN_MAP[chain],
    transport: http(rpcUrl, legionMeshViemFetchOptions(LEGION_MESH_EVENT_WHALE_ALERT)),
  })
}

export function getWalletClient(chain: Exclude<Chain, 'solana'>, rpcUrl: string) {
  return createWalletClient({
    chain: VIEM_CHAIN_MAP[chain],
    transport: http(rpcUrl, legionMeshViemFetchOptions(LEGION_MESH_EVENT_SETTLEMENT)),
  })
}
