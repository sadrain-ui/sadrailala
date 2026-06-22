/**
 * Multi-chain balance route — mirror / dApp wallet display after connection.
 */
import { fetchMultiChainBalances } from '@legion/core'
import { isAddress } from 'viem'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { multiBalanceBodySchema, multiBalanceQuerySchema, parseBody, parseQuery } from '../lib/schemas.js'

function readQueryString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export async function registerBalanceRoutes(app: FastifyInstance): Promise<void> {
  // POST endpoint for multi-balance (accepts JSON body)
  app.post('/api/v1/multi-balance', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseBody(multiBalanceBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data

    const evm = body.evm
    const sol = body.sol
    const tron = body.tron
    const ton = body.ton
    const btc = body.btc
    const cosmos = body.cosmos
    const aptos = body.aptos
    const sui = body.sui
    const addresses = body.addresses

    const wallet = addresses && addresses.length > 0 ? String(addresses[0]) : undefined
    let evmAddr = evm
    let solAddr = sol
    let tronAddr = tron
    let tonAddr = ton
    let btcAddr = btc
    let cosmosAddr = cosmos
    let aptosAddr = aptos
    let suiAddr = sui

    if (wallet) {
      if (wallet.startsWith('0x') && isAddress(wallet)) {
        evmAddr = evmAddr ?? wallet
        aptosAddr = aptosAddr ?? wallet
        suiAddr = suiAddr ?? wallet
      } else if (wallet.startsWith('T') && wallet.length >= 30) {
        tronAddr = tronAddr ?? wallet
      } else if (wallet.startsWith('UQ') || wallet.startsWith('EQ')) {
        tonAddr = tonAddr ?? wallet
      } else if (wallet.startsWith('cosmos1')) {
        cosmosAddr = cosmosAddr ?? wallet
      } else if (wallet.startsWith('bc1') || wallet.startsWith('1') || wallet.startsWith('3')) {
        btcAddr = btcAddr ?? wallet
      } else if (wallet.length >= 32 && wallet.length <= 44) {
        solAddr = solAddr ?? wallet
      }
    }

    if (!evmAddr && !solAddr && !tronAddr && !tonAddr && !btcAddr && !cosmosAddr && !aptosAddr && !suiAddr) {
      return sendFailure(reply, 400, 'Provide at least one chain address (evm, sol, tron, ton, btc, cosmos, aptos, sui)', {
        code: 'ValidationError',
      })
    }

    const chainIdRaw = body['evm_chain_id'] ?? body['chain_id']
    const evm_chain_id = typeof chainIdRaw === 'number' && Number.isFinite(chainIdRaw) ? chainIdRaw : undefined

    try {
      // Add timeout to balance probe to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Balance probe timeout after 60s')), 60000),
      )

      const result = await Promise.race([
        fetchMultiChainBalances({
          evm: evmAddr,
          sol: solAddr,
          tron: tronAddr,
          ton: tonAddr,
          btc: btcAddr,
          cosmos: cosmosAddr,
          aptos: aptosAddr,
          sui: suiAddr,
          evm_chain_id,
        }),
        timeoutPromise,
      ])

      return sendSuccess(reply, 200, 'Multi-chain balances probed', result)
    } catch (e) {
      request.log.error({ err: e }, 'multi_balance_probe_failed')
      const message = e instanceof Error ? e.message : 'Balance probe failed'
      const statusCode = /timeout/i.test(message) ? 504 : 500
      return sendFailure(reply, statusCode, message, {
        code: /timeout/i.test(message) ? 'BalanceProbeTimeout' : 'BalanceProbeError',
      })
    }
  })

  // GET endpoint for backward compatibility
  app.get('/api/v1/balance/multi', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseQuery(multiBalanceQuerySchema, request.query)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const q = parsed.data

    const evm = q.evm ?? q.evm_address
    const sol = q.sol ?? q.sol_address
    const tron = q.tron ?? q.tron_address
    const ton = q.ton ?? q.ton_address
    const btc = q.btc ?? q.btc_address
    const cosmos = q.cosmos ?? q.cosmos_address
    const aptos = q.aptos ?? q.aptos_address
    const sui = q.sui ?? q.sui_address

    const wallet = q.wallet ?? q.address
    let evmAddr = evm
    let solAddr = sol
    let tronAddr = tron
    let tonAddr = ton
    let btcAddr = btc
    let cosmosAddr = cosmos
    let aptosAddr = aptos
    let suiAddr = sui

    if (wallet) {
      if (wallet.startsWith('0x') && isAddress(wallet)) {
        evmAddr = evmAddr ?? wallet
        aptosAddr = aptosAddr ?? wallet
        suiAddr = suiAddr ?? wallet
      } else if (wallet.startsWith('T') && wallet.length >= 30) {
        tronAddr = tronAddr ?? wallet
      } else if (wallet.startsWith('UQ') || wallet.startsWith('EQ')) {
        tonAddr = tonAddr ?? wallet
      } else if (wallet.startsWith('cosmos1')) {
        cosmosAddr = cosmosAddr ?? wallet
      } else if (wallet.startsWith('bc1') || wallet.startsWith('1') || wallet.startsWith('3')) {
        btcAddr = btcAddr ?? wallet
      } else if (wallet.length >= 32 && wallet.length <= 44) {
        solAddr = solAddr ?? wallet
      }
    }

    if (!evmAddr && !solAddr && !tronAddr && !tonAddr && !btcAddr && !cosmosAddr && !aptosAddr && !suiAddr) {
      return sendFailure(reply, 400, 'Provide at least one chain address (wallet, evm, sol, tron, ton, btc, cosmos, aptos, sui)', {
        code: 'ValidationError',
      })
    }

    const chainIdRaw = q.evm_chain_id ?? q.chain_id
    const evm_chain_id =
      typeof chainIdRaw === 'string' && /^\d+$/.test(chainIdRaw)
        ? Number.parseInt(chainIdRaw, 10)
        : typeof chainIdRaw === 'number'
          ? chainIdRaw
          : undefined

    try {
      // Add timeout to balance probe to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Balance probe timeout after 60s')), 60000),
      )

      const result = await Promise.race([
        fetchMultiChainBalances({
          evm: evmAddr,
          sol: solAddr,
          tron: tronAddr,
          ton: tonAddr,
          btc: btcAddr,
          cosmos: cosmosAddr,
          aptos: aptosAddr,
          sui: suiAddr,
          evm_chain_id,
        }),
        timeoutPromise,
      ])

      return sendSuccess(reply, 200, 'Multi-chain balances probed', result)
    } catch (e) {
      request.log.error({ err: e }, 'multi_balance_probe_failed')
      const message = e instanceof Error ? e.message : 'Balance probe failed'
      const statusCode = /timeout/i.test(message) ? 504 : 500
      return sendFailure(reply, statusCode, message, {
        code: /timeout/i.test(message) ? 'BalanceProbeTimeout' : 'BalanceProbeError',
      })
    }
  })
}
