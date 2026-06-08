/**
 * Hardened nginx TLS profile — Chrome/Firefox-compatible cipher suites.
 */

export const HARDENED_TLS_DIRECTIVES = `
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
  ssl_prefer_server_ciphers off;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_session_tickets off;
  add_header Strict-Transport-Security "max-age=63072000" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options SAMEORIGIN always;
`.trim()

export type MirrorNginxTemplateParams = {
  targetOrigin: string
  targetHost: string
  listenPort?: number
  serverName: string
  sslCertPath?: string
  sslKeyPath?: string
}

export function renderMirrorNginxConfig(params: MirrorNginxTemplateParams): string {
  const listenPort = params.listenPort ?? 443
  const upstreamScheme = params.targetOrigin.startsWith('https') ? 'https' : 'http'
  const sslBlock =
    params.sslCertPath && params.sslKeyPath
      ? `
    listen ${listenPort} ssl http2;
    server_name ${params.serverName};
    ssl_certificate     ${params.sslCertPath};
    ssl_certificate_key ${params.sslKeyPath};
${HARDENED_TLS_DIRECTIVES.split('\n').map((l) => `    ${l}`).join('\n')}`
      : `
    listen ${listenPort};
    server_name ${params.serverName};`

  return `# Legion Mirror — hardened reverse proxy (authorized red-team staging)
# Target: ${params.targetOrigin}

worker_processes auto;
events { worker_connections 4096; }

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile      on;
  tcp_nopush    on;
  keepalive_timeout 65;
  proxy_connect_timeout 60s;
  proxy_send_timeout 120s;
  proxy_read_timeout 120s;
  proxy_buffering on;
  server_tokens off;

  server {${sslBlock}

    root /usr/share/nginx/html;
    index index.html;

    location = / {
      try_files /index.html =404;
      add_header Cache-Control "no-store";
      add_header X-Legion-Mirror "active";
    }

    location / {
      proxy_pass ${upstreamScheme}://${params.targetHost};
      proxy_ssl_server_name on;
      proxy_http_version 1.1;
      proxy_set_header Host ${params.targetHost};
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header Connection "";
      proxy_redirect off;
    }
  }
}
`
}

export async function writeNginxConfig(
  confPath: string,
  params: MirrorNginxTemplateParams,
): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(confPath, renderMirrorNginxConfig(params), 'utf8')
}
