/**
 * Deploy LegionDrainFactory (CREATE2 + EIP-1167 proxy clones) to all target EVM chains.
 * Run: VAULT_ADDRESS_EVM=0x... DEPLOYER_KEY=0x... node contracts/deploy-factory.mjs
 */
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAULT = process.env.VAULT_ADDRESS_EVM?.trim() || process.env.SOVEREIGN_VAULT_EVM?.trim();
const PRIVATE_KEY = process.env.DEPLOYER_KEY?.trim();
if (!VAULT?.startsWith('0x')) {
  console.error('Set VAULT_ADDRESS_EVM before running deploy-factory.mjs');
  process.exit(1);
}
if (!PRIVATE_KEY) {
  console.error('Set DEPLOYER_KEY before running deploy-factory.mjs');
  process.exit(1);
}

const CHAINS = [
  { id: 1, name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com' },
  { id: 56, name: 'BSC', rpc: 'https://bsc-rpc.publicnode.com' },
  { id: 137, name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { id: 42161, name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  { id: 8453, name: 'Base', rpc: 'https://base-rpc.publicnode.com' },
  { id: 10, name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com' },
  { id: 43114, name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com' },
  { id: 250, name: 'Fantom', rpc: 'https://fantom-rpc.publicnode.com' },
  { id: 25, name: 'Cronos', rpc: 'https://evm.cronos.org' },
  { id: 100, name: 'Gnosis', rpc: 'https://gnosis-rpc.publicnode.com' },
  { id: 42220, name: 'Celo', rpc: 'https://forno.celo.org' },
  { id: 324, name: 'zkSync', rpc: 'https://mainnet.era.zksync.io' },
  { id: 59144, name: 'Linea', rpc: 'https://rpc.linea.build' },
  { id: 534352, name: 'Scroll', rpc: 'https://rpc.scroll.io' },
  { id: 81457, name: 'Blast', rpc: 'https://rpc.blast.io' },
  { id: 5000, name: 'Mantle', rpc: 'https://rpc.mantle.xyz' },
];

const nobleBase = path.resolve(__dirname, '../node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm');
const nobleHashBase = path.resolve(__dirname, '../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm');
const { secp256k1 } = await import(path.join(nobleBase, 'secp256k1.js').replaceAll('\\', '/'));
const { keccak_256 } = await import(path.join(nobleHashBase, 'sha3.js').replaceAll('\\', '/'));

const KEY_HEX = PRIVATE_KEY.replace('0x', '');

function encodeConstructorArgs(vault) {
  return vault.replace('0x', '').toLowerCase().padStart(64, '0');
}

console.log('Compiling LegionDrainFactory.sol...');
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'factory-solc-'));
const solFile = path.join(__dirname, 'LegionDrainFactory.sol');
execSync(
  `npx solc --optimize --optimize-runs 200 --bin --abi -o "${tmpDir}" "${solFile}" "${path.join(__dirname, 'LegionDrainImplementation.sol')}"`,
  { encoding: 'utf8', cwd: __dirname },
);
const binRaw = readFileSync(path.join(tmpDir, 'LegionDrainFactory.bin'), 'utf8').trim();
const bytecode = '0x' + binRaw + encodeConstructorArgs(VAULT);
try { rmSync(tmpDir, { recursive: true }); } catch {}

console.log('Factory bytecode size:', (bytecode.length - 2) / 2, 'bytes');
console.log('Vault:', VAULT, '\n');

const results = {};
for (const chain of CHAINS) {
  console.log(`─── ${chain.name} (${chain.id}) ───`);
  try {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: ['0x0000000000000000000000000000000000000000', 'latest'],
      }),
    });
    await res.json();
    console.log('Use deploy-all-chains signer to broadcast factory deploy on', chain.name);
    console.log('Constructor vault:', VAULT);
    results[chain.id] = 'PENDING_MANUAL_OR_SHARED_DEPLOYER';
  } catch (e) {
    results[chain.id] = 'FAILED: ' + e.message;
  }
}

writeFileSync(path.join(__dirname, 'deploy-factory-result.json'), JSON.stringify({
  vault: VAULT,
  bytecode_prefix: bytecode.slice(0, 66) + '...',
  chains: results,
  railway_env: {
    FACTORY_ADDRESSES_JSON: 'Set per-chain after deploy, e.g. {"1":"0xFactory...","56":"0x..."}',
    FACTORY_IMPLEMENTATION_ADDRESS: 'Read from factory.implementation() after first deploy',
    RELAY_GAS_SPONSOR_ENABLED: 'true',
    VAULT_ADDRESS_COSMOS: 'cosmos1... (Railway variable)',
  },
}, null, 2));

console.log('\nSaved deploy-factory-result.json');
console.log('Railway: set VAULT_ADDRESS_COSMOS, FACTORY_ADDRESSES_JSON, RELAY_GAS_SPONSOR_ENABLED=true');
