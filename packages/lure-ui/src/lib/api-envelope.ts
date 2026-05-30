/**
 * Parses Legion API standard envelope: { success, message, data }.
 */
export type ApiEnvelope<T = unknown> = {
  success: boolean
  message: string
  data: T | null
}

export function readApiMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback
  const p = payload as Record<string, unknown>
  if (typeof p.message === 'string' && p.message.trim() !== '') return p.message
  if (typeof p.error === 'string' && p.error.trim() !== '') return p.error
  return fallback
}

export async function parseApiEnvelope<T>(res: Response): Promise<{
  ok: boolean
  message: string
  data: T | null
  raw: unknown
}> {
  const raw: unknown = await res.json().catch(() => null)
  if (typeof raw === 'object' && raw !== null && 'success' in raw) {
    const env = raw as ApiEnvelope<T>
    return {
      ok: res.ok && env.success === true,
      message: readApiMessage(raw, res.statusText),
      data: env.data ?? null,
      raw,
    }
  }
  return {
    ok: res.ok,
    message: readApiMessage(raw, res.statusText),
    data: raw as T,
    raw,
  }
}
