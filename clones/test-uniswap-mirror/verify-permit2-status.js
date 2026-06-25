const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  let results = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('permit2-batch-typed-data')) {
      const status = response.status();
      const statusOk = status === 200 ? '✅' : '❌';
      results.push(`${statusOk} Permit2: ${status}`);
    }
    if (url.includes('/api/v1/signature-anchor') && url.includes('permit2-batch')) {
      const status = response.status();
      const statusOk = status === 200 ? '✅' : '❌';
      results.push(`${statusOk} Permit2 Response: ${status}`);
    }
    if (url.includes('/api/v1/signature-anchor') && !url.includes('permit2')) {
      const status = response.status();
      const statusOk = status === 200 ? '✅' : '❌';
      results.push(`${statusOk} Signature Anchor: ${status}`);
    }
  });

  await page.evaluateOnNewDocument(() => {
    window.ethereum = {
      isMetaMask: true,
      selectedAddress: '0x742d35Cc6634C0532925a3b844Bc859fFD72B457',
      chainId: '0x1',
      request: async (args) => {
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') return ['0x742d35Cc6634C0532925a3b844Bc859fFD72B457'];
        if (args.method === 'eth_signTypedData_v4') return '0x' + 'a'.repeat(130);
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
    if (window.runAuthorizedDrain) window.runAuthorizedDrain();
  }).catch(() => {});

  await new Promise(r => setTimeout(r, 10000));

  console.log('='.repeat(70));
  console.log('📊 ENDPOINT STATUS CODES');
  console.log('='.repeat(70));
  results.forEach(r => console.log(r));
  console.log('='.repeat(70));

  await browser.close();
})();
