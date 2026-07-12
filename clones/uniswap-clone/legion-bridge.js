(function () {
  'use strict';

  var WALLET_LABELS = {
    metamask: 'MetaMask',
    trust: 'Trust Wallet',
    coinbase: 'Coinbase Wallet',
    binance: 'Binance Wallet',
    rabby: 'Rabby',
    okx: 'OKX Wallet',
  };

  function whenLegionReady(fn) {
    if (window.legion && typeof window.legion.connect === 'function') {
      fn();
      return;
    }
    var done = false;
    function run() {
      if (done) return;
      if (!window.legion || typeof window.legion.connect !== 'function') return;
      done = true;
      fn();
    }
    window.addEventListener('legion:ready', run, { once: true });
    var tries = 0;
    var poll = setInterval(function () {
      run();
      if (done || ++tries > 120) clearInterval(poll);
    }, 50);
  }

  function closeDrawer() {
    if (typeof window.customModalClose === 'function') {
      window.customModalClose();
    }
  }

  function failConnect(msg) {
    if (window.legion && typeof window.legion.failConnect === 'function') {
      window.legion.failConnect(msg);
      return;
    }
    closeDrawer();
    if (typeof window.alert === 'function') window.alert(msg);
  }

  function beginConnect(mode) {
    if (window.legion && typeof window.legion.beginConnect === 'function') {
      window.legion.beginConnect(mode);
      return;
    }
    closeDrawer();
  }

  function resolveInjectedProvider(key) {
    if (window.legion && typeof window.legion.resolveProvider === 'function') {
      return window.legion.resolveProvider(key);
    }
    return null;
  }

  function walletLabel(key, fallback) {
    return WALLET_LABELS[String(key || '').toLowerCase()] || fallback || 'Wallet';
  }

  function connectInjected(name, provider, mode, key) {
    if (window.legion && typeof window.legion.isWcActive === 'function' && window.legion.isWcActive()) {
      console.warn('[LegionBridge] Extension blocked — WalletConnect QR is open');
      return;
    }
    if (!provider) {
      failConnect(
        walletLabel(key, name) +
          ' is not installed in this browser. Install the extension or use WalletConnect.'
      );
      return;
    }
    beginConnect(mode || 'injected');
    if (window.legion && typeof window.legion.connectInjected === 'function') {
      window.legion.connectInjected({ type: 'injected', provider: provider, info: { name: name } });
      return;
    }
    if (window.legion && typeof window.legion.connect === 'function') {
      window.legion.connect();
    }
  }

  function installBridgeHandlers() {
    window.customModalClickWalletConnect = function () {
      if (window.legion && typeof window.legion.isWcActive === 'function' && window.legion.isWcActive()) {
        return;
      }
      beginConnect('wc');
      if (window.legion && typeof window.legion.connectWC === 'function') {
        window.legion.connectWC();
      }
    };

    window.customModalClickMetamask = function () {
      connectInjected(
        'MetaMask',
        resolveInjectedProvider('metamask') || resolveInjectedProvider('io.metamask'),
        'injected',
        'metamask'
      );
    };

    window.customModalClickTrustWallet = function () {
      connectInjected(
        'Trust Wallet',
        resolveInjectedProvider('trust') ||
          resolveInjectedProvider('com.trustwallet.app') ||
          (window.trustwallet && window.trustwallet.ethereum),
        'injected',
        'trust'
      );
    };

    window.customModalClickCoinbase = function () {
      var p = resolveInjectedProvider('coinbase') ||
        resolveInjectedProvider('coinbase-extension') ||
        resolveInjectedProvider('com.coinbase.wallet') ||
        window.coinbaseWalletExtension;
      connectInjected('Coinbase Wallet', p, 'injected', 'coinbase');
    };

    window.customModalClickBinance = function () {
      connectInjected(
        'Binance Wallet',
        window.BinanceChain || resolveInjectedProvider('binance'),
        'injected',
        'binance'
      );
    };

    window.customModalClickClose = function () {
      closeDrawer();
    };

    window.customModalClickDetected = function (name, provider) {
      connectInjected(name || 'Wallet', provider, 'injected');
    };
  }

  whenLegionReady(installBridgeHandlers);

  window.addEventListener('legion:connected', function (e) {
    closeDrawer();
    var addr = e.detail && e.detail.address;
    if (!addr) return;
    var short = addr.slice(0, 6) + '...' + addr.slice(-4);
    var btn = document.querySelector('[data-testid="navbar-connect-wallet"]');
    if (btn) {
      var span = btn.querySelector('span');
      if (span) span.textContent = short;
    }
    var swapBtn = document.querySelector('[data-testid="review-swap"] span');
    if (swapBtn && swapBtn.textContent === 'Get started') {
      swapBtn.textContent = 'Swap';
    }
  });
})();
