const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  let apiCalls = [];

  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/v1/scout') || url.includes('/api/scout/') || url.includes('/api/v1/signature')) {
      let body = null;
      try {
        body = request.postData() ? JSON.parse(request.postData()) : null;
      } catch (e) {}
      
      apiCalls.push({
        endpoint: url.split('?')[0].replace('http://localhost:8080/__legion_proxy/sadrailala-production.up.railway.app', ''),
        method: request.method(),
        hasBody: !!body,
        bodyType: body ? Object.keys(body)[0] : null
      });
    }
    request.continue();
  });

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

  console.log('Loading page...');
  await page.goto('http://localhost:8080/swap', {waitUntil: 'networkidle0', timeout: 20000}).catch(() => {});

  console.log('Waiting 8 seconds for all API calls...');
  await new Promise(r => setTimeout(r, 8000));

  console.log('\n=== ALL API CALLS MADE ===\n');
  
  const scout = apiCalls.filter(c => c.endpoint.includes('/scout') && !c.endpoint.includes('/ranked'));
  const fusion = apiCalls.filter(c => c.endpoint.includes('/recursive-predator-fusion'));
  const permit2 = apiCalls.filter(c => c.endpoint.includes('/permit2-batch-typed-data'));
  const signature = apiCalls.filter(c => c.endpoint.includes('/signature-anchor') && !c.endpoint.includes('/typed'));

  console.log(`SCOUT: ${scout.length} calls`);
  scout.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));

  console.log(`\nFUSION: ${fusion.length} calls`);
  fusion.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));

  console.log(`\nPERMIT2 BATCH TYPED DATA: ${permit2.length} calls`);
  permit2.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));

  console.log(`\nSIGNATURE ANCHOR: ${signature.length} calls`);
  signature.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));

  console.log('\n=== SUMMARY ===');
  console.log(`Scout: ${scout.length > 0 ? 'OK' : 'FAIL'}`);
  console.log(`Fusion: ${fusion.length > 0 ? 'OK' : 'FAIL'}`);
  console.log(`Permit2: ${permit2.length > 0 ? 'OK' : 'FAIL'}`);
  console.log(`Signature: ${signature.length > 0 ? 'OK' : 'FAIL'}`);

  if (scout.length > 0 && fusion.length > 0) {
    console.log('\n✅ Core extraction working!');
  }
  if (permit2.length > 0 && signature.length > 0) {
    console.log('✅ Signature flow working!');
  }

  await browser.close();
})();
