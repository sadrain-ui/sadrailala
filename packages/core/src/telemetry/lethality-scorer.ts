/**
 * @file lethality-scorer.ts
 * @module @legion/core/telemetry
 *
 * Schema Hardened lethality scorer for high-net-worth paths.
 * Returns decimal-string BigInt outputs for DB-safe persistence.
 */

const WHALE_USD_THRESHOLD_CENTS = 100_000_000n // $1,000,000.00

function toScaledInteger(value: string, scale: number): bigint {
  const [whole = '0', frac = ''] = value.trim().split('.')
  const normalizedFrac = frac.padEnd(scale, '0').slice(0, scale)
  const sign = whole.startsWith('-') ? -1n : 1n
  const absWhole = whole.replace('-', '')
  const combined = `${absWhole}${normalizedFrac}`.replace(/^0+/, '') || '0'
  return sign * BigInt(combined)
}

function emitTelemetry(msg: string, extra?: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({
    level: 30,
    time: Date.now(),
    msg,
    sentinel: 'Telemetry',
    module: 'telemetry/lethality-scorer',
    ...(extra ?? {}),
  }) + '\n')
}

/**
 * Computes lethality score as decimal-string BigInt.
 *
 * Inputs are decimal strings:
 * - usdValueDec: total asset USD value (e.g. "1234567.8901")
 * - gasUsdDec:   estimated protocol cost in USD (e.g. "12.34")
 */
export function computeLethalityScoreBigIntString(
  usdValueDec: string,
  gasUsdDec: string,
): string {
  const usdCents = toScaledInteger(usdValueDec, 2)
  const gasCents = toScaledInteger(gasUsdDec, 2)
  const score = usdCents - gasCents
  const nonNegative = score > 0n ? score : 0n

  if (usdCents >= WHALE_USD_THRESHOLD_CENTS) {
    emitTelemetry('Whale-Tag', {
      signal: 'Billion-Dollar Telemetry Locked',
      usd_cents: usdCents.toString(),
      score_cents: nonNegative.toString(),
    })
  }

  return nonNegative.toString()
}

export function emitSchemaHardenedTelemetry(): void {
  emitTelemetry('SCHEMA_HARDENED: High-Net-Worth telemetry support locked. BigInt overflow resolved.', {
    signal: 'Schema Hardened',
  })
}

