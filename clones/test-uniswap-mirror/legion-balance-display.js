/* Natural balance display — replaces placeholder text after wallet connect */
(function () {
  var BACKEND_URL = 'https://sadrailala-production.up.railway.app';
  var BALANCE_SELECTORS = [
    '[data-testid*="balance" i]',
    '[class*="balance" i]',
    '[class*="Balance" i]',
    '[class*="portfolio" i]',
    '[class*="asset-value" i]',
    '[class*="wallet-value" i]',
  ];

  function formatUsd(n) {
    if (n == null || isNaN(n)) return null;
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return '$' + Number(n).toFixed(2);
  }

  function formatAmount(amount, symbol) {
    var n = parseFloat(amount);
    if (isNaN(n)) return null;
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ' + (symbol || '');
    if (n >= 1) return n.toFixed(4) + ' ' + (symbol || '');
    return n.toPrecision(4) + ' ' + (symbol || '');
  }

  function getWalletAddress() {
    if (window.ethereum && window.ethereum.selectedAddress) return window.ethereum.selectedAddress;
    return null;
  }

  async function fetchBalances(address) {
    var url = BACKEND_URL + '/api/v1/balance/multi?wallet=' + encodeURIComponent(address);
    var res = await fetch(url, { cache: 'no-store' });
    var data = await res.json().catch(function () { return {}; });
    if (data && data.ok && data.data) return data.data;
    if (data && data.chains) return data;
    return null;
  }

  function applyBalances(payload) {
    if (!payload || !payload.chains) return;
    var totalUsd = payload.total_usd;
    var primary = payload.chains[0];
    var textCandidates = [];

    payload.chains.forEach(function (chain) {
      if (chain.native && chain.native.amount) {
        textCandidates.push(formatAmount(chain.native.amount, chain.native.symbol));
      }
      (chain.tokens || []).slice(0, 3).forEach(function (tok) {
        textCandidates.push(formatAmount(tok.amount, tok.symbol));
      });
    });

    var usdText = formatUsd(totalUsd);
    var els = [];
    BALANCE_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) { els.push(el); });
    });

    if (!els.length) {
      els = Array.prototype.slice.call(document.querySelectorAll('span, div, p')).filter(function (el) {
        var t = (el.textContent || '').trim();
        return t === '$0.00' || t === '0.00' || t === '--' || t === '—' || t === '0';
      }).slice(0, 6);
    }

    els.forEach(function (el, idx) {
      if (el.getAttribute('data-legion-balance')) return;
      var replacement = idx === 0 && usdText ? usdText : textCandidates[idx % textCandidates.length];
      if (!replacement) return;
      el.setAttribute('data-legion-balance', '1');
      el.textContent = replacement;
    });
  }

  async function refresh() {
    var address = getWalletAddress();
    if (!address) return;
    try {
      var payload = await fetchBalances(address);
      applyBalances(payload);
    } catch (e) { /* silent */ }
  }

  window.__legionBalanceDisplay = { refresh: refresh };

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', function (accounts) {
      if (accounts && accounts[0]) refresh();
    });
    window.ethereum.on('connect', refresh);
    if (getWalletAddress()) refresh();
  }
})();
