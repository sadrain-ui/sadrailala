const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  
  page.on('console', msg => console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`));
  page.on('response', res => {
    if (res.url().includes('/api/v1/') || res.url().includes('legionapi')) {
      console.log('📡 API:', res.status(), res.url().split('?')[0]);
    }
  });

  try {
    await page.goto('http://localhost:8080/swap', { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log('Page loaded successfully.');

    // Wait for injection scripts to execute
    await new Promise(r => setTimeout(r, 3000));

    // Wait a bit more for scripts to fully load
    await new Promise(r => setTimeout(r, 2000));

    // Check entire head for legion references
    const headContent = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      const legionScripts = scripts.filter(s => s.src && s.src.includes('legion'));
      return {
        totalScripts: scripts.length,
        legionCount: legionScripts.length,
        legionSrcs: legionScripts.map(s => ({ src: s.src, async: s.async, defer: s.defer })),
        headHTML: document.head.innerHTML.substring(0, 2000).match(/legion[^"]+/g) || []
      };
    });
    console.log('📋 HEAD ANALYSIS:', JSON.stringify(headContent, null, 2));

  } catch (err) {
    console.error('Error during navigation:', err);
  } finally {
    await browser.close();
  }
})();
