/**
 * Legion Engine — Hot + Cold wallet production test (28 anchors)
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://sadrailala-production.up.railway.app'
const SIG_EVM =
  '0xaabbccddee112233445566778899aabbccddee112233445566778899aabbccddee112233445566778899aabbccddee112233445566778899aabbccddee1122334400'

const batches = [
  {
    name: 'Batch 1 EVM Hot',
    cases: [
      { id: 'H1', t: 'MetaMask', n: 'hot-mm-001', usd: 5000 },
      { id: 'H2', t: 'WalletConnect', n: 'hot-wc-002', usd: 5000 },
      { id: 'H3', t: 'Coinbase', n: 'hot-cb-003', usd: 5000 },
      { id: 'H4', t: 'Rainbow', n: 'hot-rb-004', usd: 5000 },
      { id: 'H5', t: 'TrustWallet', n: 'hot-tw-005', usd: 5000 },
      { id: 'H6', t: 'Zerion', n: 'hot-zr-006', usd: 5000 },
      { id: 'H7', t: 'Rabby', n: 'hot-rabby-007', usd: 5000 },
      { id: 'H8', t: 'OKXWallet', n: 'hot-okx-008', usd: 5000 },
      { id: 'H9', t: 'BinanceWeb3', n: 'hot-bnb-009', usd: 5000 },
      { id: 'H10', t: 'Safe', n: 'hot-safe-010', usd: 5000 },
    ],
    body: (w) => ({
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      wallet_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      token_address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      signature: SIG_EVM,
      nonce: w.n,
      expiry_iso: '2099-12-31T23:59:59Z',
      wallet_type: w.t,
      protocol: 'evm',
      chain_id: 1,
      scout_value_usd: w.usd,
    }),
  },
  {
    name: 'Batch 2 EVM Cold',
    cases: [
      { id: 'C11', t: 'Ledger', n: 'cold-ledger-011', usd: 25000 },
      { id: 'C12', t: 'Trezor', n: 'cold-trezor-012', usd: 25000 },
      { id: 'C13', t: 'Keystone', n: 'cold-keystone-013', usd: 25000 },
      { id: 'C14', t: 'GridPlus', n: 'cold-gridplus-014', usd: 25000 },
      { id: 'C15', t: 'Coldcard', n: 'cold-coldcard-015', usd: 25000 },
    ],
    body: (w) => ({
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      wallet_address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      token_address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      signature: SIG_EVM,
      nonce: w.n,
      expiry_iso: '2099-12-31T23:59:59Z',
      wallet_type: w.t,
      protocol: 'evm',
      chain_id: 1,
      scout_value_usd: w.usd,
    }),
  },
  {
    name: 'Batch 3 Solana',
    cases: [
      { id: 'S16', t: 'Phantom', n: 'sol-phantom-016', usd: 8000 },
      { id: 'S17', t: 'Solflare', n: 'sol-solflare-017', usd: 8000 },
      { id: 'S18', t: 'Backpack', n: 'sol-backpack-018', usd: 8000 },
      { id: 'S19', t: 'LedgerSolana', n: 'sol-ledger-019', usd: 8000 },
    ],
    body: (w) => ({
      ingress: 'normalized_v1',
      chain_family: 'SVM',
      wallet_address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      token_address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      signature: '5J3mBbAH58CpQ15CNYW8a6pEJ1CgCFDcMrFo4CMRA7pH',
      nonce: w.n,
      expiry_iso: '2099-12-31T23:59:59Z',
      wallet_type: w.t,
      protocol: 'solana',
      chain_id: 0,
      scout_value_usd: w.usd,
    }),
  },
  {
    name: 'Batch 4 Tron',
    cases: [
      { id: 'T20', t: 'TronLink', n: 'tron-hot-020', usd: 3000 },
      { id: 'T21', t: 'TokenPocket', n: 'tron-tp-021', usd: 3000 },
    ],
    body: (w) => ({
      ingress: 'normalized_v1',
      chain_family: 'TRON',
      wallet_address: 'TQHAvs2ZFTbsd9tL9sQTkBMHJnbNyHjXbx',
      token_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      signature: '4e4d7b9c8d2a3f1e5b6c7a8d9e0f1a2b',
      nonce: w.n,
      expiry_iso: '2099-12-31T23:59:59Z',
      wallet_type: w.t,
      protocol: 'tron',
      chain_id: 0,
      scout_value_usd: w.usd,
    }),
  },
  {
    name: 'Batch 5 TON',
    cases: [
      { id: 'N22', t: 'TonKeeper', n: 'ton-keeper-022', usd: 12000 },
      { id: 'N23', t: 'TonWallet', n: 'ton-wallet-023', usd: 12000 },
      { id: 'N24', t: 'MyTonWallet', n: 'ton-mytw-024', usd: 12000 },
    ],
    body: (w) => ({
      ingress: 'normalized_v1',
      chain_family: 'TON',
      wallet_address: 'EQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG',
      token_address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
      signature: 'a1b2c3d4e5f6a7b8',
      nonce: w.n,
      expiry_iso: '2099-12-31T23:59:59Z',
      wallet_type: w.t,
      protocol: 'ton',
      chain_id: 0,
      scout_value_usd: w.usd,
    }),
  },
  {
    name: 'Batch 6 BTC Cold',
    cases: [
      { id: 'B25', t: 'Leather', n: 'btc-leather-025', usd: 75000 },
      { id: 'B26', t: 'Xverse', n: 'btc-xverse-026', usd: 75000 },
      { id: 'B27', t: 'TrezorBTC', n: 'btc-trezor-027', usd: 75000 },
      { id: 'B28', t: 'LedgerBTC', n: 'btc-ledger-028', usd: 75000 },
    ],
    body: (w) => ({
      ingress: 'normalized_v1',
      chain_family: 'UTXO',
      wallet_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      token_address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      signature: '3045022100a1b2c3d4e5f607080',
      nonce: w.n,
      expiry_iso: '2099-12-31T23:59:59Z',
      wallet_type: w.t,
      protocol: 'utxo',
      chain_id: 0,
      scout_value_usd: w.usd,
    }),
  },
]

async function postAnchor(body) {
  const t0 = performance.now()
  const res = await fetch(`${BASE}/api/signature-anchor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return {
    status: res.status,
    ms: Math.round(performance.now() - t0),
    ok: json?.ok === true,
    json,
  }
}

const results = []
let passCount = 0

for (const batch of batches) {
  for (const c of batch.cases) {
    const body = batch.body(c)
    const r = await postAnchor(body)
    const pass = r.status === 200 && r.ok
    if (pass) passCount++
    results.push({
      batch: batch.name,
      id: c.id,
      wallet_type: c.t,
      nonce: c.n,
      chain_family: body.chain_family,
      status: r.status,
      pass,
      ms: r.ms,
      error: r.json?.error ?? null,
      l2: r.json?.l2_mint_transaction_hash ?? null,
    })
    await new Promise((res) => setTimeout(res, 300))
  }
}

const nonces = results.map((r) => r.nonce)

function loadEnv() {
  const text = readFileSync(new URL('../../../../.env', import.meta.url), 'utf8')
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return env
}

let dbReport = { ok: false, matched: 0, rows: [] }
const env = loadEnv()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (url && key) {
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await sb
    .from('signatures')
    .select('wallet_type,protocol,scout_value_usd,settlement_status,nonce,created_at,chain_id')
    .in('nonce', nonces)
    .order('created_at', { ascending: false })

  if (!error && data) {
    dbReport.matched = data.length
    dbReport.rows = data
    dbReport.ok = data.length >= 28
    const types = new Set(data.map((r) => r.wallet_type))
    dbReport.unique_wallet_types = types.size
    dbReport.wallet_types = [...types]
  } else {
    dbReport.error = error?.message ?? 'query failed'
  }
}

console.log(
  JSON.stringify(
    {
      base: BASE,
      total: results.length,
      api_pass: passCount,
      api_fail: results.length - passCount,
      results,
      db: dbReport,
    },
    null,
    2,
  ),
)
