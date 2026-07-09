/**
 * Redeploy LegionDrainFactory with correct bytecode (fixes CloneLib mistaken deploy).
 * Run: DEPLOYER_KEY=0x... VAULT_ADDRESS_EVM=0x2B... node contracts/deploy-factory-only.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
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
if (!PRIVATE_KEY) { console.error('Set DEPLOYER_KEY'); process.exit(1); }

const KEY_HEX = PRIVATE_KEY.replace('0x', '');
const nobleBase = path.join(ROOT, 'node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm');
const nobleHashBase = path.join(ROOT, 'node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm');
const { secp256k1 } = await import(pathToFileURL(path.join(nobleBase, 'secp256k1.js')).href);
const { keccak_256 } = await import(pathToFileURL(path.join(nobleHashBase, 'sha3.js')).href);

const CHAINS = [
  { id: 1, name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', native: 'ETH' },
  { id: 56, name: 'BSC', rpc: 'https://bsc-rpc.publicnode.com', native: 'BNB' },
  { id: 137, name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', native: 'MATIC' },
  { id: 42161, name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', native: 'ETH' },
  { id: 8453, name: 'Base', rpc: 'https://base-rpc.publicnode.com', native: 'ETH' },
  { id: 10, name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com', native: 'ETH' },
  { id: 43114, name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com', native: 'AVAX' },
  { id: 534352, name: 'Scroll', rpc: 'https://rpc.scroll.io', native: 'ETH' },
  { id: 81457, name: 'Blast', rpc: 'https://rpc.blast.io', native: 'ETH' },
  { id: 5000, name: 'Mantle', rpc: 'https://rpc.mantle.xyz', native: 'MNT' },
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
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.result;
}

function encodeAddrArg(addr) { return addr.replace('0x', '').toLowerCase().padStart(64, '0'); }

function rlpEncode(input) {
  if (Array.isArray(input)) {
    const encoded = input.map(rlpEncode);
    const totalLen = encoded.reduce((s, e) => s + e.length, 0);
    return Buffer.concat([rlpLength(totalLen, 0xc0), ...encoded]);
  }
  const buf = typeof input === 'bigint' ? bigintToBytes(input)
    : typeof input === 'number' ? bigintToBytes(BigInt(input))
    : Buffer.isBuffer(input) ? input : Buffer.from(input);
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
  return '0x' + Buffer.concat([
    Buffer.from([0x02]),
    rlpEncode([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, toField, value, dataField, [], v, r, s]),
  ]).toString('hex');
}

const binPath = path.join(__dirname, 'LegionDrainFactory_sol_LegionDrainFactory.bin');
if (!existsSync(binPath)) { console.error('Run solc on LegionDrainFactory.sol first'); process.exit(1); }
const creationBytecode = '0x' + readFileSync(binPath, 'utf8').trim();
const vaultCs = toChecksumAddress(VAULT);
const deployData = creationBytecode + encodeAddrArg(vaultCs);
const bytecodeBytes = (deployData.length - 2) / 2;
if (bytecodeBytes < 4000) { console.error('Factory bytecode too small:', bytecodeBytes); process.exit(1); }

const deployer = deriveAddress(KEY_HEX);
console.log('Factory redeploy — correct bytecode:', bytecodeBytes, 'bytes');
console.log('Vault:', vaultCs, '| Deployer:', deployer, '\n');

const results = {};
for (const chain of CHAINS) {
  console.log(`─── ${chain.name} (${chain.id}) ───`);
  try {
    const bal = BigInt(await rpc(chain.rpc, 'eth_getBalance', [deployer, 'latest']) || '0x0');
    console.log(`Balance: ${(Number(bal) / 1e18).toFixed(6)} ${chain.native}`);
    if (bal === 0n) { results[chain.id] = 'SKIPPED_NO_GAS'; continue; }

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
      maxPriorityFeePerGas = gasPrice;
    }

    let gasLimit = 3000000n;
    try {
      const gasHex = await rpc(chain.rpc, 'eth_estimateGas', [{ from: deployer, data: deployData }]);
      gasLimit = BigInt(gasHex) * 12n / 10n;
    } catch {}

    const rawTx = await signTx({
      chainId: BigInt(chain.id), nonce, maxPriorityFeePerGas, maxFeePerGas,
      gasLimit, to: '', value: 0n, data: deployData,
    });
    const txHash = await rpc(chain.rpc, 'eth_sendRawTransaction', [rawTx]);
    console.log('Tx:', txHash);

    let receipt = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      receipt = await rpc(chain.rpc, 'eth_getTransactionReceipt', [txHash]);
      if (receipt) break;
      process.stdout.write('.');
    }
    if (!receipt?.contractAddress) throw new Error('no contract address');
    const addr = toChecksumAddress(receipt.contractAddress);
    const code = await rpc(chain.rpc, 'eth_getCode', [addr, 'latest']);
    const codeBytes = ((code?.length || 2) - 2) / 2;
    console.log(`\n✅ Factory ${addr} (${codeBytes} bytes on-chain)\n`);
    results[chain.id] = addr;
  } catch (e) {
    console.error(`❌ ${e.message}\n`);
    results[chain.id] = 'FAILED: ' + e.message;
  }
}

const factoryJson = {};
for (const [id, a] of Object.entries(results)) {
  if (typeof a === 'string' && a.startsWith('0x') && a.length === 42) factoryJson[id] = a;
}

const out = path.join(__dirname, 'deploy-factory-result.json');
writeFileSync(out, JSON.stringify({ vault: vaultCs, factory: results, railway: { FACTORY_ADDRESSES_JSON: JSON.stringify(factoryJson) } }, null, 2));

// Merge into deploy-everything-result.json
const everythingPath = path.join(__dirname, 'deploy-everything-result.json');
if (existsSync(everythingPath)) {
  const all = JSON.parse(readFileSync(everythingPath, 'utf8'));
  all.factory = { ...all.factory, ...results };
  all.railway.FACTORY_ADDRESSES_JSON = JSON.stringify(factoryJson);
  writeFileSync(everythingPath, JSON.stringify(all, null, 2));
}

console.log('\n═══ Railway FACTORY_ADDRESSES_JSON ═══');
console.log(JSON.stringify(factoryJson));
console.log('Saved:', out);
