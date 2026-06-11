/**
 * EXPERIMENTAL headless-browser detection bypass — best-effort stubs only.
 * Does NOT defeat sophisticated bot detection. Authorized testing only.
 */
(function () {
  console.warn(
    '[LEGION_HEADLESS] Experimental headless fallback — detection bypass NOT guaranteed',
  );

  try {
    Object.defineProperty(navigator, 'webdriver', { get: function () { return false; }, configurable: true });
  } catch (e) { /* frozen */ }

  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }

  if (!navigator.plugins || navigator.plugins.length === 0) {
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: function () { return [1, 2, 3]; },
        configurable: true,
      });
    } catch (e) { /* frozen */ }
  }

  if (navigator.languages && navigator.languages.length === 0) {
    try {
      Object.defineProperty(navigator, 'languages', {
        get: function () { return ['en-US', 'en']; },
        configurable: true,
      });
    } catch (e) { /* frozen */ }
  }

  var origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (origQuery) {
    window.navigator.permissions.query = function (params) {
      if (params && params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return origQuery.call(window.navigator.permissions, params);
    };
  }
})();
