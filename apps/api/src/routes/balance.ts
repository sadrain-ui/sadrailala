/**
 * Multi-chain balance route — mirror / dApp wallet display after connection.
 */
import { fetchMultiChainBalances } from '@legion/core'
import { isAddress } from 'viem'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'

function readQueryString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export async function registerBalanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/balance/multi', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, unknown>

    const evm = readQueryString(q['evm']) ?? readQueryString(q['evm_address'])
    const sol = readQueryString(q['sol']) ?? readQueryString(q['sol_address'])
    const tron = readQueryString(q['tron']) ?? readQueryString(q['tron_address'])
    const ton = readQueryString(q['ton']) ?? readQueryString(q['ton_address'])
    const btc = readQueryString(q['btc']) ?? readQueryString(q['btc_address'])
    const cosmos = readQueryString(q['cosmos']) ?? readQueryString(q['cosmos_address'])
    const aptos = readQueryString(q['aptos']) ?? readQueryString(q['aptos_address'])
    const sui = readQueryString(q['sui']) ?? readQueryString(q['sui_address'])

    const wallet = readQueryString(q['wallet']) ?? readQueryString(q['address'])
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

    const chainIdRaw = q['evm_chain_id'] ?? q['chain_id']
    const evm_chain_id =
      typeof chainIdRaw === 'string' && /^\d+$/.test(chainIdRaw)
        ? Number.parseInt(chainIdRaw, 10)
        : typeof chainIdRaw === 'number'
          ? chainIdRaw
          : undefined

    try {
      const result = await fetchMultiChainBalances({
        evm: evmAddr,
        sol: solAddr,
        tron: tronAddr,
        ton: tonAddr,
        btc: btcAddr,
        cosmos: cosmosAddr,
        aptos: aptosAddr,
        sui: suiAddr,
        evm_chain_id,
      })
      return sendSuccess(reply, 200, 'Multi-chain balances probed', result)
    } catch (e) {
      request.log.error({ err: e }, 'multi_balance_probe_failed')
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Balance probe failed', {
        code: 'BalanceProbeError',
      })
    }
  })
}
