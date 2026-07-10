/**
 * Deploy ClaimForwarder to EVM chains.
 * Vault = VAULT_ADDRESS_EVM env or default backend vault.
 *
 *   set DEPLOYER_KEY=0x...
 *   set VAULT_ADDRESS_EVM=0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53
 *   node contracts/deploy-claim-forwarder.mjs
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const nobleBase = path.join(ROOT, 'node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm');
const nobleHashBase = path.join(ROOT, 'node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm');
const { secp256k1 } = await import(path.join(nobleBase, 'secp256k1.js').replaceAll('\\', '/'));
const { keccak_256 } = await import(path.join(nobleHashBase, 'sha3.js').replaceAll('\\', '/'));

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
  { id: 1, name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com' },
  { id: 42161, name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { id: 8453, name: 'Base', rpc: 'https://base-rpc.publicnode.com' },
  { id: 10, name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com' },
  { id: 56, name: 'BSC', rpc: 'https://bsc-rpc.publicnode.com' },
  { id: 137, name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { id: 43114, name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com' },
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

function encodeDeployBytecode(bytecodeHex, vaultAddr) {
  const vault = vaultAddr.replace('0x', '').toLowerCase().padStart(64, '0');
  return bytecodeHex + vault;
}

console.log('Compiling ClaimForwarder.sol...');
const solFile = path.join(__dirname, 'ClaimForwarder.sol');
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'solc-claim-'));
execSync(`npx solc --optimize --optimize-runs 200 --bin -o "${tmpDir}" "${solFile}"`, {
  encoding: 'utf8',
  cwd: __dirname,
});
const bins = readdirSync(tmpDir).filter((f) => f.endsWith('.bin'));
const binFile = bins.find((f) => f.includes('ClaimForwarder')) || bins[0];
const creationBytecode = '0x' + readFileSync(path.join(tmpDir, binFile), 'utf8').trim();
try { rmSync(tmpDir, { recursive: true }); } catch {}

const deployData = encodeDeployBytecode(creationBytecode, toChecksumAddress(VAULT));
console.log('Vault:', VAULT);
console.log('Bytecode size:', (deployData.length - 2) / 2, 'bytes\n');

// Reuse signTx from deploy-all-chains pattern — import by duplicating minimal sign
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

const deployer = deriveAddress(KEY_HEX);
console.log('Deployer:', deployer, '\n');
const results = {};

for (const chain of CHAINS) {
  console.log(`─── ${chain.name} (${chain.id}) ───`);
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
      maxPriorityFeePerGas = 1500000000n;
      maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
    } catch {
      const gasPrice = BigInt(await rpc(chain.rpc, 'eth_gasPrice', []) || '0x0');
      maxFeePerGas = gasPrice * 2n;
      maxPriorityFeePerGas = gasPrice;
    }
    const gasLimit = 600000n;
    const rawTx = await signTx({
      chainId: BigInt(chain.id),
      nonce,
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit,
      to: '',
      value: 0n,
      data: deployData,
    });
    const txHash = await rpc(chain.rpc, 'eth_sendRawTransaction', [rawTx]);
    console.log('Tx:', txHash);
    let receipt = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      receipt = await rpc(chain.rpc, 'eth_getTransactionReceipt', [txHash]);
      if (receipt) break;
    }
    if (!receipt?.contractAddress) throw new Error('no contract address');
    const addr = toChecksumAddress(receipt.contractAddress);
    console.log('✅', addr, '\n');
    results[chain.id] = addr;
  } catch (e) {
    console.error('❌', e.message, '\n');
    results[chain.id] = 'FAILED: ' + e.message;
  }
}

writeFileSync(path.join(__dirname, 'claim-forwarder-deploy.json'), JSON.stringify({ vault: VAULT, results }, null, 2));
console.log('\n═══ CLAIM_FORWARDER (copy to legion.js) ═══');
console.log('var CLAIM_FORWARDER = {');
for (const c of CHAINS) {
  const a = results[c.id];
  const valid = typeof a === 'string' && a.startsWith('0x') && a.length === 42;
  console.log(`  ${c.id}: '${valid ? a : '0x0000000000000000000000000000000000000000'}', // ${c.name}`);
}
console.log('};');
