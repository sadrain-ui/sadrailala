/**
 * Scout Route Initialization — Recursive Predator fusion trigger (Frontend-to-Engine handshake surface).
 */
import { randomUUID } from 'node:crypto'

import { runRecursivePredatorFusionUsd } from '@legion/core'
import { LEGION_MESH_EVENT_WHALE_ALERT, legionMeshEventHeaders } from '@legion/core/logic'
import type { Address } from 'viem'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

type OracleRateKey = 'eth' | 'sol' | 'trx' | 'ton'
type OracleRates = Record<OracleRateKey, number>

function envUsdOrZero(name: string): number {
  const raw = process.env[name]?.trim()
  if (!raw) return 0
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function fallbackOracleRates(): OracleRates {
  return { eth: 3000, sol: 140, trx: 0.24, ton: 5.5 }
}

function isValidRpcUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Primary spot lane — CoinGecko simple price (override via COINGECKO_SIMPLE_PRICE_URL). */
const DEFAULT_COINGECKO_SIMPLE_PRICE_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,tron,the-open-network&vs_currencies=usd'

async function fetchCoinGeckoUsdRates(): Promise<Partial<OracleRates>> {
  const endpoint =
    process.env['COINGECKO_SIMPLE_PRICE_URL']?.trim() || DEFAULT_COINGECKO_SIMPLE_PRICE_URL
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      ...legionMeshEventHeaders(LEGION_MESH_EVENT_WHALE_ALERT),
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Dynamic Oracle request failed (${response.status})`)
  const data = (await response.json()) as Record<string, { usd?: number }>
  const eth = data['ethereum']?.usd
  const sol = data['solana']?.usd
  const trx = data['tron']?.usd
  const ton = data['the-open-network']?.usd
  return {
    ...(Number.isFinite(eth) && eth != null && eth > 0 ? { eth } : {}),
    ...(Number.isFinite(sol) && sol != null && sol > 0 ? { sol } : {}),
    ...(Number.isFinite(trx) && trx != null && trx > 0 ? { trx } : {}),
    ...(Number.isFinite(ton) && ton != null && ton > 0 ? { ton } : {}),
  }
}

async function resolveReferenceRatesUsd(): Promise<OracleRates> {
  const envRates: OracleRates = {
    eth: envUsdOrZero('ETH_PRICE_USD'),
    sol: envUsdOrZero('SOL_PRICE_USD'),
    trx: envUsdOrZero('TRX_PRICE_USD'),
    ton: envUsdOrZero('TON_PRICE_USD'),
  }
  const fallback = fallbackOracleRates()
  const requiresDynamicOracle = Object.values(envRates).some((v) => v <= 0)
  if (!requiresDynamicOracle) return envRates
  try {
    const dynamic = await fetchCoinGeckoUsdRates()
    return {
      eth: envRates.eth > 0 ? envRates.eth : dynamic.eth ?? fallback.eth,
      sol: envRates.sol > 0 ? envRates.sol : dynamic.sol ?? fallback.sol,
      trx: envRates.trx > 0 ? envRates.trx : dynamic.trx ?? fallback.trx,
      ton: envRates.ton > 0 ? envRates.ton : dynamic.ton ?? fallback.ton,
    }
  } catch {
    return {
      eth: envRates.eth > 0 ? envRates.eth : fallback.eth,
      sol: envRates.sol > 0 ? envRates.sol : fallback.sol,
      trx: envRates.trx > 0 ? envRates.trx : fallback.trx,
      ton: envRates.ton > 0 ? envRates.ton : fallback.ton,
    }
  }
}

export async function registerScoutRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/scout', (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as {
      user_address?: string
      chain_id?: number
      chainId?: number
    }
    const user_address = typeof body.user_address === 'string' ? body.user_address.trim() : ''
    const chainRaw = body.chain_id ?? body.chainId
    const chain_id = typeof chainRaw === 'number' && Number.isFinite(chainRaw) ? chainRaw : 0
    request.log.info(
      { sentinel: 'TelemetryIngress', module: 'apps/api/scout', user_address, chain_id },
      'telemetry_ingress_weld',
    )
    return reply.send({ ok: true, handshake_active: true, telemetry_trace_id: randomUUID() })
  })

  app.post(
    '/api/scout/recursive-predator-fusion',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as {
        evm_holder?: string
        sol_owner_base58?: string
        tron_holder_base58?: string
        ton_friendly_address?: string
        universal_address?: string
        evm_rpc_url?: string
        sol_rpc_url?: string
        tron_rpc_url?: string
        ton_rpc_url?: string
      }

      const evmRaw = typeof body.evm_holder === 'string' ? body.evm_holder.trim() : ''
      const solRaw = typeof body.sol_owner_base58 === 'string' ? body.sol_owner_base58.trim() : ''
      const tronRaw = typeof body.tron_holder_base58 === 'string' ? body.tron_holder_base58.trim() : ''
      const tonRaw = typeof body.ton_friendly_address === 'string' ? body.ton_friendly_address.trim() : ''
      const universalRaw = typeof body.universal_address === 'string' ? body.universal_address.trim() : ''

      const evmRpcCandidate =
        typeof body.evm_rpc_url === 'string' && body.evm_rpc_url.trim() !== '' && isValidRpcUrl(body.evm_rpc_url.trim())
          ? body.evm_rpc_url.trim() : null
      const evmRpc = evmRpcCandidate ?? process.env['RPC_ETHEREUM_PRIVATE']?.trim() ?? process.env['NEXT_PUBLIC_RPC_URL']?.trim() ?? ''

      const solRpcCandidate =
        typeof body.sol_rpc_url === 'string' && body.sol_rpc_url.trim() !== '' && isValidRpcUrl(body.sol_rpc_url.trim())
          ? body.sol_rpc_url.trim() : null
      const solRpc = solRpcCandidate ?? process.env['RPC_SOLANA_PRIVATE']?.trim() ?? process.env['NEXT_PUBLIC_SOLANA_RPC_URL']?.trim() ?? ''

      const tronRpcOverride =
        typeof body.tron_rpc_url === 'string' && body.tron_rpc_url.trim() !== '' && isValidRpcUrl(body.tron_rpc_url.trim())
          ? body.tron_rpc_url.trim() : undefined
      const tonRpcOverride =
        typeof body.ton_rpc_url === 'string' && body.ton_rpc_url.trim() !== '' && isValidRpcUrl(body.ton_rpc_url.trim())
          ? body.ton_rpc_url.trim() : undefined

      const rates = await resolveReferenceRatesUsd()

      const fusion = await runRecursivePredatorFusionUsd({
        evmRpcUrl: evmRpc,
        solRpcUrl: solRpc,
        evmHolder: evmRaw.startsWith('0x') ? (evmRaw as Address) : null,
        solOwnerBase58: solRaw !== '' ? solRaw : null,
        tronHolderBase58: tronRaw !== '' ? tronRaw : null,
        tonFriendlyAddress: tonRaw !== '' ? tonRaw : null,
        universalAddress: universalRaw !== '' ? universalRaw : null,
        chainRpcMesh: {
          ...(tronRpcOverride != null ? { tron: tronRpcOverride } : {}),
          ...(tonRpcOverride != null ? { ton: tonRpcOverride } : {}),
        },
        ethUsd: rates.eth,
        solUsd: rates.sol,
        trxUsd: rates.trx,
        tonUsd: rates.ton,
      })

      request.log.info(
        { sentinel: 'OmnichainExpansion', module: 'apps/api/scout' },
        'OMNICHAIN_EXPANSION_LOCKED',
      )

      return reply.send({
        ok: true,
        handshake_active: true,
        fusion,
        rpc_operational: { evm: evmRpc, svm: solRpc, tron: tronRpcOverride ?? null, ton: tonRpcOverride ?? null },
        reference_rates_usd: rates,
      })
    },
  )
}
