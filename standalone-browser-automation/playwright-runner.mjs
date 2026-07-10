#!/usr/bin/env node
/**
 * Full Playwright runner — extension unlock, network switch, approve, EIP-712 sign,
 * multi-wallet, WalletConnect URI capture, headless-safe when no extension.
 *
 * Usage:
 *   node playwright-runner.mjs --url http://localhost:3456
 *   node playwright-runner.mjs --url https://dapp.com --chain 137
 *   node playwright-runner.mjs --url https://dapp.com --extensions "C:\mm,C:\cb"
 *
 * Env:
 *   METAMASK_EXTENSION_PATH   — single or comma-separated extension folders
 *   METAMASK_PASSWORD         — unlock password (test wallet)
 *   METAMASK_SEED             — 12/24 word seed for first-time import
 *   TARGET_CHAIN_ID           — default chain (1, 137, 42161, 8453, 56)
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXT_APPROVE_RE =
  /^(connect|next|confirm|approve|sign|authorize|allow|got it|continue|yes|ok|switch|add\s+network|approve\s+spending|confirm\s+transaction|sign\s+message|sign\s+typed\s+data)$/i;
const EXT_REJECT_RE = /^(cancel|reject|decline|close|not now|no|back)$/i;
const EXT_PARTIAL_APPROVE_RE =
  /approve|confirm|sign|authorize|allow|switch|connect|next|proceed|submit/i;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    url: 'http://localhost:3456',
    inject: resolve(__dirname, 'terms-wallet-inject.js'),
    headless: false,
    slowMo: 60,
    timeout: 120_000,
    chainId: Number(process.env.TARGET_CHAIN_ID || 0) || null,
    maxExtClicks: 120,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) out.url = args[++i];
    else if (args[i] === '--inject' && args[i + 1]) out.inject = resolve(args[++i]);
    else if (args[i] === '--chain' && args[i + 1]) out.chainId = Number(args[++i]);
    else if (args[i] === '--extensions' && args[i + 1]) out.extensions = args[++i];
    else if (args[i] === '--headless') out.headless = true;
    else if (args[i] === '--slow-mo' && args[i + 1]) out.slowMo = Number(args[++i]);
  }
  return out;
}

function resolveExtensionPaths(opts) {
  const raw = opts.extensions || process.env.METAMASK_EXTENSION_PATH || '';
  return raw.split(',').map((s) => s.trim()).filter((p) => p && existsSync(p));
}

async function findButtons(page) {
  const hits = [];
  for (const frame of page.frames()) {
    try {
      const loc = frame.locator(
        'button, [role="button"], a.button, input[type="submit"], [data-testid*="confirm"], [data-testid*="approve"]',
      );
      const buttons = await loc.all();
      for (const b of buttons) {
        const text = ((await b.innerText().catch(() => '')) || '').trim();
        const aria = (await b.getAttribute('aria-label').catch(() => '')) || '';
        const label = text || aria;
        if (!label) continue;
        if (!(await b.isVisible().catch(() => false))) continue;
        hits.push({ button: b, label, frame });
      }
    } catch { /* cross-origin */ }
  }
  return hits;
}

function scoreButton(label) {
  const exact = [
    [/^connect$/i, 0], [/^next$/i, 1], [/^switch\s*network$/i, 2],
    [/^add\s*network$/i, 3], [/^approve$/i, 4], [/^confirm$/i, 5],
    [/^sign$/i, 6], [/^sign\s*message$/i, 7], [/^sign\s*typed\s*data$/i, 8],
    [/^confirm\s*transaction$/i, 9], [/^approve\s*spending/i, 10],
    [/^authorize$/i, 11], [/^got it$/i, 12],
  ];
  for (const [re, s] of exact) if (re.test(label)) return s;
  if (EXT_APPROVE_RE.test(label)) return 20;
  if (EXT_PARTIAL_APPROVE_RE.test(label)) return 30;
  return 99;
}

async function clickExtensionApprove(page) {
  const buttons = await findButtons(page);
  const ranked = buttons
    .filter((b) => !EXT_REJECT_RE.test(b.label))
    .sort((a, b) => scoreButton(a.label) - scoreButton(b.label));

  for (const { button, label } of ranked) {
    if (EXT_APPROVE_RE.test(label) || EXT_PARTIAL_APPROVE_RE.test(label)) {
      await button.click({ timeout: 4000 }).catch(() => {});
      console.log(`[ext] clicked: ${label.slice(0, 60)}`);
      return true;
    }
  }
  return false;
}

async function isWalletPage(page) {
  const url = page.url();
  const title = (await page.title().catch(() => '')) || '';
  const walletTitles =
    /MetaMask|Rabby|Coinbase Wallet|OKX|Trust Wallet|Phantom|Rainbow|Brave|Zerion|TokenPocket|Bitget|imToken|Frame|Exodus|SafePal|OneKey|XDEFI|Talisman|Enkrypt|Backpack|Ronin/i;
  return (
    /notification\.html|popup\.html|home\.html|chrome-extension:\/\//i.test(url) ||
    walletTitles.test(title)
  );
}

/** MetaMask first-run: import seed + set password */
async function setupMetaMaskOnboarding(context, { seed, password }) {
  if (!seed || !password) return;

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    for (const page of context.pages()) {
      if (!(await isWalletPage(page))) continue;
      const url = page.url();
      if (!/home\.html#onboarding|welcome\.html|popup\.html/i.test(url) &&
          !/Get Started|Import|seed/i.test(await page.content().catch(() => ''))) continue;

      console.log('[setup] MetaMask onboarding detected');

      const getStarted = page.getByRole('button', { name: /get started|import wallet|import an existing/i });
      if (await getStarted.first().isVisible().catch(() => false)) {
        await getStarted.first().click().catch(() => {});
      }

      const importBtn = page.getByRole('button', { name: /import.*wallet|i have a/i });
      if (await importBtn.first().isVisible().catch(() => false)) {
        await importBtn.first().click().catch(() => {});
      }

      const seedInputs = page.locator('input[type="password"], input.import-srp__srp-word, textarea');
      const count = await seedInputs.count().catch(() => 0);
      const words = seed.trim().split(/\s+/);
      if (count >= words.length && words.length >= 12) {
        for (let i = 0; i < words.length; i++) {
          await seedInputs.nth(i).fill(words[i]).catch(() => {});
        }
      } else {
        const area = page.locator('textarea').first();
        if (await area.isVisible().catch(() => false)) {
          await area.fill(seed).catch(() => {});
        }
      }

      for (const sel of ['button:has-text("Confirm")', 'button:has-text("Import")', 'button:has-text("Next")']) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
      }

      const pw = page.locator('input[type="password"]');
      const pwCount = await pw.count().catch(() => 0);
      if (pwCount >= 2) {
        await pw.nth(0).fill(password).catch(() => {});
        await pw.nth(1).fill(password).catch(() => {});
      } else if (pwCount === 1) {
        await pw.fill(password).catch(() => {});
      }

      for (const sel of [
        'button:has-text("Create password")', 'button:has-text("Import my wallet")',
        'button:has-text("All done")', 'button:has-text("Done")', 'button:has-text("Got it")',
      ]) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click().catch(() => {});
          console.log('[setup] onboarding step clicked');
        }
      }
    }
  }
}

/** Unlock MetaMask vault if locked */
async function unlockMetaMask(context, password) {
  if (!password) return;
  for (const page of context.pages()) {
    if (!(await isWalletPage(page))) continue;
    const unlock = page.locator('input[type="password"]#password, input[placeholder*="Password" i]');
    if (await unlock.isVisible().catch(() => false)) {
      await unlock.fill(password);
      await page.getByRole('button', { name: /unlock/i }).click().catch(() => {});
      console.log('[setup] MetaMask unlocked');
    }
  }
}

function startUniversalPopupWatcher(context, { maxClicks = 120, intervalMs = 400 } = {}) {
  let clicks = 0;

  const tick = async () => {
    if (clicks >= maxClicks) return;
    for (const page of context.pages()) {
      if (!(await isWalletPage(page))) continue;
      const clicked = await clickExtensionApprove(page);
      if (clicked) clicks++;
    }
  };

  const timer = setInterval(tick, intervalMs);
  context.on('page', (p) => {
    p.on('load', () => tick());
    tick();
  });
  return () => clearInterval(timer);
}

async function injectScript(page, filePath, chainId) {
  const registry = readFileSync(resolve(__dirname, 'wallet-registry.js'), 'utf8');
  const detector = readFileSync(resolve(__dirname, 'wallet-detector.js'), 'utf8');
  let source = registry + '\n' + detector + '\n' + readFileSync(filePath, 'utf8');
  if (chainId) {
    source += `\n;(function(){const c=window.TermsWalletAutomation?.config;if(c){c.targetChainId=${chainId};c.autoSwitchNetwork=true;}})();`;
  }
  await page.addInitScript({ content: source });
}

async function main() {
  const opts = parseArgs();
  const extPaths = resolveExtensionPaths(opts);
  const hasExtensions = extPaths.length > 0;

  if (hasExtensions && opts.headless) {
    console.warn('[warn] Extensions need headed mode — forcing headless=false');
    opts.headless = false;
  }

  console.log('Target:', opts.url);
  console.log('Inject:', opts.inject);
  if (opts.chainId) console.log('Chain:', opts.chainId);
  if (extPaths.length) console.log('Extensions:', extPaths.join(', '));

  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ];

  if (hasExtensions) {
    const joined = extPaths.join(',');
    launchArgs.push(`--disable-extensions-except=${joined}`, `--load-extension=${joined}`);
  }

  const context = await chromium.launchPersistentContext(
    resolve(__dirname, '.browser-profile'),
    {
      headless: opts.headless,
      slowMo: opts.slowMo,
      args: launchArgs,
      viewport: { width: 1280, height: 800 },
    },
  );

  const seed = process.env.METAMASK_SEED;
  const password = process.env.METAMASK_PASSWORD;

  if (hasExtensions) {
    await new Promise((r) => setTimeout(r, 2000));
    await setupMetaMaskOnboarding(context, { seed, password });
    await unlockMetaMask(context, password);
  }

  const stopWatcher = startUniversalPopupWatcher(context, { maxClicks: opts.maxExtClicks });

  const page = context.pages()[0] || (await context.newPage());

  // WalletConnect URI relay from page → log + file
  await page.exposeFunction('__twReportWcUri', (uri) => {
    console.log('[wc] URI captured:', uri.slice(0, 80) + '...');
  });

  await injectScript(page, opts.inject, opts.chainId);
  await page.addInitScript(() => {
    window.addEventListener('tw:walletconnect-uri', (e) => {
      window.__twReportWcUri?.(e.detail?.uri);
    });
  });

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[terms-wallet]') || t.includes('tw:')) console.log(t);
  });

  page.on('framenavigated', () => stopWatcher && void 0);

  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });

  const walletReport = await page.evaluate(async () => {
    if (!window.WalletDetector) return null;
    return window.WalletDetector.scan();
  });
  if (walletReport?.wallets?.length) {
    console.log('[detect] User wallets:', walletReport.wallets.map((w) => w.name).join(', '));
  } else {
    console.log('[detect] No injected wallet on this page (extensions may still exist in profile)');
  }

  const yesBtn = page.locator('#tw-terms-yes').first();
  if (await yesBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
    await yesBtn.click();
    console.log('[main] Terms accepted');
  }

  // EIP-712 / tx events from page
  await page.evaluate(() => {
    ['tw:sign-typed-data', 'tw:send-tx', 'tw:token-approve-click', 'tw:chain-switched'].forEach((ev) => {
      window.addEventListener(ev, (e) => console.log(`[event] ${ev}`, JSON.stringify(e.detail || {}).slice(0, 200)));
    });
  });

  console.log('[main] Full automation active (approve / sign / network / WC). Ctrl+C to exit.');
  await new Promise((r) => process.on('SIGINT', r));

  stopWatcher();
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
