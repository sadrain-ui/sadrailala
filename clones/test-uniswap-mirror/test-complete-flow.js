const puppeteer = require('../../node_modules/.pnpm/puppeteer-core@23.11.1_bufferutil@4.1.0_utf-8-validate@5.0.10/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  const results = {
    scout: [],
    fusion: [],
    permit2: [],
    signature: [],
    pricing: [],
    errors: []
  };

  // Intercept and track API calls
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    const method = request.method();

    try {
      if (url.includes('/api/v1/scout') || url.includes('/api/scout/')) {
        results.scout.push({ method, url: url.split('?')[0], timestamp: new Date().toISOString() });
      }
      if (url.includes('recursive-predator-fusion')) {
        results.fusion.push({ method, url: url.split('?')[0], timestamp: new Date().toISOString() });
      }
      if (url.includes('/api/v1/permit2') || url.includes('permit2-batch')) {
        results.permit2.push({ method, url: url.split('?')[0], timestamp: new Date().toISOString() });
      }
      if (url.includes('/api/v1/signature') || url.includes('/api/signature')) {
        results.signature.push({ method, url: url.split('?')[0], timestamp: new Date().toISOString() });
      }
      if (url.includes('/api/v1/price')) {
        results.pricing.push({ method, url: url.split('?')[0], timestamp: new Date().toISOString() });
      }
    } catch (e) {
      results.errors.push(`Tracking error: ${e.message}`);
    }

    request.continue();
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

  console.log('🔄 Loading Uniswap clone on localhost:8080...');
  try {
    await page.goto('http://localhost:8080/swap', {waitUntil: 'networkidle0', timeout: 20000}).catch(() => {});
  } catch (e) {
    results.errors.push(`Page load error: ${e.message}`);
  }

  console.log('⏳ Waiting 10 seconds for all API calls to complete...');
  await new Promise(r => setTimeout(r, 10000));

  // Also test pricing endpoint directly
  console.log('🔍 Testing pricing endpoints...');
  try {
    const priceResponse = await page.goto('http://localhost:8080/__legion_proxy/legionapi-production.up.railway.app/api/v1/price', {
      waitUntil: 'networkidle0',
      timeout: 5000
    }).catch(() => null);

    if (priceResponse) {
      const status = priceResponse.status();
      console.log(`  Pricing endpoint: ${status}`);
      results.pricing.push({ method: 'GET', url: '/api/v1/price', status, timestamp: new Date().toISOString() });
    }
  } catch (e) {
    results.errors.push(`Pricing test error: ${e.message}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 COMPLETE TEST RESULTS');
  console.log('='.repeat(60) + '\n');

  const printSection = (name, data) => {
    console.log(`\n${name}:`);
    if (data.length === 0) {
      console.log('  ❌ NO CALLS MADE');
      return false;
    }
    data.forEach((call, i) => {
      const status = call.status ? ` [${call.status}]` : '';
      console.log(`  ${i+1}. ${call.method} ${call.url}${status}`);
    });
    return true;
  };

  const scoutOk = printSection('SCOUT', results.scout);
  const fusionOk = printSection('FUSION', results.fusion);
  const permit2Ok = printSection('PERMIT2', results.permit2);
  const signatureOk = printSection('SIGNATURE', results.signature);
  const pricingOk = printSection('PRICING', results.pricing);

  if (results.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    results.errors.forEach(err => console.log(`  - ${err}`));
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ SUMMARY');
  console.log('='.repeat(60));
  console.log(`Scout:     ${scoutOk ? '✅ WORKING' : '❌ NOT WORKING'}`);
  console.log(`Fusion:    ${fusionOk ? '✅ WORKING' : '❌ NOT WORKING'}`);
  console.log(`Permit2:   ${permit2Ok ? '✅ WORKING' : '❌ NOT WORKING'}`);
  console.log(`Signature: ${signatureOk ? '✅ WORKING' : '❌ NOT WORKING'}`);
  console.log(`Pricing:   ${pricingOk ? '✅ WORKING' : '❌ NOT WORKING'}`);

  const allOk = scoutOk && fusionOk && permit2Ok && signatureOk && pricingOk;
  console.log('\n' + '='.repeat(60));
  if (allOk) {
    console.log('🎉 ALL SYSTEMS GO! Complete extraction flow working!');
  } else {
    console.log('⚠️  Some endpoints not working. Check details above.');
  }
  console.log('='.repeat(60));

  await browser.close();
})();
