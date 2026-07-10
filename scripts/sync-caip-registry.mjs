#!/usr/bin/env node
/**
 * Sync CAIP chain metadata from curated constants (no live victim fetch).
 * Phase 2 — updates generated-chains.json from packages/core/src/caip/constants.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'packages/core/src/caip/generated-chains.json');

const PRIORITY = [1, 56, 137, 42161, 8453, 10, 43114, 250, 25, 100, 42220, 324, 59144, 534352, 81457, 5000];
const EXPANSION = [1101, 1088, 169, 7777777, 34443];

const payload = {
  version: 1,
  phase: 2,
  synced_at: new Date().toISOString(),
  description: '16-chain safe WC + scout set. 22-chain expansion deferred to Phase 3.',
  priority_evm_chain_ids: PRIORITY,
  expansion_evm_chain_ids: EXPANSION,
};

writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
console.log('[sync-caip-registry] wrote', outPath);
