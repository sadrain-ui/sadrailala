#!/usr/bin/env node
/** CAIP registry unit smoke — Phase 1 gate */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function run() {
  const corePath = join(root, 'packages/core/src/caip/constants.ts');
  const legion = readFileSync(join(root, 'clones/uniswap-clone/legion.js'), 'utf8');
  const wallet = readFileSync(join(root, 'clones/uniswap-clone/wallet/src/index.js'), 'utf8');
  const caipJs = readFileSync(join(root, 'clones/uniswap-clone/wallet/src/caip-registry.js'), 'utf8');

  const checks = [
    ['core caip module exists', () => readFileSync(corePath, 'utf8').includes('PRIORITY_EVM_CHAIN_IDS')],
    ['browser caip-registry', () => caipJs.includes('LegionCaipRegistry')],
    ['legion 16-chain PRIORITY_EVM_CHAINS', () => legion.includes('PRIORITY_EVM_CHAINS') && !legion.includes('1101, 1088')],
    ['legion F8 scan-only UTXO', () => legion.includes('addressOnly: !btcProv')],
    ['wallet tvm namespace', () => wallet.includes('ns.tvm')],
    ['wallet resolveWcEvmPairingIds', () => wallet.includes('resolveWcEvmPairingIds')],
    ['migration caip_chain_id', () => readFileSync(join(root, 'packages/core/src/db/migrations/0023_signatures_caip_chain_id.sql'), 'utf8').includes('caip_chain_id')],
    ['pending broadcast cron', () => readFileSync(join(root, 'apps/api/src/cron/pending-broadcast-sweep.ts'), 'utf8').includes('PENDING_BROADCAST')],
    ['caip19 parse', () => readFileSync(join(root, 'packages/core/src/caip/caip19.ts'), 'utf8').includes('parseCaip19')],
    ['legion caip scan wired', () => legion.includes('extractWcAccountAddress') || legion.includes('LegionCaipRegistry.extractWcAccountAddress')],
    ['rpc mesh ETH_RPC_URLS', () => readFileSync(join(root, 'packages/core/src/lib/rpc-mesh.ts'), 'utf8').includes('ETH_RPC_URLS')],
    ['caip router', () => readFileSync(join(root, 'packages/core/src/caip/router.ts'), 'utf8').includes('resolveChainIngress')],
    ['legion caip_chain_id submit', () => legion.includes('caip_chain_id')],
    ['siwx off by default', () => readFileSync(join(root, 'packages/core/src/caip/siwx.ts'), 'utf8').includes("=== 'true'")],
  ];

  let pass = 0;
  for (const [name, fn] of checks) {
    const ok = fn();
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (ok) pass++;
  }
  console.log(`\nCAIP GATE: ${pass}/${checks.length}`);
  if (pass !== checks.length) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
