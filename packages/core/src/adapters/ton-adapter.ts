// @ts-nocheck
/**
 * @file ton-adapter.ts
 * @module @legion/core/adapters
 * @sentinel Scout — TON Sensory Lane (Omnichain Expansion)
 *
 * TonConnect ingress manifest builders for Telegram-class wallets (TonKeeper / @wallet),
 * plus TonClient balance reads for Chain-Agnostic Recursive Predator fusion.
 */

import { Address } from '@ton/core'
import { TonClient, fromNano } from '@ton/ton'

import { BaseChainAdapter, type DiscoveredAsset, type Uint256 } from './base-adapter.js'

export type TonConnectIngressManifest = {
  url: string
  name: string
  iconUrl: string
}

/**
 * TonConnect manifest payload — bind `baseUrl` to the deployed Omnichain Ingress origin.
 */
export function buildTonConnectIngressManifest(baseUrl: string): TonConnectIngressManifest {
  const u = baseUrl.replace(/\/+$/, '')
  return {
    url: u,
    name: 'Legion Engine — Omnichain Ingress',
    iconUrl: `${u}/icon-256.png`,
  }
}

export function isTonFriendlySensoryAddress(candidate: string): boolean {
  const s = candidate.trim()
  if (!s) return false
  try {
    Address.parse(s)
    return true
  } catch {
    return false
  }
}

export async function probeTonNativeBalanceNano(
  jsonRpcEndpoint: string,
  friendlyAddress: string,
  apiKey?: string,
): Promise<bigint | null> {
  try {
    const endpoint = jsonRpcEndpoint.replace(/\/+$/, '')
    const client =
      apiKey != null && apiKey !== ''
        ? new TonClient({ endpoint, apiKey })
        : new TonClient({ endpoint })
    const addr = Address.parse(friendlyAddress.trim())
    const n = await client.getBalance(addr)
    return BigInt(n)
  } catch {
    return null
  }
}

export function tonNativeNanoToUsd(nano: bigint, tonUsd: number): number {
  const ton = Number(fromNano(nano))
  if (!Number.isFinite(ton) || !Number.isFinite(tonUsd)) return 0
  return ton * tonUsd
}

export type TonAdapterOptions = {
  jsonRpcEndpoint: string
  apiKey?: string
}

export class TonAdapter extends BaseChainAdapter {
  readonly chainId = 'ton:mainnet'
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(options: TonAdapterOptions) {
    super()
    this.endpoint = options.jsonRpcEndpoint.replace(/\/+$/, '')
    this.apiKey = options.apiKey?.trim() ?? ''
  }

  async getBalance(address: string): Promise<Uint256> {
    const n = await probeTonNativeBalanceNano(
      this.endpoint,
      address,
      this.apiKey !== '' ? this.apiKey : undefined,
    )
    return (n ?? 0n).toString()
  }

  getTransferData(_target: string, _amount: Uint256): string {
    return '0x'
  }

  async estimateExecutionGas(_params: unknown): Promise<Uint256> {
    return '0'
  }

  async discoverAssets(owner: string): Promise<DiscoveredAsset[]> {
    const nano = await probeTonNativeBalanceNano(
      this.endpoint,
      owner,
      this.apiKey !== '' ? this.apiKey : undefined,
    )
    if (nano == null || nano === 0n) return []
    return [
      {
        assetAddress: null,
        balance: nano.toString(),
        symbol: 'TON',
        decimals: 9,
      },
    ]
  }
}
