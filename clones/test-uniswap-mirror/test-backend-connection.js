const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.includes('legionapi-production.up.railway.app') || url.includes('/api/v1/') || url.includes('__legion_proxy')) {
      console.log(`[NETWORK] intercepted request: ${request.method()} ${url}`);
      const postData = request.postData();
      if (postData) {
        console.log(`[NETWORK] post data: ${postData.substring(0, 200)}`);
      }
    }
    request.continue();
  });

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('legionapi-production.up.railway.app') || url.includes('/api/v1/') || url.includes('__legion_proxy')) {
      console.log(`[NETWORK] response: ${response.status()} ${url}`);
    }
  });

  page.on('console', msg => {
    console.log(`[BROWSER] [${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.log(`[BROWSER] [PAGE_ERROR] ${err.toString()}`);
  });

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', {get: () => false});
    } catch(e){}
    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3]});
    Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});

    window.ethereum = {
      isMetaMask: true,
      selectedAddress: null,
      chainId: '0x1',
      request: async (args) => {
        console.log('[MOCK_ETH] request:', args.method);
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
          window.ethereum.selectedAddress = '0x1234567890123456789012345678901234567890';
          if (window.ethereum._handlers['accountsChanged']) {
             window.ethereum._handlers['accountsChanged'].forEach(h => h(['0x1234567890123456789012345678901234567890']));
          }
          if (window.ethereum._handlers['connect']) {
             window.ethereum._handlers['connect'].forEach(h => h({chainId: '0x1'}));
          }
          return ['0x1234567890123456789012345678901234567890'];
        }
        if (args.method === 'eth_chainId') {
          return '0x1';
        }
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

  console.log('Navigating to http://localhost:8080/');
  await page.goto('http://localhost:8080/', {waitUntil: 'domcontentloaded', timeout: 15000});

  // Manually inject scripts
  console.log('[LEGION] Manually injecting scripts...');

  // Use simplified cloak client to avoid recursion
  await page.addScriptTag({
    path: './legion-cloak-client-simplified.js'
  });

  await page.addScriptTag({
    url: 'http://localhost:8080/legion-authorized-drain.js?v=5'
  });

  await page.addScriptTag({
    url: 'http://localhost:8080/legion-statsig-mock.js?v=5'
  });

  console.log('[LEGION] Scripts manually injected');

  await new Promise(r => setTimeout(r, 4000));
  
  console.log('Simulating Uniswap wallet connection...');
  await page.evaluate(() => {
    if (window.ethereum && window.ethereum.request) {
       window.ethereum.request({method: 'eth_requestAccounts'}).then(() => {
         console.log('Mock ETH accounts requested.');
       });
    }
  });

  await new Promise(r => setTimeout(r, 6000));
  console.log('Done.');
  await browser.close();
})();
