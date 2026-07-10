#!/usr/bin/env node
/**
 * Standalone CDP attach — visitor ke Chrome ko control karo.
 * Visitor Chrome shortcut:
 *   chrome.exe --remote-debugging-port=9222
 *
 * Usage:
 *   node playwright-cdp-bridge.mjs --cdp http://127.0.0.1:9222
 *   node playwright-cdp-bridge.mjs --cdp http://VISITOR_IP:9222
 */

import { PlaywrightCdpWorker, probeCdp } from './playwright-cdp-worker.mjs';

const args = process.argv.slice(2);
let cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cdp' && args[i + 1]) cdpUrl = args[++i];
}

const probe = await probeCdp(cdpUrl);
if (!probe.ok) {
  console.error('CDP connect failed:', probe.error);
  console.error('\nVisitor Chrome start with:');
  console.error('  chrome.exe --remote-debugging-port=9222');
  process.exit(1);
}

console.log('CDP OK, pages:', probe.pages);
const worker = new PlaywrightCdpWorker(cdpUrl, 'standalone');
await worker.connect();
console.log('Extension watcher active. Ctrl+C to stop.');

process.on('SIGINT', async () => {
  await worker.disconnect();
  process.exit(0);
});

await new Promise(() => {});
