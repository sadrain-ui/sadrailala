/**
 * SafeScout API — server-side RPC + Safe Transaction Service (no browser CORS drift).
 */

import { NextResponse } from 'next/server'

export const runtime = 'edge'
import type { Address } from 'viem'
import { isAddress } from 'viem'

import { resolveSafeTelemetryForPersistence } from '../../../logic/safe-scout.js'

export async function POST(req: Request): Promise<Response> {
  try {
    const body: unknown = await req.json()
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }
    const o = body as Record<string, unknown>
    const wallet = o.wallet_address
    const chainIdRaw = o.chain_id
    if (typeof wallet !== 'string' || !isAddress(wallet)) {
      return NextResponse.json({ error: 'wallet_address required' }, { status: 400 })
    }
    const chainId =
      typeof chainIdRaw === 'number'
        ? chainIdRaw
        : typeof chainIdRaw === 'string'
          ? Number(chainIdRaw)
          : NaN
    if (!Number.isFinite(chainId)) {
      return NextResponse.json({ error: 'chain_id required' }, { status: 400 })
    }

    const rpcUrl = process.env.RPC_ETHEREUM_PRIVATE ?? process.env.NEXT_PUBLIC_RPC_URL ?? ''
    if (!rpcUrl) {
      return NextResponse.json({
        requires_quorum: false,
        detail: 'RPC not configured — quorum default false',
      })
    }

    const tel = await resolveSafeTelemetryForPersistence({
      rpcUrl,
      chainId,
      wallet: wallet as Address,
    })

    return NextResponse.json({
      requires_quorum: tel.requires_quorum,
      is_gnosis_safe_contract: tel.is_gnosis_safe_contract,
      owner_count: tel.owner_count,
      threshold: tel.threshold,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'SafeScout failed'
    return NextResponse.json({ error: msg, requires_quorum: false }, { status: 500 })
  }
}
