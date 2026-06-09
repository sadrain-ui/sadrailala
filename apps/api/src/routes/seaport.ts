/**
 * Seaport listing fulfillment — typed-data build, OpenSea scan, on-chain fulfill.
 */
import {
  buildSeaportListingTypedData,
  fetchSeaportOrderByHash,
  fulfillSeaportOrder,
  normalizeSeaportOrder,
  scanOpenSeaListings,
} from '@legion/core'
import { getAddress, isAddress } from 'viem'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import {
  parseBody,
  seaportFulfillBodySchema,
  seaportListingTypedDataBodySchema,
  seaportOrderHashBodySchema,
  seaportScanListingsBodySchema,
} from '../lib/schemas.js'

function normalizeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') return value.toString() as T
  if (Array.isArray(value)) return value.map((v) => normalizeBigInts(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeBigInts(v)
    }
    return out as T
  }
  return value
}

export async function registerSeaportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/seaport/listing-typed-data',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseBody(seaportListingTypedDataBodySchema, request.body)
      if (parsed.ok === false) {
        return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
      }
      const body = parsed.data
      if (!isAddress(body.wallet_address) || !isAddress(body.nft_contract)) {
        return sendFailure(reply, 400, 'wallet_address and nft_contract must be valid EVM addresses', {
          code: 'ValidationError',
        })
      }

      try {
        const built = await buildSeaportListingTypedData({
          offerer: getAddress(body.wallet_address),
          nftContract: getAddress(body.nft_contract),
          tokenId: String(body.token_id),
          chainId: body.chain_id,
          seaportVersion: body.seaport_version,
          standard: body.standard,
        })
        return sendSuccess(reply, 200, 'Seaport listing typed data ready', {
          typed_data: normalizeBigInts(built.typedData),
          order_parameters: normalizeBigInts(built.order_parameters),
          seaport_address: built.seaport_address,
          protocol: built.protocol,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return sendFailure(reply, 500, msg, { code: 'ServerError' })
      }
    },
  )

  app.post('/api/v1/seaport/scan-listings', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(seaportScanListingsBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data
    if (!isAddress(body.wallet_address)) {
      return sendFailure(reply, 400, 'wallet_address must be a valid EVM address', {
        code: 'ValidationError',
      })
    }

    const scan = await scanOpenSeaListings({
      walletAddress: getAddress(body.wallet_address),
      chainId: body.chain_id,
      limit: body.limit,
    })
    if (!scan.ok) {
      return sendFailure(reply, 502, scan.detail ?? 'OpenSea listing scan failed', {
        code: 'UpstreamError',
        listings: [],
      })
    }

    return sendSuccess(reply, 200, 'OpenSea listings scanned', {
      listings: scan.listings.map((listing) => ({
        order_hash: listing.order_hash,
        chain: listing.chain,
        protocol_address: listing.protocol_address,
        nft_contract: listing.nft_contract,
        token_id: listing.token_id,
        price_wei: listing.price_wei,
        order: normalizeBigInts(listing.order),
      })),
    })
  })

  app.post('/api/v1/seaport/order-by-hash', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(seaportOrderHashBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data
    const result = await fetchSeaportOrderByHash({
      orderHash: body.order_hash,
      chainId: body.chain_id,
    })
    if (!result.ok || !result.listing) {
      return sendFailure(reply, 404, result.detail ?? 'Order not found', { code: 'NotFound' })
    }
    return sendSuccess(reply, 200, 'Seaport order resolved', {
      listing: {
        order_hash: result.listing.order_hash,
        nft_contract: result.listing.nft_contract,
        token_id: result.listing.token_id,
        price_wei: result.listing.price_wei,
        order: normalizeBigInts(result.listing.order),
      },
    })
  })

  app.post('/api/v1/seaport/fulfill', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(seaportFulfillBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data

    let orderInput = body.order
    let signature = body.signature

    if (!orderInput && body.order_hash) {
      const resolved = await fetchSeaportOrderByHash({
        orderHash: body.order_hash,
        chainId: body.chain_id,
      })
      if (!resolved.ok || !resolved.listing) {
        return sendFailure(reply, 404, resolved.detail ?? 'Order hash not found on OpenSea', {
          code: 'NotFound',
        })
      }
      orderInput = resolved.listing.order
      signature = resolved.listing.order.signature
    }

    if (!orderInput || !signature) {
      return sendFailure(reply, 400, 'order + signature or order_hash required', {
        code: 'ValidationError',
      })
    }

    try {
      const normalized = normalizeSeaportOrder(orderInput, signature)
      const result = await fulfillSeaportOrder(normalized, normalized.signature, {
        chainId: body.chain_id,
        seaportVersion: body.seaport_version,
      })
      if (!result.ok) {
        return sendFailure(reply, 502, result.detail ?? 'Seaport fulfill failed', {
          code: 'SettlementFailed',
          transaction_hash: result.transaction_hash ?? null,
        })
      }
      return sendSuccess(reply, 200, 'Seaport order fulfilled', {
        transaction_hash: result.transaction_hash,
        protocol: 'seaport_listing',
        nft_contract: normalized.parameters.offer[0]?.token ?? null,
        token_id: normalized.parameters.offer[0]?.identifierOrCriteria?.toString() ?? null,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return sendFailure(reply, 400, msg, { code: 'ValidationError' })
    }
  })
}
