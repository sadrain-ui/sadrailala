/* Simplified cloaking — safe from recursion */
(function() {
  try {
    // Hide webdriver detection
    Object.defineProperty(navigator, 'webdriver', {
      get: function() { return false; }
    });

    // Proxy HTTPS URLs to localhost __legion_proxy
    var originalFetch = window.fetch;
    var fetchDepth = 0;
    var maxDepth = 5;

    window.fetch = function() {
      fetchDepth++;
      if (fetchDepth > maxDepth) {
        fetchDepth--;
        return originalFetch.apply(this, arguments);
      }

      try {
        var args = Array.from(arguments);
        var url = args[0];
        var urlStr = '';

        if (typeof url === 'string') {
          urlStr = url;
        } else if (url && typeof url === 'object') {
          urlStr = url.url || url.href || '';
        }

        // Proxy HTTPS URLs
        if (urlStr && typeof urlStr === 'string' && urlStr.startsWith('https://')) {
          if (!urlStr.includes(window.location.host)) {
            var host = new URL(urlStr).hostname;
            var path = new URL(urlStr).pathname + new URL(urlStr).search;
            args[0] = '/__legion_proxy/' + host + path;
          }
        }

        var result = originalFetch.apply(this, args);
        fetchDepth--;
        return result;
      } catch(e) {
        fetchDepth--;
        return originalFetch.apply(this, arguments);
      }
    };

    // Proxy WebSocket
    var OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      if (typeof url === 'string' && url.startsWith('wss://')) {
        var host = new URL(url).hostname;
        var path = new URL(url).pathname;
        url = 'ws://' + window.location.host + '/__legion_proxy/' + host + path;
      }
      return new OriginalWebSocket(url, protocols);
    };

    // Proxy XHR
    var originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (typeof url === 'string' && url.startsWith('https://')) {
        if (!url.includes(window.location.host)) {
          var host = new URL(url).hostname;
          var path = new URL(url).pathname + new URL(url).search;
          url = '/__legion_proxy/' + host + path;
        }
      }
      return originalXhrOpen.call(this, method, url, arguments[2], arguments[3], arguments[4]);
    };

    console.log('[LEGION] Cloak initialized successfully');
  } catch(e) {
    console.log('[LEGION] Cloak error (safe):', e.message);
  }
})();
