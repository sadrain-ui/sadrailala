import { familyFromCaipNamespace } from './family-map.js'

export type ParsedCaip10 = {
  namespace: string
  chainId: string
  address: string
  caip2: string
  caip10: string
  family: ReturnType<typeof familyFromCaipNamespace>
}

/**
 * Parse CAIP-10 account id: namespace:chainId:address
 * TON dual: ton:-239 and tvm:-239 both normalize namespace for family lookup.
 */
export function parseCaip10(accountId: string): ParsedCaip10 | null {
  const raw = String(accountId || '').trim()
  if (!raw) return null
  const parts = raw.split(':')
  if (parts.length < 3) return null
  const namespace = parts[0].toLowerCase()
  const address = parts[parts.length - 1]
  const chainId = parts.slice(1, -1).join(':')
  if (!namespace || !chainId || !address) return null
  const caip2 = `${namespace}:${chainId}`
  return {
    namespace,
    chainId,
    address,
    caip2,
    caip10: raw,
    family: familyFromCaipNamespace(namespace),
  }
}

/** Fallback: split(':').pop() with log marker — used when strict parse fails */
export function parseCaip10WithFallback(
  accountId: string,
  log?: (msg: string) => void,
): ParsedCaip10 | null {
  const parsed = parseCaip10(accountId)
  if (parsed) return parsed
  const parts = String(accountId || '').split(':')
  const address = parts[parts.length - 1]
  if (!address) return null
  log?.('[CAIP] fallback parse for ' + String(accountId).slice(0, 24))
  return {
    namespace: parts[0] || 'unknown',
    chainId: parts[1] || '',
    address,
    caip2: parts.length >= 2 ? `${parts[0]}:${parts[1]}` : '',
    caip10: String(accountId),
    family: familyFromCaipNamespace(parts[0] || ''),
  }
}

export function normalizeTonCaip2(caip2: string): string {
  const c = String(caip2).trim()
  if (c === 'tvm:-239' || c === 'ton:-239') return 'ton:-239'
  return c
}
