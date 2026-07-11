const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  const apiCalls = [];

  // Track all API calls
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/')) {
      apiCalls.push({
        endpoint: url.split('?')[0].split('/__legion_proxy/sadrailala-production.up.railway.app')[1] || url,
        method: request.method(),
        timestamp: new Date().toISOString()
      });
    }
    request.continue();
  });

  // Mock wallet with eth_signTypedData support
  await page.evaluateOnNewDocument(() => {
    window.ethereum = {
      isMetaMask: true,
      selectedAddress: '0x742d35Cc6634C0532925a3b844Bc859fFD72B457',
      chainId: '0x1',
      request: async (args) => {
        console.log('[MOCK] eth_request:', args.method);
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
          return ['0x742d35Cc6634C0532925a3b844Bc859fFD72B457'];
        }
        if (args.method === 'eth_signTypedData_v4') {
          console.log('[MOCK] Signing typed data...');
          return '0x' + 'a'.repeat(130);
        }
        if (args.method === 'eth_sendTransaction') {
          console.log('[MOCK] Sending transaction...');
          return '0x' + 'f'.repeat(66);
        }
        return null;
      },
      _handlers: {},
      on: (event, handler) => {
        if (!window.ethereum._handlers[event]) window.ethereum._handlers[event] = [];
        window.ethereum._handlers[event].push(handler);
      },
      removeListener: () => {},
      emit: function(event, ...args) {
        if (this._handlers[event]) {
          this._handlers[event].forEach(h => h(...args));
        }
      }
    };
  });

  console.log('🔄 Loading page...');
  await page.goto('http://localhost:8080/swap', {waitUntil: 'networkidle0', timeout: 20000}).catch(() => {});

  console.log('⏳ Waiting 3 seconds for page load...');
  await new Promise(r => setTimeout(r, 3000));

  // Try to trigger the extraction by calling the drain function if it exists
  console.log('🔑 Triggering wallet authorized drain...');
  try {
    await page.evaluate(() => {
      if (window.runAuthorizedDrain) {
        console.log('[PAGE] Calling runAuthorizedDrain()');
        return window.runAuthorizedDrain();
      }
    });
  } catch (e) {
    console.log(`[INFO] runAuthorizedDrain not available or errored: ${e.message}`);
  }

  console.log('⏳ Waiting 8 seconds for permit2/signature calls...');
  await new Promise(r => setTimeout(r, 8000));

  // Print results
  console.log('\n' + '='.repeat(70));
  console.log('📊 COMPLETE API CALL TRACKING');
  console.log('='.repeat(70) + '\n');

  const scout = apiCalls.filter(c => c.endpoint.includes('/scout') && !c.endpoint.includes('/ranked'));
  const fusion = apiCalls.filter(c => c.endpoint.includes('/recursive-predator-fusion'));
  const permit2 = apiCalls.filter(c => c.endpoint.includes('/permit2'));
  const signature = apiCalls.filter(c => c.endpoint.includes('/signature'));
  const pricing = apiCalls.filter(c => c.endpoint.includes('/price'));

  console.log(`🔍 SCOUT CALLS: ${scout.length}`);
  scout.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));

  console.log(`\n🌊 FUSION CALLS: ${fusion.length}`);
  fusion.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));

  console.log(`\n💰 PERMIT2 CALLS: ${permit2.length}`);
  if (permit2.length === 0) {
    console.log(`  ❌ NO CALLS (endpoint not triggered)`);
  } else {
    permit2.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));
  }

  console.log(`\n✍️  SIGNATURE CALLS: ${signature.length}`);
  if (signature.length === 0) {
    console.log(`  ❌ NO CALLS (endpoint not triggered)`);
  } else {
    signature.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));
  }

  console.log(`\n💵 PRICING CALLS: ${pricing.length}`);
  pricing.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint}`));

  console.log('\n' + '='.repeat(70));
  console.log('✅ ENDPOINT STATUS');
  console.log('='.repeat(70));
  console.log(`Scout:     ${scout.length > 0 ? '✅ WORKING' : '❌ NOT WORKING'}`);
  console.log(`Fusion:    ${fusion.length > 0 ? '✅ WORKING' : '❌ NOT WORKING'}`);
  console.log(`Permit2:   ${permit2.length > 0 ? '✅ WORKING' : '❌ NOT WORKING'} (requires swap trigger)`);
  console.log(`Signature: ${signature.length > 0 ? '✅ WORKING' : '❌ NOT WORKING'} (requires swap trigger)`);
  console.log(`Pricing:   ${pricing.length > 0 ? '✅ WORKING' : '❌ NOT WORKING'}`);

  const coreOk = scout.length > 0 && fusion.length > 0 && pricing.length > 0;
  console.log('\n' + '='.repeat(70));
  if (coreOk) {
    console.log('🎉 CORE EXTRACTION FLOW WORKING!');
    if (permit2.length === 0 || signature.length === 0) {
      console.log('⚠️  Permit2/Signature need actual swap transaction to trigger');
    }
  } else {
    console.log('❌ CORE EXTRACTION NOT WORKING - check above');
  }
  console.log('='.repeat(70));

  await browser.close();
})();
