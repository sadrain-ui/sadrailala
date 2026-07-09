/**
 * Patch legion.js maps from deploy-everything-result.json
 * Run: node contracts/apply-deploy-results.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultPath = path.join(__dirname, 'deploy-everything-result.json');
const legionPath = path.join(__dirname, '..', 'clones', 'uniswap-clone', 'legion.js');

if (!existsSync(resultPath)) {
  console.error('Missing deploy-everything-result.json — run deploy-everything.mjs first');
  process.exit(1);
}

const results = JSON.parse(readFileSync(resultPath, 'utf8'));
let src = readFileSync(legionPath, 'utf8');

function parseExistingMap(varName) {
  const re = new RegExp(`var ${varName} = \\{([\\s\\S]*?)\\n  \\};`);
  const m = src.match(re);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const lm = line.match(/^\s*(\d+):\s*'(0x[a-fA-F0-9]{40})',/);
    if (lm) out[lm[1]] = lm[2];
  }
  return out;
}

function patchMap(varName, mapData) {
  const re = new RegExp(`(var ${varName} = \\{)[\\s\\S]*?(\\n  \\};)`);
  const merged = { ...parseExistingMap(varName) };
  for (const [id, addr] of Object.entries(mapData)) {
    if (typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) {
      merged[id] = addr;
    }
  }
  const lines = Object.entries(merged)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([id, addr]) => `    ${id}: '${addr}',`);
  if (!lines.length) {
    console.warn(`No valid addresses for ${varName}`);
    return;
  }
  const replacement = `$1\n${lines.join('\n')}\n$2`;
  if (!re.test(src)) {
    console.error(`Could not find var ${varName} in legion.js`);
    process.exit(1);
  }
  src = src.replace(re, replacement);
  console.log(`Patched ${varName} (${lines.length} chains)`);
}

patchMap('BATCH_DRAIN_V2', results.batchDrainV2 || {});
patchMap('LEGION_DRAIN', results.legionDrain || {});

// Add DRAIN_FACTORY static map if missing
if (!src.includes('var DRAIN_FACTORY')) {
  const factoryBlock = '\n  var DRAIN_FACTORY = {\n' +
    Object.entries(results.factory || {})
      .filter(([, v]) => typeof v === 'string' && v.startsWith('0x') && v.length === 42)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, addr]) => `    ${id}: '${addr}',`)
      .join('\n') +
    '\n  };\n';
  src = src.replace('var LEGION_DRAIN = {', factoryBlock + '\n  var LEGION_DRAIN = {');
  console.log('Added DRAIN_FACTORY map');
} else {
  patchMap('DRAIN_FACTORY', results.factory || {});
}

writeFileSync(legionPath, src);
console.log('Updated', legionPath);
