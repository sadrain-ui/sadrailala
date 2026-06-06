'use strict';
/**
 * QA mirror form logger — appends POST bodies to logs.json on this machine only.
 * Not exposed publicly; invoked by nginx mirror from the docker network.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number.parseInt(process.env.LOGGER_PORT || '9090', 10);
const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, 'logs.json');
const MAX_ENTRIES = Number.parseInt(process.env.LOGGER_MAX_ENTRIES || '500', 10);

function readEntries() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendEntry(entry) {
  const entries = readEntries();
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      appendEntry({
        timestamp: new Date().toISOString(),
        method: req.headers['x-original-method'] || 'POST',
        path: req.headers['x-original-uri'] || '/',
        content_type: req.headers['content-type'] || '',
        body,
        local_only: true,
        note: 'QA staging — manual review on this host only',
      });
      res.writeHead(204);
      res.end();
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, entries: readEntries().length, log_file: LOG_FILE }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[mirror-logger] QA form logger on port ' + PORT + ' → ' + LOG_FILE);
});
