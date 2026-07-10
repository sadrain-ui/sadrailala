/**
 * CAIP-19 asset id parsing — Phase 4 foundation (display/routing only).
 * Format: {caip2}/{assetNamespace}:{assetReference}
 */

export type ParsedCaip19 = {
  caip2: string
  assetNamespace: string
  assetReference: string
  caip19: string
}

export function parseCaip19(assetId: string): ParsedCaip19 | null {
  const raw = String(assetId || '').trim()
  const slash = raw.indexOf('/')
  if (slash <= 0) return null
  const caip2 = raw.slice(0, slash)
  const rest = raw.slice(slash + 1)
  const colon = rest.indexOf(':')
  if (colon <= 0) return null
  const assetNamespace = rest.slice(0, colon)
  const assetReference = rest.slice(colon + 1)
  if (!caip2 || !assetNamespace || !assetReference) return null
  return { caip2, assetNamespace, assetReference, caip19: raw }
}

export function formatErc20Caip19(chainId: number, contract: string): string {
  return `eip155:${chainId}/erc20:${contract.toLowerCase()}`
}
