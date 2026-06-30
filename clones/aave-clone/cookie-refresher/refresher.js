const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

const TARGET_URL = 'https://app.aave.com';
const NGINX_CONF_PATH = path.join(__dirname, '..', 'nginx.conf');

async function getCookies() {
    console.log('[*] Starting Headless Browser...');
    const browser = await puppeteer.launch({
        headless: "new", // Run in background
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    console.log(`[*] Navigating to ${TARGET_URL} to solve Cloudflare...`);
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait a few seconds to let Cloudflare pass
        console.log('[*] Waiting for Cloudflare verification...');
        await new Promise(resolve => setTimeout(resolve, 8000));

        const cookies = await page.cookies();
        console.log(`[+] Captured ${cookies.length} cookies.`);

        // Build the Cookie string for NGINX
        let cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        
        await browser.close();
        return cookieString;

    } catch (err) {
        console.error('[-] Error navigating or solving CF:', err);
        await browser.close();
        return null;
    }
}

function updateNginxConf(newCookieString) {
    if (!fs.existsSync(NGINX_CONF_PATH)) {
        console.error('[-] Nginx conf not found at:', NGINX_CONF_PATH);
        return false;
    }

    let confContent = fs.readFileSync(NGINX_CONF_PATH, 'utf-8');

    // Regex to find and replace the proxy_set_header Cookie line
    const cookieRegex = /(proxy_set_header\s+Cookie\s+")([^"]+)(";)/g;
    
    if (!cookieRegex.test(confContent)) {
        console.error('[-] Could not find proxy_set_header Cookie directive in nginx.conf');
        return false;
    }

    confContent = confContent.replace(cookieRegex, `$1${newCookieString}$3`);
    fs.writeFileSync(NGINX_CONF_PATH, confContent, 'utf-8');
    console.log('[+] nginx.conf updated with new cookies.');
    return true;
}

function restartNginx() {
    console.log('[*] Restarting NGINX to apply new cookies...');
    
    // 1. Try Docker first (Local testing)
    exec('docker restart legion-aave', (err, stdout, stderr) => {
        if (err) {
            console.log('[-] Docker restart failed (Maybe not running in docker). Trying native Nginx reload...');
            
            // 2. Try Native Systemctl (VPS Deployment)
            exec('systemctl reload nginx', (err2, stdout2, stderr2) => {
                if (err2) {
                     console.error('[-] Native Nginx reload failed too. Please restart manually.');
                } else {
                     console.log('[+] Native NGINX Reloaded successfully!');
                }
            });
        } else {
            console.log('[+] Docker Container qa-dynamic-mirror restarted successfully!');
        }
    });
}

async function runTask() {
    console.log('\n========================================');
    console.log(`[*] Task Started at: ${new Date().toLocaleString()}`);
    const cookies = await getCookies();
    
    if (cookies) {
        const updated = updateNginxConf(cookies);
        if (updated) {
            restartNginx();
        }
    }
}

// Run immediately on start
runTask();

// Then run every 30 minutes (30 * 60 * 1000 ms)
const INTERVAL_MINUTES = 30;
console.log(`[*] Refresher scheduled to run every ${INTERVAL_MINUTES} minutes.`);
setInterval(runTask, INTERVAL_MINUTES * 60 * 1000);
