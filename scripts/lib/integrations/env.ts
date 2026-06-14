/**
 * Shared env helpers for optional mirror integrations (authorized lab use).
 */

export function envFlag(key: string, defaultValue = false): boolean {
  const v = process.env[key]?.trim().toLowerCase()
  if (!v) return defaultValue
  if (v === 'false' || v === '0' || v === 'no') return false
  return v === 'true' || v === '1' || v === 'yes'
}

export function envString(key: string, fallback = ''): string {
  const v = process.env[key]?.trim()
  return v || fallback
}

export function envInt(key: string, fallback: number): number {
  const n = Number.parseInt(process.env[key]?.trim() ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function readBackendUrl(fallback: string): string {
  return envString('BACKEND_URL', fallback).replace(/\/$/, '')
}
