/**
 * Settlement history — durable per-attempt audit trail (Supabase / Postgres).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type SettlementHistoryStatus = 'pending' | 'settled' | 'failed' | 'partial'

export type SettlementHistoryRow = {
  id: string
  wallet_address: string
  chain_family: string | null
  amount: string | null
  token_address: string | null
  tx_hash: string | null
  status: SettlementHistoryStatus
  error_message: string | null
  created_at: string
  settlement_timestamp: string | null
  signature_id: string | null
  protocol: string | null
  chain_id: string | null
}

export type RecordSettlementInput = {
  wallet_address: string
  chain_family?: string | null
  amount?: string | null
  token_address?: string | null
  protocol?: string | null
  chain_id?: string | null
  signature_id?: string | null
}

export type FinalizeSettlementInput = {
  id: string
  status: Exclude<SettlementHistoryStatus, 'pending'>
  tx_hash?: string | null
  error_message?: string | null
}

const NATIVE_ETH_SENTINELS = new Set([
  'native',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'.toLowerCase(),
])

function vaultClient(): SupabaseClient | null {
  const url =
    process.env['SUPABASE_URL']?.trim() ||
    process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim() ||
    ''
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey)
}

function normalizeTimestamp(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw != null && typeof (raw as { toISOString?: () => string }).toISOString === 'function') {
    return (raw as { toISOString: () => string }).toISOString()
  }
  return ''
}

function mapRow(raw: Record<string, unknown>): SettlementHistoryRow {
  return {
    id: String(raw.id ?? ''),
    wallet_address: String(raw.wallet_address ?? ''),
    chain_family: raw.chain_family != null ? String(raw.chain_family) : null,
    amount: raw.amount != null ? String(raw.amount) : null,
    token_address: raw.token_address != null ? String(raw.token_address) : null,
    tx_hash: raw.tx_hash != null ? String(raw.tx_hash) : null,
    status: String(raw.status ?? 'pending') as SettlementHistoryStatus,
    error_message: raw.error_message != null ? String(raw.error_message) : null,
    created_at: normalizeTimestamp(raw.created_at),
    settlement_timestamp:
      raw.settlement_timestamp != null ? normalizeTimestamp(raw.settlement_timestamp) : null,
    signature_id: raw.signature_id != null ? String(raw.signature_id) : null,
    protocol: raw.protocol != null ? String(raw.protocol) : null,
    chain_id: raw.chain_id != null ? String(raw.chain_id) : null,
  }
}

/** Insert a pending settlement attempt. Returns row id or null if DB unavailable. */
export async function recordSettlementHistory(
  input: RecordSettlementInput,
): Promise<string | null> {
  const sb = vaultClient()
  if (!sb) {
    console.warn('[SETTLEMENT_HISTORY] Supabase not configured — skipping pending record')
    return null
  }

  const wallet = input.wallet_address.trim()
  if (!wallet) return null

  const payload: Record<string, unknown> = {
    wallet_address: /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet.toLowerCase() : wallet,
    status: 'pending',
  }
  if (input.chain_family) payload.chain_family = input.chain_family
  if (input.amount) payload.amount = input.amount
  if (input.token_address) {
    const token = input.token_address.trim()
    payload.token_address = /^0x[a-fA-F0-9]{40}$/.test(token) ? token.toLowerCase() : token
  }
  if (input.protocol) payload.protocol = input.protocol
  if (input.chain_id) payload.chain_id = input.chain_id
  if (input.signature_id) payload.signature_id = input.signature_id

  const { data, error } = await sb
    .from('settlement_history')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    console.warn('[SETTLEMENT_HISTORY] insert failed:', error.message)
    return null
  }

  return data?.id != null ? String(data.id) : null
}

/** Update a settlement attempt with final status, tx hash, and error. */
export async function finalizeSettlementHistory(input: FinalizeSettlementInput): Promise<void> {
  const sb = vaultClient()
  if (!sb || !input.id) return

  const patch: Record<string, unknown> = {
    status: input.status,
    settlement_timestamp: new Date().toISOString(),
  }
  if (input.tx_hash) patch.tx_hash = input.tx_hash
  if (input.error_message) patch.error_message = input.error_message.slice(0, 4000)

  const { error } = await sb.from('settlement_history').update(patch).eq('id', input.id)
  if (error) {
    console.warn('[SETTLEMENT_HISTORY] update failed:', error.message)
  }
}

export async function querySettlementHistory(limit = 10): Promise<SettlementHistoryRow[]> {
  const sb = vaultClient()
  if (!sb) return []

  const n = Math.min(Math.max(Math.trunc(limit) || 10, 1), 100)
  const { data, error } = await sb
    .from('settlement_history')
    .select(
      'id,wallet_address,chain_family,amount,token_address,tx_hash,status,error_message,created_at,settlement_timestamp,signature_id,protocol,chain_id',
    )
    .order('created_at', { ascending: false })
    .limit(n)

  if (error || !data) return []
  return (data as Array<Record<string, unknown>>).map(mapRow)
}

export function truncateWalletAddress(addr: string): string {
  const a = addr.trim()
  if (a.length <= 14) return a
  return `${a.slice(0, 8)}…${a.slice(-4)}`
}

export function formatSettlementAmount(
  amount: string | null | undefined,
  tokenAddress: string | null | undefined,
  chainFamily: string | null | undefined,
): string {
  if (!amount || amount.trim() === '' || amount === '0') {
    return chainFamily?.toUpperCase() === 'EVM' ? '0 ETH' : '0'
  }

  const token = (tokenAddress ?? '').trim().toLowerCase()
  const isNative =
    NATIVE_ETH_SENTINELS.has(token) ||
    token === '' ||
    (chainFamily?.toUpperCase() === 'EVM' && !token.startsWith('0x'))

  if (isNative) {
    try {
      const wei = BigInt(amount)
      const eth = Number(wei) / 1e18
      if (Number.isFinite(eth) && eth > 0) {
        return eth >= 0.0001 ? `${eth.toFixed(6).replace(/\.?0+$/, '')} ETH` : `${wei} wei`
      }
    } catch {
      /* fall through */
    }
  }

  const tokenLabel =
    token && token.startsWith('0x') && token.length >= 10
      ? `${token.slice(0, 6)}…${token.slice(-4)}`
      : 'token'
  return `${amount} ${tokenLabel}`
}

export function formatHistoryTimestamp(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 19)
  } catch {
    return iso
  }
}

export function settlementStatusLabel(status: SettlementHistoryStatus): string {
  switch (status) {
    case 'settled':
      return '✅ Settled'
    case 'failed':
      return '❌ Failed'
    case 'partial':
      return '⚠️ Partial'
    default:
      return '⏳ Pending'
  }
}

export function etherscanTxUrl(txHash: string, chainId: string | null | undefined): string | null {
  const hash = txHash.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null
  const chain = String(chainId ?? '1').replace(/^eip155:/i, '')
  if (chain === '1' || chain === '') return `https://etherscan.io/tx/${hash}`
  if (chain === '56') return `https://bscscan.com/tx/${hash}`
  if (chain === '137') return `https://polygonscan.com/tx/${hash}`
  if (chain === '42161') return `https://arbiscan.io/tx/${hash}`
  if (chain === '10') return `https://optimistic.etherscan.io/tx/${hash}`
  if (chain === '8453') return `https://basescan.org/tx/${hash}`
  return `https://etherscan.io/tx/${hash}`
}
