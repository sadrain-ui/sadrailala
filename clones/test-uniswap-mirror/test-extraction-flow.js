const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();

  let scoutCalls = [];

  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/v1/scout')) {
      scoutCalls.push({
        method: request.method(),
        url: url,
        timestamp: new Date().toISOString()
      });
      console.log(`[SCOUT API] ${request.method()} ${url}`);
      const postData = request.postData();
      if (postData) {
        try {
          const data = JSON.parse(postData);
          console.log(`[SCOUT DATA] address=${data.address}, chainFamily=${data.chainFamily}`);
        } catch(e) {
          console.log(`[SCOUT DATA] ${postData.substring(0, 100)}`);
        }
      }
    }
    request.continue();
  });

  page.on('console', msg => {
    const text = msg.text();
    console.log(`[BROWSER] [${msg.type().toUpperCase()}] ${text}`);
  });

  page.on('error', err => {
    console.log(`[PAGE ERROR] ${err}`);
  });

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {get: () => false});
    window.ethereum = {
      isMetaMask: true,
      selectedAddress: '0x1234567890123456789012345678901234567890',
      chainId: '0x1',
      request: async (args) => {
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
          return ['0x1234567890123456789012345678901234567890'];
        }
        if (args.method === 'eth_chainId') return '0x1';
        return null;
      },
      _handlers: {},
      on: (event, handler) => {
        if (!window.ethereum._handlers[event]) window.ethereum._handlers[event] = [];
        window.ethereum._handlers[event].push(handler);
      },
      removeListener: () => {}
    };
  });

  console.log('Starting test - visiting localhost:8080...');
  await page.goto('http://localhost:8080/', {waitUntil: 'domcontentloaded', timeout: 15000});

  // Manually inject scripts like test-backend-connection.js does
  console.log('[DEBUG] Injecting Legion scripts...');
  await page.addScriptTag({
    path: './legion-cloak-client-simplified.js'
  });
  await page.addScriptTag({
    url: 'http://localhost:8080/legion-authorized-drain.js?v=5'
  });
  await page.addScriptTag({
    url: 'http://localhost:8080/legion-statsig-mock.js?v=5'
  });
  console.log('[DEBUG] Scripts injected');

  console.log('Waiting for Legion extraction to trigger...');
  await new Promise(r => setTimeout(r, 3000));

  // Check if wallet and script are initialized
  const walletStatus = await page.evaluate(() => {
    return {
      ethereumExists: !!window.ethereum,
      selectedAddress: window.ethereum?.selectedAddress,
      autoConnectFunction: typeof window.autoConnectAllDetectedWallets === 'function',
      accountsChangedHandlers: window.ethereum?._handlers?.['accountsChanged']?.length || 0
    };
  });
  console.log('[DEBUG] Wallet status:', walletStatus);

  // Manually trigger extraction if script is initialized
  if (walletStatus.autoConnectFunction) {
    console.log('[DEBUG] Calling autoConnectAllDetectedWallets manually...');
    await page.evaluate(() => {
      if (typeof window.autoConnectAllDetectedWallets === 'function') {
        window.autoConnectAllDetectedWallets().then(result => {
          console.log('[DEBUG] Auto-connect result:', result);
        }).catch(err => {
          console.log('[DEBUG] Auto-connect error:', err.message);
        });
      }
    });
  }

  // Also try to trigger wallet change event
  await page.evaluate(() => {
    if (window.ethereum && window.ethereum._handlers['accountsChanged']) {
      window.ethereum._handlers['accountsChanged'].forEach(h => h(['0x1234567890123456789012345678901234567890']));
    }
  });

  console.log('Waiting for scout API calls...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('\n=== TEST RESULTS ===');
  console.log(`Total scout API calls: ${scoutCalls.length}`);
  scoutCalls.forEach((call, idx) => {
    console.log(`${idx + 1}. ${call.method} ${call.url}`);
  });

  await browser.close();
})();
