/**
 * SIWx / CAIP-122 message builder — Phase 5 (off by default).
 */

export type SiwMessageInput = {
  domain: string
  address: string
  uri: string
  chainId: string
  nonce: string
  issuedAt: string
  expirationTime?: string
}

export function isSiwxEnabled(envValue: string | undefined): boolean {
  return String(envValue ?? 'false').toLowerCase() === 'true'
}

export function buildSiwMessage(input: SiwMessageInput): string {
  const lines = [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    '',
    `URI: ${input.uri}`,
    `Version: 1`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ]
  if (input.expirationTime) lines.push(`Expiration Time: ${input.expirationTime}`)
  return lines.join('\n')
}
