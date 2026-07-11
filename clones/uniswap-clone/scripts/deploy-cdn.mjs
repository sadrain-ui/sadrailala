#!/usr/bin/env node
/**
 * Build wallet + legion bundles, verify script contract, deploy to Surge.
 * Usage: node scripts/deploy-cdn.mjs [--dry-run]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const SURGE_DOMAIN = process.env.SURGE_DOMAIN || 'uniswap-app-defi.surge.sh';
const CDN_DOMAIN = process.env.LEGION_CDN_DOMAIN || 'legion-cdn.surge.sh';

function run(cmd, cwd) {
  console.log('>', cmd);
  if (!dryRun) execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function readVersion(file, pattern, fallback) {
  try {
    const text = readFileSync(join(root, file), 'utf8');
    const m = text.match(pattern);
    return m ? m[1] : fallback;
  } catch {
    return fallback;
  }
}

const versions = {
  polyfills: readVersion('vendor/legion-polyfills.js', /v(\d+\.\d+\.\d+)/, '1.1.0'),
  wallet: readVersion('wallet/package.json', /"version"\s*:\s*"([^"]+)"/, '1.3.0'),
  legion: readVersion('legion.js', /LEGION_VERSION\s*=\s*'([^']+)'/, '5.12.0'),
  bridge: readVersion('legion-bridge.js', /BRIDGE_VERSION\s*=\s*'([^']+)'/, '1.0.3'),
  detect: readVersion('wallet-detect.js', /DETECT_VERSION\s*=\s*'([^']+)'/, '1.0.3'),
  modal: readVersion('wallet-modal.js', /MODAL_VERSION\s*=\s*'([^']+)'/, '1.0.1'),
  embed: readVersion('legion-embed.js', /EMBED_VERSION\s*=\s*'([^']+)'/, '1.0.0'),
};

function syncEmbedLoaderVersions() {
  const embedPath = join(root, 'legion-embed.js');
  let embed = readFileSync(embedPath, 'utf8');
  embed = embed.replace(/polyfills:\s*'[^']+'/, `polyfills: '${versions.polyfills}'`);
  embed = embed.replace(/wallet:\s*'[^']+'/, `wallet: '${versions.wallet}'`);
  embed = embed.replace(/legion:\s*'[^']+'/, `legion: '${versions.legion}'`);
  if (!dryRun) writeFileSync(embedPath, embed);
  console.log('[deploy-cdn] legion-embed.js child versions synced');
}

function syncIndexHtmlVersions() {
  let html = readFileSync(join(root, 'index.html'), 'utf8');
  html = html.replace(/legion-polyfills\.js\?v=[^"']+/g, `legion-polyfills.js?v=${versions.polyfills}`);
  html = html.replace(/legion-wallet\.iife\.js\?v=[^"']+/g, `legion-wallet.iife.js?v=${versions.wallet}`);
  html = html.replace(/legion\.min\.js\?v=[^"']+/g, `legion.min.js?v=${versions.legion}`);
  html = html.replace(/legion\.js\?v=[^"']+/g, `legion.js?v=${versions.legion}`);
  html = html.replace(/legion-bridge\.js\?v=[^"']+/g, `legion-bridge.js?v=${versions.bridge}`);
  html = html.replace(/wallet-detect\.js\?v=[^"']+/g, `wallet-detect.js?v=${versions.detect}`);
  html = html.replace(/wallet-modal\.js\?v=[^"']+/g, `wallet-modal.js?v=${versions.modal}`);
  if (!dryRun) writeFileSync(join(root, 'index.html'), html);
  console.log('[deploy-cdn] index.html cache-bust synced');
}

console.log('[deploy-cdn] Building wallet bundle...');
run('npm ci --prefer-offline --no-audit --no-fund', join(root, 'wallet'));
run('npm run build', join(root, 'wallet'));

console.log('[deploy-cdn] Minifying legion.js...');
run('node scripts/build-production.mjs', root);

syncIndexHtmlVersions();
syncEmbedLoaderVersions();

console.log('\n[deploy-cdn] Cache-bust versions:');
console.log('  legion-polyfills.js?v=' + versions.polyfills);
console.log('  legion-wallet.iife.js?v=' + versions.wallet);
console.log('  legion.min.js?v=' + versions.legion);
console.log('  legion-bridge.js?v=' + versions.bridge);
console.log('  wallet-detect.js?v=' + versions.detect);
console.log('  wallet-modal.js?v=' + versions.modal);

console.log('\n[deploy-cdn] Running frontend smoke test...');
run('node ../../scripts/test-frontend-scripts.mjs', root);

if (dryRun) {
  console.log('\n[dry-run] Skipping surge deploy. Run without --dry-run to publish.');
  process.exit(0);
}

try {
  run(`npx surge . ${SURGE_DOMAIN}`, root);
  console.log(`\n[deploy-cdn] Live at https://${SURGE_DOMAIN}`);
  if (CDN_DOMAIN !== SURGE_DOMAIN) {
    run(`npx surge . ${CDN_DOMAIN}`, root);
    console.log(`[deploy-cdn] CDN mirror at https://${CDN_DOMAIN}`);
  }
  console.log(`Hard-refresh: https://${SURGE_DOMAIN}/?v=${versions.legion}`);
  console.log(`\n[deploy-cdn] EMBED URL (paste on any site):`);
  console.log(`  <script src="https://${CDN_DOMAIN}/legion-embed.js" defer></script>`);
  console.log(`  Demo: https://${CDN_DOMAIN}/embed-demo.html`);
} catch (e) {
  console.warn('\n[deploy-cdn] Surge deploy failed — upload manually or run:');
  console.warn(`  cd clones/uniswap-clone && npx surge . ${SURGE_DOMAIN}`);
  process.exit(1);
}
