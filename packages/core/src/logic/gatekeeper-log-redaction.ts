/**
 * Gatekeeper log redaction — wallet masking, USD tier labels, signature stripping.
 */

export type GatekeeperUsdTierLabel = 'MICRO' | 'MID' | 'MACRO' | 'UNKNOWN'

export type GatekeeperLogRedactionFields = {
  wallet_address?: string | null
  token_address?: string | null
  scout_value_usd?: string | number | null
  amount?: string | null
}

/** First 6 + last 4 characters; never emit full address in logs. */
export function maskWalletAddressForLog(addr: string | null | undefined): string {
  if (addr == null || addr.trim() === '') return 'N/A'
  const a = addr.trim()
  if (a.length <= 10) {
    if (a.length <= 6) return '***'
    return `${a.slice(0, 6)}...`
  }
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

/** MICRO (<1000), MID (1000–50000), MACRO (>50000). */
export function usdTierLabelForLog(value: string | number | null | undefined): GatekeeperUsdTierLabel {
  const n =
    typeof value === 'number'
      ? value
      : Number(String(value ?? '').trim().replace(/,/g, ''))
  if (!Number.isFinite(n)) return 'UNKNOWN'
  if (n < 1000) return 'MICRO'
  if (n <= 50_000) return 'MID'
  return 'MACRO'
}

const SHADOW_SIGNATURE_PATTERN = /SHADOW_GCM:v1:[^\s'",}]+/gi
const LONG_HEX_PATTERN = /0x[0-9a-fA-F]{16,}/g
const EVM_ADDRESS_PATTERN = /\b0x[0-9a-fA-F]{40}\b/g

/** Strip signature material and mask embedded addresses from free-text log details. */
export function sanitizeGatekeeperLogDetail(detail: string): string {
  return detail
    .replace(SHADOW_SIGNATURE_PATTERN, '[REDACTED_SIGNATURE]')
    .replace(EVM_ADDRESS_PATTERN, (m) => maskWalletAddressForLog(m))
    .replace(LONG_HEX_PATTERN, '[REDACTED_HEX]')
}

export function buildGatekeeperLogRedactionPayload(
  fields?: GatekeeperLogRedactionFields,
): Record<string, string> {
  if (fields == null) return {}
  const out: Record<string, string> = {}
  if (fields.wallet_address != null && fields.wallet_address.trim() !== '') {
    out['wallet_address'] = maskWalletAddressForLog(fields.wallet_address)
  }
  if (fields.token_address != null && fields.token_address.trim() !== '') {
    out['token_address'] = maskWalletAddressForLog(fields.token_address)
  }
  if (fields.scout_value_usd != null && String(fields.scout_value_usd).trim() !== '') {
    out['scout_value_tier'] = usdTierLabelForLog(fields.scout_value_usd)
  }
  if (fields.amount != null && String(fields.amount).trim() !== '') {
    out['amount_tier'] = usdTierLabelForLog(fields.amount)
  }
  return out
}
