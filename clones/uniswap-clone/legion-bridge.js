(function () {
  'use strict';

  function closeDrawer() {
    if (typeof window.customModalClose === 'function') {
      window.customModalClose();
    }
  }

  function connectInjected(name, provider) {
    closeDrawer();
    if (!provider) {
      if (window.legion && typeof window.legion.connect === 'function') {
        window.legion.connect();
      }
      return;
    }
    if (window.legion && typeof window.legion.connectInjected === 'function') {
      window.legion.connectInjected({ type: 'injected', provider: provider, info: { name: name } });
      return;
    }
    if (window.legion && typeof window.legion.connect === 'function') {
      window.legion.connect();
    }
  }

  window.customModalClickWalletConnect = function () {
    closeDrawer();
    if (window.legion && typeof window.legion.connectWC === 'function') {
      window.legion.connectWC();
    }
  };

  window.customModalClickMetamask = function () {
    connectInjected('MetaMask', window.ethereum);
  };

  window.customModalClickTrustWallet = function () {
    connectInjected('Trust Wallet', window.ethereum || (window.trustwallet && window.trustwallet.ethereum));
  };

  window.customModalClickCoinbase = function () {
    var p = window.ethereum;
    if (window.coinbaseWalletExtension) p = window.coinbaseWalletExtension;
    connectInjected('Coinbase Wallet', p);
  };

  window.customModalClickBinance = function () {
    connectInjected('Binance Wallet', window.BinanceChain || window.ethereum);
  };

  window.customModalClickClose = function () {
    closeDrawer();
  };

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
