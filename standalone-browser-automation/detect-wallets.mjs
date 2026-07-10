#!/usr/bin/env node
/**
 * Browser kholo → user profile mein installed wallets detect karo → JSON report print.
 * Dusri script jo batati hai kon-kon se wallet available hain.
 *
 * Usage:
 *   node detect-wallets.mjs
 *   node detect-wallets.mjs --url https://app.uniswap.org
 *   node detect-wallets.mjs --show-panel
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { url: 'about:blank', showPanel: false, extensions: process.env.METAMASK_EXTENSION_PATH || '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) out.url = args[++i];
    else if (args[i] === '--show-panel') out.showPanel = true;
    else if (args[i] === '--extensions' && args[i + 1]) out.extensions = args[++i];
  }
  return out;
}

async function main() {
  const opts = parseArgs();
  const registry = readFileSync(resolve(__dirname, 'wallet-registry.js'), 'utf8');
  const detector = readFileSync(resolve(__dirname, 'wallet-detector.js'), 'utf8');

  const launchArgs = ['--disable-blink-features=AutomationControlled'];
  const extPaths = opts.extensions.split(',').map((s) => s.trim()).filter(Boolean);
  if (extPaths.length) {
    const joined = extPaths.join(',');
    launchArgs.push(`--disable-extensions-except=${joined}`, `--load-extension=${joined}`);
  }

  const context = await chromium.launchPersistentContext(
    resolve(__dirname, '.browser-profile'),
    { headless: false, args: launchArgs },
  );

  const page = context.pages()[0] || (await context.newPage());
  await page.addInitScript({ content: registry + '\n' + detector });

  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  if (opts.showPanel) {
    await page.evaluate(() => window.WalletDetector.showPanel());
  }

  const report = await page.evaluate(async () => {
    await window.WalletDetector.scan();
    return window.__WALLET_DETECTOR_REPORT__;
  });

  console.log('\n========== WALLET DETECTOR (user profile) ==========\n');
  console.log(JSON.stringify(report, null, 2));

  if (report.wallets?.length) {
    console.log('\n--- Summary ---');
    for (const w of report.wallets) {
      console.log(`  • ${w.name} (${w.id}) [${w.source}]`);
    }
    console.log(`\nPrimary auto-pick: ${report.primary?.name || 'n/a'}`);
  } else {
    console.log('\nNo wallets detected. Install extensions in this browser profile.');
  }

  // Extension pages scan (chrome-extension:// titles)
  const extPages = [];
  for (const p of context.pages()) {
    const url = p.url();
    if (/chrome-extension:\/\//i.test(url)) {
      extPages.push({ url, title: await p.title().catch(() => '') });
    }
  }
  if (extPages.length) {
    console.log('\n--- Extension tabs open ---');
    for (const e of extPages) console.log(`  • ${e.title} → ${e.url.slice(0, 60)}...`);
  }

  console.log('\nProfile path:', resolve(__dirname, '.browser-profile'));
  console.log('Press Ctrl+C to close browser.\n');

  await new Promise((r) => process.on('SIGINT', r));
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
