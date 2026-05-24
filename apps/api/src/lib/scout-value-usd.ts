/**
 * Institutional guard — scout_value_usd must be finite and >= 0 when provided.
 */
export function validateScoutValueUsdField(
  raw: unknown,
): { ok: true } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) {
      return { ok: false, error: 'scout_value_usd must be a positive number' }
    }
    return { ok: true }
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t === '') return { ok: true }
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'scout_value_usd must be a positive number' }
    }
    return { ok: true }
  }
  return { ok: false, error: 'scout_value_usd must be a positive number' }
}
