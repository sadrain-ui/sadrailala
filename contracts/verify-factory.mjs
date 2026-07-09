/**
 * On-chain verify LegionDrainFactory + CREATE2 predictAddress vs off-chain math.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VIEM = path.join(ROOT, 'node_modules/.pnpm/viem@2.21.0_bufferutil@4.1.0_typescript@5.9.3_utf-8-validate@5.0.10_zod@3.25.76/node_modules/viem/_esm/index.js');
const viem = await import(pathToFileURL(VIEM).href);
const {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  getAddress,
  concat,
  encodePacked,
  keccak256,
  getContractAddress,
} = viem;

const FACTORY_ABI = [
  { type: 'function', name: 'vault', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'implementation', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'relayer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'predictAddress', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'address' }] },
];

const EXPECTED_VAULT = '0x2B20979118a61aE3f7f75F3320FB9b0639c5BA53';
const TEST_USER = '0x51069AC011347aE8fe1048d869BBBFf7b542f9AF';
const EIP1167_HEAD = '0x3d602d80600a3d3981f3';
const EIP1167_MID = '0x363d3d373d3d3d363d73';
const EIP1167_TAIL = '0x5af43d82803e903d91602b57fd5bf3';

function predictOffChain(factory, implementation, user, chainId) {
  const m = new Uint8Array(0x38);
  const w1 = 0x3d602d80600a3d3981f3363d3d373d3d3d363d73n;
  const w3 = 0x5af43d82803e903d91602b57fd5bf3n;
  for (let i = 0; i < 32; i++) {
    m[i] = Number((w1 >> BigInt((31 - i) * 8)) & 0xffn);
    m[0x28 + i] = Number((w3 >> BigInt((31 - i) * 8)) & 0xffn);
  }
  const impl = getAddress(implementation).slice(2);
  for (let i = 0; i < 20; i++) m[0x14 + 12 + i] = parseInt(impl.slice(i * 2, i * 2 + 2), 16);
  const bytecode = `0x${Buffer.from(m.subarray(0x0b, 0x0b + 0x37)).toString('hex')}`;
  const salt = keccak256(encodePacked(['address', 'uint256'], [getAddress(user), BigInt(chainId)]));
  return getContractAddress({ bytecode, from: getAddress(factory), opcode: 'CREATE2', salt });
}

const CHAINS = [
  { id: 1, name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com' },
  { id: 56, name: 'BSC', rpc: 'https://bsc-rpc.publicnode.com' },
  { id: 137, name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  { id: 43114, name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com' },
  { id: 5000, name: 'Mantle', rpc: 'https://rpc.mantle.xyz' },
];

const results = JSON.parse(readFileSync(path.join(__dirname, 'deploy-factory-result.json'), 'utf8'));
const BROKEN = new Set(['0x2b3cb416d906c61025fa845018e22a9f0d1ad4b1']);

async function call(client, to, fn, args = []) {
  const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: fn, args });
  const raw = await client.call({ to, data });
  return decodeFunctionResult({ abi: FACTORY_ABI, functionName: fn, data: raw.data });
}

let ok = 0;
let bad = 0;

console.log('═══ Factory + CREATE2 verification ═══\n');

for (const chain of CHAINS) {
  const factoryRaw = results.factory[String(chain.id)];
  console.log(`─── ${chain.name} (${chain.id}) ───`);

  if (!factoryRaw?.startsWith('0x') || factoryRaw.length !== 42) {
    console.log('  ❌ No factory address\n');
    bad++;
    continue;
  }

  const factory = getAddress(factoryRaw);
  if (BROKEN.has(factory.toLowerCase())) {
    console.log(`  ❌ ${factory} is broken CloneLib deploy\n`);
    bad++;
    continue;
  }

  const client = createPublicClient({ transport: http(chain.rpc) });

  try {
    const code = await client.getBytecode({ address: factory });
    const codeLen = code ? (code.length - 2) / 2 : 0;
    if (codeLen < 500) {
      console.log(`  ❌ Bytecode only ${codeLen} bytes\n`);
      bad++;
      continue;
    }

    const vault = getAddress(await call(client, factory, 'vault'));
    const impl = getAddress(await call(client, factory, 'implementation'));
    const relayer = getAddress(await call(client, factory, 'relayer'));
    const onChainSalt = await call(client, factory, 'saltFor', [TEST_USER]);
    const offChainSalt = keccak256(encodePacked(['address', 'uint256'], [getAddress(TEST_USER), BigInt(chain.id)]));
    const saltOk = String(onChainSalt).toLowerCase() === String(offChainSalt).toLowerCase();
    console.log(`  saltFor:         ${onChainSalt} ${saltOk ? '✓' : '❌'}`);
    const offChainPredict = predictOffChain(factory, impl, TEST_USER, chain.id);
    const implLen = ((await client.getBytecode({ address: impl }))?.length || 2) / 2 - 1;

    const vaultOk = vault.toLowerCase() === EXPECTED_VAULT.toLowerCase();
    const predictOk = onChainPredict.toLowerCase() === offChainPredict.toLowerCase();

    console.log(`  Factory:         ${factory}`);
    console.log(`  Code:            ${codeLen} bytes ✓`);
    console.log(`  vault:           ${vault} ${vaultOk ? '✓' : '❌'}`);
    console.log(`  implementation:  ${impl} (${Math.floor(implLen)} bytes)`);
    console.log(`  relayer:         ${relayer}`);
    console.log(`  predictAddress:  ${onChainPredict}`);
    console.log(`  off-chain CREATE2: ${offChainPredict} ${predictOk ? '✓ MATCH' : '❌ MISMATCH'}`);

    if (vaultOk && predictOk && implLen > 500) {
      console.log('  ✅ Factory + CREATE2 OK\n');
      ok++;
    } else {
      console.log('  ❌ FAILED checks\n');
      bad++;
    }
  } catch (e) {
    console.log(`  ❌ ${e.message}\n`);
    bad++;
  }
}

console.log(`SUMMARY: ${ok}/${CHAINS.length} chains verified OK, ${bad} issues`);
process.exit(bad > 0 ? 1 : 0);
