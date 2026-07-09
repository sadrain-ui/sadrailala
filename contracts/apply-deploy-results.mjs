/**
 * Patch legion.js maps from deploy-everything-result.json or deploy-factory-result.json
 * Run: node contracts/apply-deploy-results.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const everythingPath = path.join(__dirname, 'deploy-everything-result.json');
const factoryPath = path.join(__dirname, 'deploy-factory-result.json');
const legionPath = path.join(__dirname, '..', 'clones', 'uniswap-clone', 'legion.js');

let results = null;
if (existsSync(factoryPath)) {
  results = JSON.parse(readFileSync(factoryPath, 'utf8'));
  if (existsSync(everythingPath)) {
    const all = JSON.parse(readFileSync(everythingPath, 'utf8'));
    results = { ...all, factory: results.factory, railway: results.railway };
  }
} else if (existsSync(everythingPath)) {
  results = JSON.parse(readFileSync(everythingPath, 'utf8'));
} else {
  console.error('Missing deploy-everything-result.json or deploy-factory-result.json');
  process.exit(1);
}
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

function validFactoryAddr(addr) {
  return typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42;
}

function factoryMapFromResults() {
  const raw = results.factory || {};
  const out = {};
  for (const [id, addr] of Object.entries(raw)) {
    if (validFactoryAddr(addr)) out[id] = addr;
  }
  return out;
}

patchMap('BATCH_DRAIN_V2', results.batchDrainV2 || {});
patchMap('LEGION_DRAIN', results.legionDrain || {});
patchMap('DRAIN_FACTORY', factoryMapFromResults());

writeFileSync(legionPath, src);
console.log('Updated', legionPath);
