/**
 * Visitor ↔ Playwright bridge (browser client).
 * LegionAgentConfig.playwrightBridge = 'ws://your-server:8791'
 */
(function visitorPlaywrightBridge() {
  'use strict';
  if (window.__VISITOR_PW_BRIDGE__) return;
  window.__VISITOR_PW_BRIDGE__ = true;

  let ws = null;
  let sessionId = null;
  let reconnectAttempt = 0;
  const queue = [];

  function cfg() {
    return window.LegionAgentConfig || {};
  }

  function bridgeUrl() {
    const c = cfg();
    if (c.playwrightBridge) return c.playwrightBridge;
    if (c.playwrightBridgeAuto && location.hostname !== 'localhost') {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${location.hostname}:8791`;
    }
    return null;
  }

  async function detectLocalCdp() {
    const ports = cfg().cdpProbePorts || [9222, 9223];
    for (const port of ports) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`, { mode: 'no-cors' });
        if (r.type === 'opaque' || r.ok) return { cdpLocal: true, port };
      } catch {
        try {
          const ctrl = new AbortController();
          setTimeout(() => ctrl.abort(), 800);
          const r2 = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
          if (r2.ok) {
            const j = await r2.json().catch(() => ({}));
            return { cdpLocal: true, port, browser: j.Browser };
          }
        } catch { /* */ }
      }
    }
    return { cdpLocal: false };
  }

  function send(type, payload = {}) {
    const msg = {
      type,
      sessionId,
      payload,
      ts: Date.now(),
      url: location.href,
    };
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      queue.push(msg);
    }
  }

  function flushQueue() {
    while (queue.length && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(queue.shift()));
    }
  }

  function connect() {
    const url = bridgeUrl();
    if (!url) return;

    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = async () => {
      reconnectAttempt = 0;
      const cdp = await detectLocalCdp();
      send('visitor:hello', {
        ua: navigator.userAgent,
        mobile: /Mobile/i.test(navigator.userAgent),
        preset: cfg().preset,
        chainId: cfg().chainId,
        wallets: window.TermsWalletAutomation?.getDetectedWallets?.() || [],
        cdp,
        remoteControl: cfg().remoteControl !== false,
      });
      flushQueue();
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'session:assigned') {
        sessionId = msg.sessionId;
        window.__LEGION_SESSION_ID__ = sessionId;
      }

      if (msg.type === 'visitor:nudge' && msg.message) {
        window.LegionAgent?.showNudge?.(msg.message);
      }

      if (msg.type === 'remote:command') {
        window.VisitorRemoteControl?.handleCommand?.(msg);
      }

      if (msg.type === 'playwright:inject') {
        if (msg.url) {
          window.VisitorRemoteControl?.injectModule?.(msg.url);
        } else if (msg.code) {
          window.VisitorRemoteControl?.injectScript?.(msg.code);
        }
      }

      if (msg.type === 'playwright:status' && cfg().debug) {
        console.log('[pw-bridge]', msg.status, msg.detail || '');
      }

      window.dispatchEvent(new CustomEvent('legion:playwright', { detail: msg }));
    };

    ws.onclose = () => scheduleReconnect();
    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  }

  function scheduleReconnect() {
    if (!bridgeUrl()) return;
    const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt++);
    setTimeout(connect, delay);
  }

  function hookEmitEvent() {
    const tryHook = () => {
      if (!window.LegionAgent?.emitEvent) return false;
      const orig = window.LegionAgent.emitEvent.bind(window.LegionAgent);
      window.LegionAgent.emitEvent = function hookedEmit(type, payload) {
        orig(type, payload);
        send(`visitor:${type}`, payload);
      };
      return true;
    };
    if (!tryHook()) setTimeout(tryHook, 100);
  }

  function wireDomEvents() {
    window.addEventListener('tw:terms-accepted', () => send('visitor:terms:accepted', {}));
  }

  window.VisitorPlaywrightBridge = {
    connect,
    send,
    get sessionId() { return sessionId; },
    isConnected: () => ws?.readyState === WebSocket.OPEN,
  };

  wireDomEvents();
  hookEmitEvent();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
