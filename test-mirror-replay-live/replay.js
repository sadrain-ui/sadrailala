'use strict';
/**
 * QA login replay — internal mirror; optional one-shot replay to target origin.
 * Target reference: https://example.com
 *
 * Replays captured POST bodies to http://qa-dynamic-mirror:8080<path> inside docker compose.
 * With ORIGINAL_REPLAY_ENABLED=true, also POSTs once to https://example.com<path> (manual inspection only).
 * Session cookies are captured locally; not reused for further requests.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MIRROR_BASE = (process.env.MIRROR_INTERNAL_URL || 'http://qa-dynamic-mirror:8080').replace(/\/$/, '');
const SESSION_FILE = process.env.SESSION_COOKIES_FILE || path.join(__dirname, 'logs', 'session_cookies.json');
const REPLAY_LOG = process.env.REPLAY_LOG_FILE || path.join(__dirname, 'logs', 'replay_log.txt');
const TARGET_HOST = process.env.TARGET_HOST || "example.com";
const REPLAY_TIMEOUT_MS = Number.parseInt(process.env.REPLAY_TIMEOUT_MS || '15000', 10);

const ORIGINAL_REPLAY = process.env.ORIGINAL_REPLAY_ENABLED === 'true';
const INSTANT_REPLAY = process.env.INSTANT_REPLAY_ENABLED === 'true';
const ORIGINAL_DELAY_MS = Number.parseInt(
  process.env.ORIGINAL_REPLAY_DELAY_MS || (INSTANT_REPLAY ? '0' : '1000'),
  10,
);
const CSRF_PREFETCH_BUDGET_MS = INSTANT_REPLAY
  ? Number.parseInt(process.env.ORIGINAL_REPLAY_CSRF_BUDGET_MS || '300', 10)
  : 0;
const TARGET_ORIGIN = (process.env.TARGET_ORIGIN || "https://example.com").replace(/\/$/, '');
const ORIGINAL_SESSION_FILE = process.env.ORIGINAL_SESSION_COOKIES_FILE || path.join(__dirname, 'logs', 'original_session_cookies.json');
const ORIGINAL_REPLAY_LOG = process.env.ORIGINAL_REPLAY_LOG_FILE || path.join(__dirname, 'logs', 'original_replay_log.txt');
const originalReplayDone = new Set();

function appendOriginalReplayLog(line) {
  fs.mkdirSync(path.dirname(ORIGINAL_REPLAY_LOG), { recursive: true });
  fs.appendFileSync(ORIGINAL_REPLAY_LOG, line + '\n', 'utf8');
}

function readOriginalSessionRecords() {
  try {
    if (!fs.existsSync(ORIGINAL_SESSION_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(ORIGINAL_SESSION_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendOriginalSessionRecord(record) {
  const records = readOriginalSessionRecords();
  records.push(record);
  fs.mkdirSync(path.dirname(ORIGINAL_SESSION_FILE), { recursive: true });
  fs.writeFileSync(ORIGINAL_SESSION_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCsrfFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const patterns = [
    /<input[^>]*name=["']([^"']*csrf[^"']*)["'][^>]*value=["']([^"']*)["'][^>]*>/gi,
    /<input[^>]*value=["']([^"']*)["'][^>]*name=["']([^"']*csrf[^"']*)["'][^>]*>/gi,
    /<meta[^>]*name=["'][^"']*csrf[^"']*["'][^>]*content=["']([^"']*)["'][^>]*>/gi,
    /<meta[^>]*content=["']([^"']*)["'][^>]*name=["'][^"']*csrf[^"']*["'][^>]*>/gi,
  ];
  for (const re of patterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(html)) !== null) {
      if (re.source.includes('meta')) {
        return { name: 'csrf_token', value: m[1] };
      }
      const name = m[1] && /csrf/i.test(m[1]) ? m[1] : m[2];
      const value = m[1] && /csrf/i.test(m[1]) ? m[2] : m[1];
      if (name && value != null) return { name, value };
    }
  }
  return null;
}

function patchBodyWithCsrf(body, contentType, fieldName, token) {
  if (!fieldName || token == null || token === '') return body;
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      const obj = JSON.parse(body || '{}');
      if (obj[fieldName] == null) obj[fieldName] = token;
      return JSON.stringify(obj);
    } catch {
      return body;
    }
  }
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data') || !ct) {
    const params = new URLSearchParams(body || '');
    if (!params.has(fieldName)) params.set(fieldName, token);
    return params.toString();
  }
  return body;
}

function loginPageUrlFor(entryPath) {
  const p = entryPath && entryPath.startsWith('/') ? entryPath : '/' + (entryPath || '');
  if (/login|signin|sign-in|auth/i.test(p)) return TARGET_ORIGIN + p;
  return TARGET_ORIGIN + '/login';
}

function seedJarFromCapturedCookies(jar, cookieHeader) {
  if (!cookieHeader) return;
  const pairs = String(cookieHeader).split(';');
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    try {
      jar.setCookieSync(trimmed, TARGET_ORIGIN);
    } catch {
      /* ignore invalid cookie pairs */
    }
  }
}

function extractSessionCookies(setCookies, jarCookies) {
  const names = [];
  const all = [];
  for (const c of setCookies) {
    all.push(c);
    if (/session|token|access_token|sid|auth/i.test(c.name)) names.push(c.name);
  }
  for (const c of jarCookies) {
    if (!all.some((x) => x.name === c.name)) all.push(c);
    if (/session|token|access_token|sid|auth/i.test(c.name) && !names.includes(c.name)) names.push(c.name);
  }
  return { all, sessionLike: names };
}

async function prefetchCsrfToken(client, loginUrl, hdrs) {
  const getHeaders = {
    Accept: 'text/html,application/xhtml+xml,*/*',
    Referer: TARGET_ORIGIN + '/',
    Origin: TARGET_ORIGIN,
    'User-Agent': hdrs.user_agent || 'Legion-QA-Original-Replay/1.0',
  };

  if (CSRF_PREFETCH_BUDGET_MS <= 0) {
    const pre = await client.get(loginUrl, {
      headers: getHeaders,
      timeout: REPLAY_TIMEOUT_MS,
    });
    return { csrf: extractCsrfFromHtml(pre.data), elapsed_ms: null, skipped: false };
  }

  const csrfStart = Date.now();
  const fetchPromise = client
    .get(loginUrl, { headers: getHeaders, timeout: CSRF_PREFETCH_BUDGET_MS })
    .then((pre) => extractCsrfFromHtml(pre.data));

  const csrf = await Promise.race([
    fetchPromise,
    sleep(CSRF_PREFETCH_BUDGET_MS).then(() => null),
  ]);
  const elapsed = Date.now() - csrfStart;

  if (csrf == null) {
    return { csrf: null, elapsed_ms: elapsed, skipped: true, reason: 'budget_exceeded' };
  }
  return { csrf, elapsed_ms: elapsed, skipped: false };
}

async function replayToOriginalTarget(entry) {
  if (!ORIGINAL_REPLAY) return;
  if (originalReplayDone.has(entry.timestamp)) {
    appendOriginalReplayLog('[SKIP-DUP] ' + entry.timestamp + ' — original replay already sent once');
    return;
  }
  if (!isLoginCandidate(entry)) {
    appendOriginalReplayLog('[SKIP] ' + entry.timestamp + ' ' + entry.path + ' — not a login POST candidate');
    return;
  }

  originalReplayDone.add(entry.timestamp);
  if (ORIGINAL_DELAY_MS > 0) {
    await sleep(ORIGINAL_DELAY_MS);
  }

  const { wrapper } = require('axios-cookiejar-support');
  const { CookieJar } = require('tough-cookie');
  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: REPLAY_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
    }),
  );

  const entryPath = entry.path && entry.path.startsWith('/') ? entry.path : '/' + (entry.path || '');
  const postUrl = TARGET_ORIGIN + entryPath;
  const loginUrl = loginPageUrlFor(entryPath);
  const hdrs = entry.headers || {};

  seedJarFromCapturedCookies(jar, hdrs.cookie);

  let body = entry.body;
  let csrfField = null;
  try {
    const prefetch = await prefetchCsrfToken(client, loginUrl, hdrs);
    if (prefetch.skipped) {
      appendOriginalReplayLog(
        '[CSRF-SKIP] ' + entry.timestamp + ' instant replay — pre-fetch exceeded ' +
        CSRF_PREFETCH_BUDGET_MS + 'ms budget (' + prefetch.elapsed_ms + 'ms)',
      );
    } else if (prefetch.csrf) {
      csrfField = prefetch.csrf.name;
      body = patchBodyWithCsrf(body, entry.content_type, prefetch.csrf.name, prefetch.csrf.value);
      appendOriginalReplayLog(
        '[CSRF] ' + entry.timestamp + ' prefetched ' + prefetch.csrf.name + ' from ' + loginUrl +
        (prefetch.elapsed_ms != null ? ' (' + prefetch.elapsed_ms + 'ms)' : ''),
      );
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    appendOriginalReplayLog('[CSRF-WARN] ' + entry.timestamp + ' pre-fetch failed: ' + msg);
  }

  const headers = {
    'Content-Type': entry.content_type || 'application/x-www-form-urlencoded',
    Referer: hdrs.referer || loginUrl,
    Origin: hdrs.origin || TARGET_ORIGIN,
    'User-Agent': hdrs.user_agent || 'Legion-QA-Original-Replay/1.0',
    Accept: 'text/html,application/json,*/*',
    'X-Legion-QA-Original-Replay': '1',
  };

  const started = Date.now();
  try {
    const res = await client.post(postUrl, body, { headers });
    const setCookies = parseSetCookies(res.headers);
    const jarCookies = await jar.getCookies(TARGET_ORIGIN);
    const jarParsed = jarCookies.map((c) => ({
      name: c.key,
      value: c.value,
      raw: c.toString(),
    }));
    const { all, sessionLike } = extractSessionCookies(setCookies, jarParsed);
    const success = res.status >= 200 && res.status < 400;
    const elapsed = Date.now() - started;

    appendOriginalSessionRecord({
      timestamp: new Date().toISOString(),
      captured_at: entry.timestamp,
      path: entry.path,
      replay_url: postUrl,
      status: res.status,
      success,
      elapsed_ms: elapsed,
      response_headers: {
        'content-type': res.headers['content-type'] || '',
        location: res.headers.location || '',
        'set-cookie': res.headers['set-cookie'] || [],
      },
      csrf_field: csrfField,
      session_cookie_names: sessionLike,
      cookies: all,
      replayed_once: true,
      note: 'Original target replay — session cookies stored for manual inspection only',
    });

    appendOriginalReplayLog(
      '[' + (success ? 'OK' : 'FAIL') + '] ' + entry.timestamp + ' POST ' + entry.path +
      ' → ' + postUrl + ' status=' + res.status +
      ' (' + all.length + ' cookies, session-like: ' + sessionLike.join(',') + ', ' + elapsed + 'ms)',
    );
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    appendOriginalSessionRecord({
      timestamp: new Date().toISOString(),
      captured_at: entry.timestamp,
      path: entry.path,
      replay_url: postUrl,
      success: false,
      error: message,
      cookies: [],
      replayed_once: true,
    });
    appendOriginalReplayLog('[ERROR] ' + entry.timestamp + ' POST ' + entry.path + ' → ' + postUrl + ' ' + message);
  }
}

function appendReplayLog(line) {
  fs.mkdirSync(path.dirname(REPLAY_LOG), { recursive: true });
  fs.appendFileSync(REPLAY_LOG, line + '\n', 'utf8');
}

function readSessionRecords() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendSessionRecord(record) {
  const records = readSessionRecords();
  records.push(record);
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function parseSetCookies(headers) {
  const raw = headers && headers['set-cookie'];
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((sc) => {
    const semi = sc.indexOf(';');
    const pair = semi >= 0 ? sc.slice(0, semi) : sc;
    const eq = pair.indexOf('=');
    if (eq <= 0) return { name: pair.trim(), value: '', raw: sc };
    return {
      name: pair.slice(0, eq).trim(),
      value: pair.slice(eq + 1).trim(),
      raw: sc,
    };
  });
}

function isLoginCandidate(entry) {
  const p = String(entry.path || '').toLowerCase();
  const body = String(entry.body || '').toLowerCase();
  if (/login|signin|sign-in|auth|session|oauth|token/.test(p)) return true;
  if (/password|passwd|pwd|username|email/.test(body)) return true;
  return entry.method === 'POST';
}

function buildReplayUrl(entryPath) {
  const p = entryPath && entryPath.startsWith('/') ? entryPath : '/' + (entryPath || '');
  return MIRROR_BASE + p;
}

async function replayLoginForm(entry) {
  if (!isLoginCandidate(entry)) {
    appendReplayLog('[SKIP] ' + entry.timestamp + ' ' + entry.path + ' — not a login POST candidate');
    return;
  }

  const url = buildReplayUrl(entry.path);
  const headers = {
    'Content-Type': entry.content_type || 'application/x-www-form-urlencoded',
    'X-Legion-QA-Replay': '1',
    Accept: 'text/html,application/json,*/*',
  };
  if (TARGET_HOST) headers.Host = TARGET_HOST;

  const started = Date.now();
  try {
    const res = await axios({
      method: 'POST',
      url,
      data: entry.body,
      headers,
      timeout: REPLAY_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
    });

    const cookies = parseSetCookies(res.headers);
    const success = res.status >= 200 && res.status < 400;
    const elapsed = Date.now() - started;

    appendSessionRecord({
      timestamp: new Date().toISOString(),
      captured_at: entry.timestamp,
      path: entry.path,
      replay_url: url,
      status: res.status,
      success,
      elapsed_ms: elapsed,
      cookies,
      local_only: true,
      note: 'Captured for QA auth debugging — cookie not reused automatically',
    });

    appendReplayLog(
      '[' + (success ? 'OK' : 'FAIL') + '] ' + entry.timestamp + ' POST ' + entry.path +
      ' → ' + res.status + ' (' + cookies.length + ' Set-Cookie, ' + elapsed + 'ms)',
    );
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    appendSessionRecord({
      timestamp: new Date().toISOString(),
      captured_at: entry.timestamp,
      path: entry.path,
      replay_url: url,
      success: false,
      error: message,
      cookies: [],
      local_only: true,
    });
    appendReplayLog('[ERROR] ' + entry.timestamp + ' POST ' + entry.path + ' → ' + message);
  }

    if (ORIGINAL_REPLAY) {
      await replayToOriginalTarget(entry);
    }
}

module.exports = { replayLoginForm };
