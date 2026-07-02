/**
 * Compile + Deploy BatchDrainV2.sol to ETH Mainnet
 *
 * Run: node contracts/deploy-v2.cjs
 */
const { execSync } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SOL_FILE = path.join(__dirname, 'BatchDrainV2.sol');
const DEPLOYER_KEY = '0x7a1ae3a75a4686a5b529df1701d0d19ddcb6a67c3ce8895413704e745eba9aff';
const RPC_URLS = [
  'https://ethereum.publicnode.com',
  'https://eth.drpc.org',
  'https://cloudflare-eth.com',
  'https://1rpc.io/eth',
  'https://endpoints.omniatech.io/v1/eth/mainnet/public',
  'https://api.stateless.solutions/eth/v1/demo',
];

// ─── Compile ──────────────────────────────────────────────────────
console.log('Compiling BatchDrainV2.sol...');
const solSource = readFileSync(SOL_FILE, 'utf8');

const solcInput = JSON.stringify({
  language: 'Solidity',
  sources: { 'BatchDrainV2.sol': { content: solSource } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } }
  }
});

const rawOut = execSync('npx solc --standard-json', {
  input: solcInput,
  encoding: 'utf8',
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe'],
  maxBuffer: 10 * 1024 * 1024,
});

// Strip warning lines before the JSON object
const jsonIdx = rawOut.indexOf('{');
if (jsonIdx < 0) { console.error('solc no JSON output:', rawOut.slice(0, 300)); process.exit(1); }

const compiled = JSON.parse(rawOut.slice(jsonIdx));
const errs = (compiled.errors || []).filter(e => e.severity === 'error');
if (errs.length) { console.error('Compile errors:\n', errs.map(e => e.message).join('\n')); process.exit(1); }

const contract = compiled.contracts['BatchDrainV2.sol']['BatchDrainV2'];
const abi = contract.abi;
const bytecode = '0x' + contract.evm.bytecode.object;
console.log('Compiled OK —', (bytecode.length - 2) / 2, 'bytes');

// ─── Deploy ───────────────────────────────────────────────────────
async function deploy() {
  const { createWalletClient, createPublicClient, http } = require(path.join(REPO, 'node_modules', 'viem', '_cjs', 'index.js'));
  const { privateKeyToAccount } = require(path.join(REPO, 'node_modules', 'viem', '_cjs', 'accounts', 'index.js'));
  const { mainnet } = require(path.join(REPO, 'node_modules', 'viem', '_cjs', 'chains', 'index.js'));

  const account = privateKeyToAccount(DEPLOYER_KEY);

  // Find a working RPC
  let workingRpc = null;
  let publicClient, walletClient;
  for (const url of RPC_URLS) {
    try {
      process.stdout.write('Trying RPC: ' + url + ' ... ');
      const pc = createPublicClient({ chain: mainnet, transport: http(url) });
      const bal = await pc.getBalance({ address: account.address });
      console.log('OK (' + (Number(bal) / 1e18).toFixed(6) + ' ETH)');
      workingRpc = url;
      publicClient = pc;
      walletClient = createWalletClient({ account, chain: mainnet, transport: http(url) });
      break;
    } catch (e) {
      console.log('FAIL (' + (e.message || '').slice(0, 60) + ')');
    }
  }

  if (!workingRpc) { console.error('\nAll RPCs failed. Check internet connection.'); process.exit(1); }

  console.log('\nDeployer:', account.address);
  const bal = await publicClient.getBalance({ address: account.address });
  console.log('Balance:', (Number(bal) / 1e18).toFixed(6), 'ETH');
  if (Number(bal) < 1e14) { console.error('ERR: Insufficient balance for gas!'); process.exit(1); }

  console.log('Sending deploy tx...');
  const hash = await walletClient.deployContract({ abi, bytecode, args: [] });
  console.log('Tx hash:', hash);
  console.log('Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  const addr = receipt.contractAddress;

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  BatchDrainV2 DEPLOYED!');
  console.log('║  Address: ' + addr);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  writeFileSync(path.join(__dirname, 'deploy-v2-address.txt'), addr);
  console.log('Address saved → contracts/deploy-v2-address.txt');
  console.log('\n>>> Paste this address to Claude to finish the update! <<<\n');
  console.log(addr);
}

deploy().catch(e => { console.error('\nDeploy failed:', e.message || e); process.exit(1); });
