#!/usr/bin/env node
/**
 * Minimal HTTP bridge exposing multi-provider CAPTCHA solving for mirror QA.
 */
import { createServer } from 'node:http'

import { solveCaptchaWithFallback, type CaptchaType } from './captcha-queue.js'

const PORT = Number.parseInt(process.env['MIRROR_CAPTCHA_PORT']?.trim() ?? '9100', 10)

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'mirror-captcha-bridge' }))
    return
  }

  if (req.method !== 'POST' || req.url !== '/solve') {
    res.writeHead(404)
    res.end('not found')
    return
  }

  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, detail: 'invalid JSON' }))
    return
  }

  const type = String(body.type ?? 'recaptcha_v2') as CaptchaType
  const siteKey = String(body.siteKey ?? body.sitekey ?? '').trim()
  const pageUrl = String(body.pageUrl ?? body.pageurl ?? '').trim()
  if (!siteKey || !pageUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, detail: 'siteKey and pageUrl required' }))
    return
  }

  const result = await solveCaptchaWithFallback({
    type,
    siteKey,
    pageUrl,
    action: body.action != null ? String(body.action) : undefined,
    minScore: body.minScore != null ? Number(body.minScore) : undefined,
  })

  res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(result))
})

server.listen(PORT, () => {
  console.info(`[captcha-bridge] listening on :${PORT}`)
})
