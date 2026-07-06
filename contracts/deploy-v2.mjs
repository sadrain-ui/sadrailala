/**
 * Deploy BatchDrainV2 using viem (already in workspace)
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEPLOYER_KEY = process.env.DEPLOYER_KEY?.trim();
if (!DEPLOYER_KEY) {
  console.error('Set DEPLOYER_KEY in environment before running deploy-v2.mjs');
  process.exit(1);
}
const RPC_URL = process.env.RPC_ETHEREUM_PRIVATE || process.env.RPC_ETHEREUM_BACKUP || 'https://eth.llamarpc.com';

// Compile BatchDrainV2.sol
console.log('Compiling BatchDrainV2.sol...');
const solFile = path.join(__dirname, 'BatchDrainV2.sol');
const out = execSync(
  `npx solc --optimize --optimize-runs 200 --combined-json abi,bin "${solFile}"`,
  { encoding: 'utf8', cwd: __dirname }
);

const compiled = JSON.parse(out);
const key = Object.keys(compiled.contracts).find(k => k.includes('BatchDrainV2'));
if (!key) { console.error('Not found:', Object.keys(compiled.contracts)); process.exit(1); }

const abi = compiled.contracts[key].abi;
const bytecode = '0x' + compiled.contracts[key].bin;
console.log('Bytecode size:', bytecode.length / 2 - 1, 'bytes');

// Deploy using viem from workspace
const { createWalletClient, createPublicClient, http } = await import('../node_modules/viem/dist/esm/index.js');
const { privateKeyToAccount } = await import('../node_modules/viem/dist/esm/accounts/index.js');
const { mainnet } = await import('../node_modules/viem/dist/esm/chains/index.js');

const account = privateKeyToAccount(DEPLOYER_KEY);
const publicClient = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: mainnet, transport: http(RPC_URL) });

console.log('Deploying from:', account.address);
const bal = await publicClient.getBalance({ address: account.address });
console.log('Balance:', (Number(bal) / 1e18).toFixed(6), 'ETH');

const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [],
});

console.log('Tx hash:', hash);
console.log('Waiting for confirmation...');

const receipt = await publicClient.waitForTransactionReceipt({ hash });
const addr = receipt.contractAddress;

console.log('\n✅ BatchDrainV2 deployed at:', addr);
writeFileSync(path.join(__dirname, 'deploy-v2-address.txt'), addr);
console.log('Saved to deploy-v2-address.txt');
