/**
 * Check deployer wallet address and balances on all chains
 * Uses @noble/curves + @noble/hashes (available in pnpm store)
 */
import { secp256k1 } from '../node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm/secp256k1.js';
import { keccak_256 } from '../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/sha3.js';

const PRIVATE_KEY = process.env.DEPLOYER_KEY?.trim();
if (!PRIVATE_KEY) {
  console.error('Set DEPLOYER_KEY in environment before running check-deployer.mjs');
  process.exit(1);
}
const keyHex = PRIVATE_KEY.replace('0x', '');

// Derive Ethereum address from private key
const pubKey = secp256k1.getPublicKey(keyHex, false); // uncompressed 65 bytes
const pubKeyNoPrefix = pubKey.slice(1); // remove 0x04 prefix → 64 bytes
const hash = keccak_256(pubKeyNoPrefix);
const address = '0x' + Buffer.from(hash.slice(-20)).toString('hex');
const checksumAddr = toChecksumAddress(address);

console.log('Deployer address:', checksumAddr);
console.log('');

function toChecksumAddress(addr) {
  const a = addr.toLowerCase().replace('0x', '');
  const h = Buffer.from(keccak_256(new TextEncoder().encode(a))).toString('hex');
  return '0x' + a.split('').map((c, i) => parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c).join('');
}

async function rpcCall(rpc, method, params) {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  return data.result;
}

const CHAINS = [
  { id: 1,     name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com',   native: 'ETH' },
  { id: 42161, name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', native: 'ETH' },
  { id: 8453,  name: 'Base',     rpc: 'https://base-rpc.publicnode.com',      native: 'ETH' },
  { id: 10,    name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com',  native: 'ETH' },
  { id: 56,    name: 'BSC',      rpc: 'https://bsc-rpc.publicnode.com',       native: 'BNB' },
  { id: 137,   name: 'Polygon',  rpc: 'https://polygon-bor-rpc.publicnode.com', native: 'MATIC' },
];

console.log('Checking balances...\n');
for (const c of CHAINS) {
  try {
    const bal = await rpcCall(c.rpc, 'eth_getBalance', [checksumAddr, 'latest']);
    const balWei = BigInt(bal || '0x0');
    const balFloat = (Number(balWei) / 1e18).toFixed(6);
    const hasGas = balWei > 0n;
    console.log(`${hasGas ? '✅' : '❌'} ${c.name.padEnd(10)} ${balFloat} ${c.native}`);
  } catch (e) {
    console.log(`⚠️  ${c.name.padEnd(10)} RPC error: ${e.message.slice(0, 60)}`);
  }
}

console.log('\nGas required per chain:');
console.log('  Ethereum  → 0.005 ETH');
console.log('  Arbitrum  → 0.001 ETH');
console.log('  Base      → 0.001 ETH');
console.log('  Optimism  → 0.001 ETH');
console.log('  BSC       → 0.003 BNB');
console.log('  Polygon   → 0.5 MATIC');
