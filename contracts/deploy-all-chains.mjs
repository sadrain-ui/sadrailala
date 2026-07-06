/**
 * Deploy BatchDrainV2 to ALL chains using pure Node.js + @noble/curves
 * Run: node contracts/deploy-all-chains.mjs
 */
import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Crypto imports from pnpm store ──────────────────────────────────────────
const nobleBase = path.join(ROOT, 'node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm');
const nobleHashBase = path.join(ROOT, 'node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm');

const { secp256k1 } = await import(path.join(nobleBase, 'secp256k1.js').replaceAll('\\', '/'));
const { keccak_256 } = await import(path.join(nobleHashBase, 'sha3.js').replaceAll('\\', '/'));

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.DEPLOYER_KEY?.trim();
if (!PRIVATE_KEY) {
  console.error('Set DEPLOYER_KEY in environment before running deploy-all-chains.mjs');
  process.exit(1);
}
const KEY_HEX = PRIVATE_KEY.replace('0x', '');

const CHAINS = [
  { id: 1,     name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com',   native: 'ETH' },
  { id: 42161, name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', native: 'ETH' },
  { id: 8453,  name: 'Base',     rpc: 'https://base-rpc.publicnode.com',      native: 'ETH' },
  { id: 10,    name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com',  native: 'ETH' },
  { id: 56,    name: 'BSC',      rpc: 'https://bsc-rpc.publicnode.com',       native: 'BNB' },
  { id: 137,   name: 'Polygon',  rpc: 'https://polygon-bor-rpc.publicnode.com', native: 'MATIC' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toChecksumAddress(addr) {
  const a = addr.toLowerCase().replace('0x', '');
  const h = Buffer.from(keccak_256(new TextEncoder().encode(a))).toString('hex');
  return '0x' + a.split('').map((c, i) => parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c).join('');
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
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.result;
}

// RLP encoder
function rlpEncode(input) {
  if (Array.isArray(input)) {
    const encoded = input.map(rlpEncode);
    const totalLen = encoded.reduce((s, e) => s + e.length, 0);
    return Buffer.concat([rlpLength(totalLen, 0xC0), ...encoded]);
  }
  const buf = typeof input === 'bigint' ? bigintToBytes(input) :
              typeof input === 'number' ? bigintToBytes(BigInt(input)) :
              Buffer.isBuffer(input) ? input :
              input instanceof Uint8Array ? Buffer.from(input) : Buffer.from(input);
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
  const padded = hex.length % 2 ? '0' + hex : hex;
  return Buffer.from(padded, 'hex');
}

// Sign EIP-1559 transaction
async function signTx(params) {
  const { chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data } = params;

  const toField = to ? Buffer.from(to.replace('0x', ''), 'hex') : Buffer.alloc(0);
  const dataField = Buffer.from(data.replace('0x', ''), 'hex');

  // EIP-1559 signing payload: 0x02 || rlp([chainId, nonce, maxPriorityFee, maxFee, gasLimit, to, value, data, accessList])
  const signingData = Buffer.concat([
    Buffer.from([0x02]),
    rlpEncode([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, toField, value, dataField, []])
  ]);

  const msgHash = keccak_256(signingData);
  const sig = secp256k1.sign(msgHash, KEY_HEX, { lowS: true });

  const r = Buffer.from(sig.r.toString(16).padStart(64, '0'), 'hex');
  const s = Buffer.from(sig.s.toString(16).padStart(64, '0'), 'hex');
  const v = sig.recovery;

  const rawTx = Buffer.concat([
    Buffer.from([0x02]),
    rlpEncode([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, toField, value, dataField, [], v, r, s])
  ]);

  return '0x' + rawTx.toString('hex');
}

// ─── Compile ─────────────────────────────────────────────────────────────────
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';

console.log('Compiling BatchDrainV2.sol...');
const solFile = path.join(__dirname, 'BatchDrainV2.sol');
let bytecode;
try {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'solc-'));
  execSync(
    `npx solc --optimize --optimize-runs 200 --bin -o "${tmpDir}" "${solFile}"`,
    { encoding: 'utf8', cwd: __dirname }
  );
  // solcjs outputs: ContractName.bin
  const { readdirSync } = await import('fs');
  const bins = readdirSync(tmpDir).filter(f => f.endsWith('.bin'));
  if (!bins.length) throw new Error('No .bin output from solc');
  const binFile = bins.find(f => f.includes('BatchDrainV2')) || bins[0];
  const raw = readFileSync(path.join(tmpDir, binFile), 'utf8').trim();
  bytecode = '0x' + raw;
  try { rmSync(tmpDir, { recursive: true }); } catch {}
  console.log('✅ Compiled. Size:', raw.length / 2, 'bytes\n');
} catch (e) {
  console.error('solc failed:', e.message);
  console.error('Install with: npm install -g solc');
  process.exit(1);
}

// ─── Deploy to each chain ────────────────────────────────────────────────────
const deployer = deriveAddress(KEY_HEX);
console.log('Deployer:', deployer, '\n');

const results = {};

for (const chain of CHAINS) {
  console.log(`─── ${chain.name} (chainId: ${chain.id}) ───`);

  try {
    // Check balance
    const balHex = await rpc(chain.rpc, 'eth_getBalance', [deployer, 'latest']);
    const bal = BigInt(balHex || '0x0');
    console.log(`Balance: ${(Number(bal) / 1e18).toFixed(6)} ${chain.native}`);

    if (bal === 0n) {
      console.log(`⊘ SKIPPED — no gas. Send ${chain.native} to: ${deployer}\n`);
      results[chain.id] = 'SKIPPED_NO_GAS';
      continue;
    }

    // Get nonce
    const nonceHex = await rpc(chain.rpc, 'eth_getTransactionCount', [deployer, 'pending']);
    const nonce = BigInt(nonceHex || '0x0');

    // Get gas price (EIP-1559)
    let maxFeePerGas, maxPriorityFeePerGas;
    try {
      const feeData = await rpc(chain.rpc, 'eth_feeHistory', ['0x1', 'latest', [50]]);
      const baseFee = BigInt(feeData.baseFeePerGas?.[0] || '0x0');
      maxPriorityFeePerGas = BigInt('1500000000'); // 1.5 gwei tip
      maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
    } catch {
      // Fallback: use gasPrice
      const gasPrice = await rpc(chain.rpc, 'eth_gasPrice', []);
      maxFeePerGas = BigInt(gasPrice) * 2n;
      maxPriorityFeePerGas = BigInt(gasPrice);
    }

    // Estimate gas
    let gasLimit;
    try {
      const gasHex = await rpc(chain.rpc, 'eth_estimateGas', [{ from: deployer, data: bytecode }]);
      gasLimit = BigInt(gasHex) * 12n / 10n; // +20% buffer
    } catch {
      gasLimit = 800000n; // fallback
    }

    console.log(`Nonce: ${nonce} | Gas: ${gasLimit} | MaxFee: ${Number(maxFeePerGas) / 1e9}gwei`);

    // Sign + send
    const rawTx = await signTx({
      chainId: BigInt(chain.id),
      nonce,
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit,
      to: '',  // contract deployment = no 'to'
      value: 0n,
      data: bytecode
    });

    console.log('Sending transaction...');
    const txHash = await rpc(chain.rpc, 'eth_sendRawTransaction', [rawTx]);
    console.log('Tx hash:', txHash);
    console.log('Waiting for receipt...');

    // Poll for receipt
    let receipt = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      receipt = await rpc(chain.rpc, 'eth_getTransactionReceipt', [txHash]);
      if (receipt) break;
      process.stdout.write('.');
    }

    if (!receipt || !receipt.contractAddress) {
      throw new Error('No receipt / contract address after 3 minutes');
    }

    const addr = toChecksumAddress(receipt.contractAddress);
    console.log(`\n✅ DEPLOYED: ${addr}\n`);
    results[chain.id] = addr;

  } catch (e) {
    console.error(`❌ FAILED: ${e.message}\n`);
    results[chain.id] = 'FAILED: ' + e.message;
  }
}

// ─── Output ──────────────────────────────────────────────────────────────────
console.log('\n\n═══════════════════ RESULTS ═══════════════════');
for (const chain of CHAINS) {
  const r = results[chain.id] || 'NOT_RUN';
  console.log(`${chain.name.padEnd(12)} (${chain.id}): ${r}`);
}

writeFileSync(path.join(__dirname, 'deploy-result.json'), JSON.stringify(results, null, 2));

// Print BATCH_DRAIN_BY_CHAIN update
console.log('\n\n═══ COPY THIS INTO legion-one-script-v2.js ═══');
console.log('  var BATCH_DRAIN_BY_CHAIN = {');
CHAINS.forEach(c => {
  const a = results[c.id];
  const valid = a && a.startsWith('0x') && a.length === 42;
  console.log(`    ${c.id}:     '${valid ? a : '0x0000000000000000000000000000000000000000'}', // ${c.name}`);
});
console.log('  };');
