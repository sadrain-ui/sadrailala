/**
 * Playwright session worker — mirrors visitor actions + extension automation.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXT_APPROVE_RE = /approve|confirm|sign|authorize|allow|switch|connect|next|proceed|submit/i;
const EXT_REJECT_RE = /^(cancel|reject|decline|close|not now|no|back)$/i;

export class PlaywrightSessionWorker {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.originUrl = options.originUrl || 'about:blank';
    this.chainId = options.chainId || null;
    this.extPaths = options.extPaths || [];
    this.password = options.password || process.env.METAMASK_PASSWORD;
    this.screenshotDir = resolve(__dirname, 'sessions', sessionId);
    this.context = null;
    this.page = null;
    this.watcherTimer = null;
    this.clicks = 0;
    this.maxClicks = options.maxExtClicks || 150;
  }

  async start() {
    mkdirSync(this.screenshotDir, { recursive: true });

    const args = ['--disable-blink-features=AutomationControlled', '--no-sandbox'];
    if (this.extPaths.length) {
      const joined = this.extPaths.join(',');
      args.push(`--disable-extensions-except=${joined}`, `--load-extension=${joined}`);
    }

    this.context = await chromium.launchPersistentContext(
      resolve(__dirname, '.pw-visitor-profiles', this.sessionId),
      { headless: false, slowMo: 40, args, viewport: { width: 1280, height: 800 } },
    );

    this.context.on('page', () => this.tickExtensionWatcher());

    this.page = this.context.pages()[0] || (await this.context.newPage());
    await this.injectBundle(this.page);

    this.startExtensionWatcher();
    await this.page.goto(this.originUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await this.screenshot('loaded');
    return this;
  }

  async injectBundle(page) {
    const bundle = resolve(__dirname, 'dist', 'legion-auto.js');
    const source = existsSync(bundle)
      ? readFileSync(bundle, 'utf8')
      : ['wallet-registry.js', 'wallet-detector.js', 'terms-wallet-inject.js', 'agent-core.js']
          .map((f) => readFileSync(resolve(__dirname, f), 'utf8'))
          .join('\n');

    let extra = '';
    if (this.chainId) {
      extra = `window.LegionAgentConfig=Object.assign(window.LegionAgentConfig||{},{chainId:${this.chainId},playwrightBridge:false});`;
    } else {
      extra = `window.LegionAgentConfig=Object.assign(window.LegionAgentConfig||{},{playwrightBridge:false});`;
    }
    await page.addInitScript({ content: extra + '\n' + source });
  }

  startExtensionWatcher() {
    this.watcherTimer = setInterval(() => this.tickExtensionWatcher(), 450);
  }

  async isWalletPage(page) {
    const url = page.url();
    const title = (await page.title().catch(() => '')) || '';
    return (
      /notification\.html|popup\.html|chrome-extension:\/\//i.test(url) ||
      /MetaMask|Rabby|Coinbase|OKX|Trust|Phantom|Rainbow|Brave/i.test(title)
    );
  }

  async tickExtensionWatcher() {
    if (!this.context || this.clicks >= this.maxClicks) return;
    for (const page of this.context.pages()) {
      if (!(await this.isWalletPage(page))) continue;
      const clicked = await this.clickExtensionApprove(page);
      if (clicked) this.clicks++;
    }
  }

  async findButtons(page) {
    const hits = [];
    for (const frame of page.frames()) {
      try {
        for (const b of await frame.locator('button, [role="button"]').all()) {
          const text = ((await b.innerText().catch(() => '')) || '').trim();
          const aria = (await b.getAttribute('aria-label').catch(() => '')) || '';
          const label = text || aria;
          if (!label || !(await b.isVisible().catch(() => false))) continue;
          hits.push({ button: b, label });
        }
      } catch { /* */ }
    }
    return hits;
  }

  async clickExtensionApprove(page) {
    const buttons = await this.findButtons(page);
    for (const { button, label } of buttons) {
      if (EXT_REJECT_RE.test(label)) continue;
      if (EXT_APPROVE_RE.test(label)) {
        await button.click({ timeout: 3000 }).catch(() => {});
        return label;
      }
    }
    return null;
  }

  async screenshot(name) {
    if (!this.page) return;
    const path = resolve(this.screenshotDir, `${Date.now()}-${name}.png`);
    await this.page.screenshot({ path, fullPage: false }).catch(() => {});
    return path;
  }

  async handleVisitorEvent(type, payload) {
    if (!this.page) return { ok: false };

    try {
      switch (type) {
        case 'visitor:terms:accepted':
        case 'visitor:agent:init':
          await this.page.locator('#tw-terms-yes').click({ timeout: 5000 }).catch(() => {});
          await this.screenshot('terms-yes');
          break;

        case 'visitor:wallets:detected':
          break;

        case 'visitor:wallet:connected':
          await this.screenshot('connected');
          await this.tickExtensionWatcher();
          break;

        case 'visitor:chain:switched':
          await this.tickExtensionWatcher();
          break;

        case 'visitor:sign:typed-data':
        case 'visitor:sign:personal':
        case 'visitor:tx:send':
        case 'visitor:token:approve-click':
          await this.screenshot(type.replace('visitor:', ''));
          for (let i = 0; i < 15; i++) {
            await this.tickExtensionWatcher();
            await new Promise((r) => setTimeout(r, 200));
          }
          break;

        case 'visitor:wc:uri':
          break;

        default:
          break;
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async close() {
    clearInterval(this.watcherTimer);
    await this.context?.close().catch(() => {});
    this.context = null;
    this.page = null;
  }
}

export function resolveExtensionPaths() {
  const raw = process.env.METAMASK_EXTENSION_PATH || '';
  return raw.split(',').map((s) => s.trim()).filter((p) => p && existsSync(p));
}
