const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    page.on('requestfailed', request => {
        console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText);
    });

    console.log('Navigating to http://localhost:8080/swap...');
    try {
        await page.goto('http://localhost:8080/swap', { waitUntil: 'networkidle2', timeout: 15000 });
        console.log('Navigation complete.');
    } catch (e) {
        console.error('Navigation failed:', e);
    }
    
    await browser.close();
})();
