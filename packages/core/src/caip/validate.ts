import { parseCaip10 } from './parse.js'

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/
const BTC_ADDRESS = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

export function isValidEvmAddress(addr: string): boolean {
  return EVM_ADDRESS.test(String(addr).trim())
}

export function isValidBtcAddress(addr: string): boolean {
  return BTC_ADDRESS.test(String(addr).trim())
}

export function isValidSolAddress(addr: string): boolean {
  return SOL_ADDRESS.test(String(addr).trim())
}

export function isValidTronAddress(addr: string): boolean {
  return TRON_ADDRESS.test(String(addr).trim())
}

export function validateCaip10Account(accountId: string): boolean {
  const p = parseCaip10(accountId)
  if (!p) return false
  switch (p.namespace) {
    case 'eip155':
      return isValidEvmAddress(p.address)
    case 'bip122':
      return isValidBtcAddress(p.address)
    case 'solana':
      return isValidSolAddress(p.address)
    case 'tron':
      return isValidTronAddress(p.address)
    case 'ton':
    case 'tvm':
      return p.address.length >= 48
    default:
      return p.address.length > 0
  }
}
