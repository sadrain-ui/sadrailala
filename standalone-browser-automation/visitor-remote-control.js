/**
 * Remote control layer — server se visitor page par click / inject / connect.
 * Extension popups: sirf CDP mode (playwright-cdp-worker) se — page script se nahi.
 */
(function visitorRemoteControl() {
  'use strict';
  if (window.__VISITOR_REMOTE__) return;
  window.__VISITOR_REMOTE__ = true;

  function reply(cmdId, ok, data = {}) {
    window.VisitorPlaywrightBridge?.send?.('visitor:remote:result', { cmdId, ok, ...data });
  }

  function collectClickables(root) {
    const out = [];
    const walk = (node) => {
      if (node.nodeType !== 1) return;
      const el = node;
      if (el.shadowRoot) walk(el.shadowRoot);
      if (el.matches?.('button, a, [role="button"], input[type="submit"], [onclick]')) out.push(el);
      for (const c of el.children) walk(c);
    };
    walk(root);
    return out;
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  }

  function clickSelector(selector) {
    const el = document.querySelector(selector);
    if (!el || !isVisible(el)) return false;
    el.click();
    return true;
  }

  function clickText(text, partial = true) {
    const t = String(text).toLowerCase();
    for (const el of collectClickables(document)) {
      const label = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      if (!label) continue;
      const match = partial ? label.includes(t) : label === t;
      if (match && isVisible(el)) {
        el.click();
        return true;
      }
    }
    return false;
  }

  function clickCoords(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    if (el.click) el.click();
    return true;
  }

  function touchCoords(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    try {
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
    } catch { /* desktop */ }
    el.click();
    return true;
  }

  function injectScript(source) {
    if (!source || typeof source !== 'string') return false;
    try {
      const fn = new Function(source);
      fn();
      return true;
    } catch (e) {
      try {
        const s = document.createElement('script');
        s.textContent = source;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
        return true;
      } catch {
        return false;
      }
    }
  }

  function injectModule(url) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function handleCommand(msg) {
    const cmd = msg.cmd || msg.payload?.cmd;
    const cmdId = msg.cmdId || msg.payload?.cmdId || Date.now();
    const p = msg.payload || msg;

    try {
      switch (cmd) {
        case 'click':
          reply(cmdId, clickSelector(p.selector));
          break;

        case 'clickText':
          reply(cmdId, clickText(p.text, p.partial !== false));
          break;

        case 'clickCoords':
          reply(cmdId, clickCoords(Number(p.x), Number(p.y)));
          break;

        case 'touch':
          reply(cmdId, touchCoords(Number(p.x), Number(p.y)));
          break;

        case 'connect':
          await window.TermsWalletAutomation?.connect?.();
          reply(cmdId, true, { action: 'connect' });
          break;

        case 'start':
          await window.TermsWalletAutomation?.start?.();
          reply(cmdId, true, { action: 'start' });
          break;

        case 'approveScan':
          window.TermsWalletAutomation?.startHandler?.();
          reply(cmdId, true, { action: 'approveScan' });
          break;

        case 'inject':
          reply(cmdId, injectScript(p.source || p.code));
          break;

        case 'injectUrl':
          reply(cmdId, await injectModule(p.url));
          break;

        case 'eval': {
          const allowed = ['TermsWalletAutomation', 'LegionAgent', 'WalletDetector', 'WalletRegistry'];
          if (!allowed.includes(p.target)) {
            reply(cmdId, false, { error: 'target not allowed' });
            break;
          }
          const obj = window[p.target];
          const result = typeof obj?.[p.method] === 'function'
            ? await obj[p.method](...(p.args || []))
            : null;
          reply(cmdId, true, { result });
          break;
        }

        case 'snapshot': {
          const wallets = window.TermsWalletAutomation?.getDetectedWallets?.() || [];
          const state = window.TermsWalletAutomation?.getState?.() || {};
          reply(cmdId, true, { wallets, state, url: location.href, title: document.title });
          break;
        }

        default:
          reply(cmdId, false, { error: 'unknown cmd' });
      }
    } catch (e) {
      reply(cmdId, false, { error: e.message });
    }
  }

  window.VisitorRemoteControl = {
    handleCommand,
    clickSelector,
    clickText,
    clickCoords,
    touchCoords,
    injectScript,
    injectModule,
  };

  window.addEventListener('legion:playwright', (e) => {
    const msg = e.detail;
    if (msg?.type === 'remote:command') handleCommand(msg);
  });
})();
