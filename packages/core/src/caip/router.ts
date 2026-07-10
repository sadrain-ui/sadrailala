import { eip155Caip2 } from './constants.js'
import { familyFromCaip2, type CaipFamily } from './family-map.js'

export type ResolvedChainIngress = {
  chainFamily: CaipFamily
  caipChainId: string | null
  evmChainId: number | null
  /** Value stored in signatures.chain_id (EVM numeric or CAIP-2 for non-EVM). */
  storageChainId: string | null
}

export function isCaip2ChainId(raw: string): boolean {
  const s = String(raw || '').trim()
  if (!s) return false
  if (/^\d+$/.test(s)) return false
  return /^[a-z0-9]+:/i.test(s)
}

/** Parse EVM numeric chain id only — never coerce bip122/solana CAIP-2 to Number (P3-5). */
export function parseEvmChainIdNumeric(raw: unknown): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (isCaip2ChainId(s)) {
    if (s.toLowerCase().startsWith('eip155:')) {
      const n = Number.parseInt(s.slice(7), 10)
      return Number.isFinite(n) && n > 0 ? n : null
    }
    return null
  }
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Normalize ingress chain fields → family + caip_chain_id + storage chain_id.
 * EVM: chain_id stays numeric string; caip_chain_id = eip155:{n}.
 * Non-EVM: prefer explicit caip_chain_id; chain_id may mirror CAIP-2.
 */
export function resolveChainIngress(input: {
  chain_family?: string | null
  chain_id?: number | string | null
  caip_chain_id?: string | null
}): ResolvedChainIngress {
  const familyHint = String(input.chain_family ?? '').trim().toUpperCase()
  const caipExplicit =
    input.caip_chain_id != null && String(input.caip_chain_id).trim() !== ''
      ? String(input.caip_chain_id).trim()
      : null
  const chainRaw = input.chain_id != null ? String(input.chain_id).trim() : ''

  let caipChainId = caipExplicit
  if (!caipChainId && chainRaw && isCaip2ChainId(chainRaw)) {
    caipChainId = chainRaw
  }

  if (caipChainId) {
    const family = familyFromCaip2(caipChainId)
    const evm =
      family === 'EVM' && caipChainId.toLowerCase().startsWith('eip155:')
        ? parseEvmChainIdNumeric(caipChainId)
        : null
    return {
      chainFamily: family,
      caipChainId,
      evmChainId: evm,
      storageChainId: evm != null ? String(evm) : caipChainId,
    }
  }

  const evm = parseEvmChainIdNumeric(chainRaw || (familyHint === 'EVM' || !familyHint ? '1' : ''))
  if (familyHint === 'EVM' || familyHint === '' || evm != null) {
    const id = evm ?? 1
    return {
      chainFamily: 'EVM',
      caipChainId: eip155Caip2(id),
      evmChainId: id,
      storageChainId: String(id),
    }
  }

  return {
    chainFamily: (familyHint || 'UNKNOWN') as CaipFamily,
    caipChainId: null,
    evmChainId: null,
    storageChainId: chainRaw || null,
  }
}
