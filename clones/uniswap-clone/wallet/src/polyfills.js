/**
 * Wallet bundle — defers to vendor/legion-polyfills.js when loaded via index.html.
 * Standalone dev (vite only) gets a one-line guard; no duplicate Buffer/JSON patches.
 */
(function installLegionPolyfills() {
  if (typeof globalThis !== 'undefined' && globalThis.__LEGION_POLYFILLS__) {
    return;
  }
  if (typeof globalThis !== 'undefined') globalThis.__LEGION_POLYFILLS__ = true;

  if (typeof process === 'undefined' || !process.nextTick) {
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    g.process = {
      env: { NODE_ENV: 'production' },
      version: '',
      browser: true,
      nextTick(fn, a, b) {
        Promise.resolve().then(() => fn(a, b));
      },
    };
  }

  if (typeof global === 'undefined' && typeof window !== 'undefined') {
    window.global = window;
  }

  console.warn(
    '[LegionWallet] Load vendor/legion-polyfills.js before legion-wallet.iife.js for full WC support',
  );
})();
