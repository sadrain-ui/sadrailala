/**
 * Telemetry Saturation — institutional POST throughput to `/api/signature-anchor`.
 * Validates API plane stability under sustained ingress (default: 500 requests / 60s).
 *
 * Prerequisites (institutional stress lane):
 * - API listening at `STRESS_TEST_BASE_URL` (default http://127.0.0.1:4000)
 * - Visual Shadow lane (fast 200): API `SIGNATURE_ANCHOR_SIM_MODE=1` and this script `STRESS_TEST_VISUAL_SHADOW=1`
 *
 * Run:
 *   pnpm exec tsx packages/core/tests/stress-test.ts
 *   # or from packages/core:
 *   pnpm exec tsx tests/stress-test.ts
 */

const DEFAULT_BASE =
  (typeof process !== 'undefined' && process.env['STRESS_TEST_BASE_URL']?.trim()) ||
  'http://127.0.0.1:4000'

/** Target throughput: POST /api/signature-anchor — 500 / minute */
const REQUESTS_PER_MINUTE = 500
const WINDOW_MS = 60_000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main(): Promise<void> {
  const base = DEFAULT_BASE.replace(/\/$/, '')
  const url = `${base}/api/signature-anchor`
  const useShadow =
    typeof process !== 'undefined' && process.env['STRESS_TEST_VISUAL_SHADOW']?.trim() === '1'

  const body = useShadow
    ? JSON.stringify({ visual_shadow_run: true })
    : JSON.stringify({
        ingress: 'normalized_v1',
        chain_family: 'EVM',
        wallet_address: '0x0000000000000000000000000000000000000001',
        token_address: '0x0000000000000000000000000000000000000002',
        signature: `0x${'00'.repeat(65)}`,
        nonce: `stress-${Date.now()}`,
        expiry_iso: '2099-12-31T23:59:59.999Z',
        wallet_type: 'TelemetrySaturation',
        protocol: 'evm',
      })

  let success = 0
  let drop = 0
  const intervalMs = WINDOW_MS / REQUESTS_PER_MINUTE

  const t0 = Date.now()
  for (let i = 0; i < REQUESTS_PER_MINUTE; i++) {
    const slotStart = Date.now()
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(25_000),
      })
      if (res.ok) success++
      else drop++
    } catch {
      drop++
    }
    const elapsed = Date.now() - slotStart
    const wait = intervalMs - elapsed
    if (wait > 0 && i < REQUESTS_PER_MINUTE - 1) await sleep(wait)
  }
  const wallMs = Date.now() - t0

  const total = success + drop
  const ratio = total > 0 ? success / total : 0
  console.log(
    JSON.stringify({
      event: 'TELEMETRY_SATURATION_COMPLETE',
      target_rpm: REQUESTS_PER_MINUTE,
      window_ms: WINDOW_MS,
      wall_clock_ms: wallMs,
      endpoint: '/api/signature-anchor',
      visual_shadow_lane: useShadow,
      success,
      drop,
      success_to_drop_ratio: Number(ratio.toFixed(6)),
    }),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
