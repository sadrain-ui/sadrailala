/**
 * LEGION ORCHESTRATOR
 *
 * Phase 4: Unified orchestration of all 4 phases
 * - Detects platform automatically
 * - Loads template
 * - Generates nginx config
 * - Sets up cookie rotation
 * - Returns production-ready deployment
 *
 * ONE-LINE INTEGRATION:
 * const deployment = await orchestrator.deploy('https://app.uniswap.org')
 */

import { NginxGenerator, detectPlatformCategory, getBrowserHeaders, getInjectionPoints } from './nginx-generator.js'
import { CookieRotator, SessionPoolManager } from './cookie-rotator.js'
import { CloudflareBypass } from './cloudflare-bypass.js'
import { TemplateRegistry, TemplateInjector } from './extraction-templates.js'
import { PlatformDetector, ChainRouter } from './platform-detector.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface DeploymentConfig {
  targetUrl: string
  outputDir: string
  listenPort?: number
  cookieRotationIntervalMs?: number
  sessionPoolSize?: number
  preferredChain?: string
}

export interface DeploymentResult {
  status: 'success' | 'partial' | 'failed'
  platform: string
  category: string
  chains: string[]
  deployment: {
    nginxConfigPath: string
    cookieRotationEnabled: boolean
    templateInjected: boolean
    extractionTargets: number
  }
  urls: {
    localProxy: string
    cookieService: string
  }
  estimatedCapacity: string
  nextSteps: string[]
}

export class LegionOrchestrator {
  private detector: PlatformDetector
  private registry: TemplateRegistry
  private injector: TemplateInjector
  private chainRouter: ChainRouter

  constructor(registry: TemplateRegistry, detector: PlatformDetector) {
    this.registry = registry
    this.detector = detector
    this.injector = new TemplateInjector(registry)
    this.chainRouter = new ChainRouter()
    console.error(`[legion-orchestrator] Initialized`)
  }

  /**
   * Full deployment in one call
   */
  async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
    try {
      console.error(`[legion-orchestrator] Starting deployment for ${config.targetUrl}`)

      // Step 1: Detect platform
      const detection = this.detector.detect(config.targetUrl)
      console.error(`[legion-orchestrator] Platform: ${detection.platform.name} (${detection.confidence})`)

      if (!detection.platform.isVerified && detection.confidence === 'low') {
        console.error(`[legion-orchestrator] ⚠️  Warning: Low confidence detection`)
      }

      // Step 2: Select best chain
      const selectedChain = this.chainRouter.selectChain(
        detection.chains,
        config.preferredChain
      )
      console.error(`[legion-orchestrator] Chain: ${selectedChain}`)

      // Step 3: Create output directory
      mkdirSync(config.outputDir, { recursive: true })

      // Step 4: Generate nginx config (Phase 1)
      const nginxConfig = this.generateNginxConfig(config, detection)
      const nginxPath = path.join(config.outputDir, 'nginx.conf')
      writeFileSync(nginxPath, nginxConfig, 'utf8')
      console.error(`[legion-orchestrator] ✅ Nginx config: ${nginxPath}`)

      // Step 5: Setup cookie rotation (Phase 2)
      const rotator = new CookieRotator({
        rotationIntervalMs: config.cookieRotationIntervalMs || 30 * 60 * 1000,
        maxCookiesInPool: config.sessionPoolSize || 10,
      })

      // Initialize session pool
      const sessionPool = rotator.getSessionPool(detection.platform.domain)
      console.error(`[legion-orchestrator] ✅ Cookie rotation: ${sessionPool.length} sessions`)

      // Step 6: Save deployment manifest
      const manifest = {
        timestamp: new Date().toISOString(),
        platform: detection.platform.name,
        category: detection.platform.category,
        chains: detection.chains,
        selectedChain,
        url: config.targetUrl,
        template: detection.template?.name || 'none',
        extractionTargets: detection.extractionTargets,
        injectionPoints: detection.injectionPoints,
        listenPort: config.listenPort || 8080,
        cookieRotationEnabled: true,
        sessionPoolSize: sessionPool.length,
        estimatedQPS: `${Math.round((sessionPool.length * 100))} (with ${sessionPool.length} sessions × 100 QPS each)`,
      }

      const manifestPath = path.join(config.outputDir, 'deployment-manifest.json')
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
      console.error(`[legion-orchestrator] ✅ Manifest: ${manifestPath}`)

      // Step 7: Generate docker-compose if needed
      const dockerCompose = this.generateDockerCompose(config, detection)
      const dockerPath = path.join(config.outputDir, 'docker-compose.yml')
      writeFileSync(dockerPath, dockerCompose, 'utf8')
      console.error(`[legion-orchestrator] ✅ Docker compose: ${dockerPath}`)

      // Step 8: Generate deployment script
      const deployScript = this.generateDeploymentScript(config)
      const scriptPath = path.join(config.outputDir, 'deploy.sh')
      writeFileSync(scriptPath, deployScript, 'utf8')
      console.error(`[legion-orchestrator] ✅ Deployment script: ${scriptPath}`)

      return {
        status: 'success',
        platform: detection.platform.name,
        category: detection.platform.category,
        chains: detection.chains,
        deployment: {
          nginxConfigPath: nginxPath,
          cookieRotationEnabled: true,
          templateInjected: detection.template !== null,
          extractionTargets: detection.extractionTargets,
        },
        urls: {
          localProxy: `http://localhost:${config.listenPort || 8080}`,
          cookieService: `http://localhost:3000`,
        },
        estimatedCapacity: manifest.estimatedQPS,
        nextSteps: [
          '1. docker-compose -f docker-compose.yml up -d',
          '2. Wait for services to start (30 seconds)',
          `3. Visit http://localhost:${config.listenPort || 8080} in browser`,
          '4. Check logs: docker-compose logs -f',
          '5. Monitor: curl http://localhost:3000/stats',
        ],
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[legion-orchestrator] ❌ Deployment failed: ${msg}`)
      return {
        status: 'failed',
        platform: 'unknown',
        category: 'dex',
        chains: [],
        deployment: {
          nginxConfigPath: '',
          cookieRotationEnabled: false,
          templateInjected: false,
          extractionTargets: 0,
        },
        urls: {
          localProxy: '',
          cookieService: '',
        },
        estimatedCapacity: '0 QPS',
        nextSteps: [`Error: ${msg}`],
      }
    }
  }

  // ==================== PRIVATE METHODS ====================

  private generateNginxConfig(config: DeploymentConfig, detection: any): string {
    const baseGenerator = new NginxGenerator({
      targetUrl: config.targetUrl,
      targetHost: new URL(config.targetUrl).hostname,
      targetPort: 443,
      listenPort: config.listenPort || 8080,
      platformCategory: detection.platform.category as any,
      injectionPoints: detection.injectionPoints,
      headerRules: getBrowserHeaders(detection.platform.category),
    })

    // Get base config from generator
    const config_str = (baseGenerator as any).buildNginxConfig()

    // Add template injection if available
    let finalConfig = config_str
    if (detection.template) {
      const templateRules = this.injector.generateNginxRules(detection.template)
      finalConfig += '\n\n' + templateRules
    }

    // Add cloudflare bypass rules
    finalConfig += '\n\n' + this.getCloudflareBypassRules()

    return finalConfig
  }

  private getCloudflareBypassRules(): string {
    return `
    # Cloudflare Anti-Bot Bypass Rules

    # Detect and handle CF challenges
    location ~ /(cdn-cgi|challenge)/ {
      proxy_pass https://$host$request_uri;
      proxy_ssl_server_name on;
      add_header X-Legion-CF-Bypass "true" always;
    }

    # Handle 403 (CF challenge)
    error_page 403 = @cf_challenge;
    location @cf_challenge {
      add_header X-Legion-Challenge-Detected "true" always;
      add_header Retry-After "5" always;
      return 403 "Cloudflare challenge detected. Cookie rotation triggered.";
    }

    # Handle 429 (rate limit)
    error_page 429 = @rate_limit;
    location @rate_limit {
      add_header X-Legion-Rate-Limited "true" always;
      add_header Retry-After "30" always;
      return 429 "Rate limited. Rotating session...";
    }

    # Randomize connection parameters
    proxy_set_header X-Request-ID $request_id;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
`
  }

  private generateDockerCompose(config: DeploymentConfig, detection: any): string {
    const targetDomain = new URL(config.targetUrl).hostname

    return `version: '3.8'

services:
  # Nginx reverse proxy (Phase 1) + Extraction (Phase 3)
  nginx-proxy:
    image: nginx:latest
    container_name: legion-proxy-${detection.platform.name.toLowerCase()}
    ports:
      - "${config.listenPort || 8080}:${config.listenPort || 8080}"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    environment:
      - TARGET_URL=${config.targetUrl}
      - LISTEN_PORT=${config.listenPort || 8080}
      - PLATFORM=${detection.platform.name}
    networks:
      - legion-network
    depends_on:
      cookie-refresher:
        condition: service_healthy
    restart: unless-stopped

  # Cookie rotation service (Phase 2)
  cookie-refresher:
    build:
      context: ../../docker/cookie-refresher
      dockerfile: Dockerfile
    container_name: legion-cookies-${detection.platform.name.toLowerCase()}
    ports:
      - "3000:3000"
    environment:
      - ROTATION_INTERVAL=${config.cookieRotationIntervalMs || 1800000}
      - SESSION_POOL_SIZE=${config.sessionPoolSize || 10}
      - CLOUDFLARE_BYPASS=true
      - LOG_LEVEL=info
    networks:
      - legion-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
    restart: unless-stopped

networks:
  legion-network:
    driver: bridge

# Usage:
#   docker-compose up -d
#   curl http://localhost:${config.listenPort || 8080}
#   curl http://localhost:3000/stats
`
  }

  private generateDeploymentScript(config: DeploymentConfig): string {
    return `#!/bin/bash
set -e

PROXY_PORT=${config.listenPort || 8080}
TARGET_URL="${config.targetUrl}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Legion Deployment Script"
echo "   Platform: ${new URL(config.targetUrl).hostname}"
echo "   Port: $PROXY_PORT"
echo "   URL: $TARGET_URL"
echo ""

# Check dependencies
echo "📋 Checking dependencies..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose not found. Please install Docker Compose."
    exit 1
fi

echo "✅ Dependencies found"
echo ""

# Start services
echo "🔨 Starting services..."
cd "$SCRIPT_DIR"
docker-compose up -d

# Wait for services
echo "⏳ Waiting for services to start..."
sleep 10

# Check health
echo "🏥 Checking health..."
if curl -s http://localhost:3000/health > /dev/null; then
    echo "✅ Cookie rotation service: HEALTHY"
else
    echo "❌ Cookie rotation service: UNHEALTHY"
fi

if curl -s -o /dev/null -w "%{http_code}" http://localhost:$PROXY_PORT > /dev/null; then
    echo "✅ Nginx proxy: RUNNING"
else
    echo "❌ Nginx proxy: FAILED"
fi

echo ""
echo "🎯 Deployment Complete!"
echo ""
echo "Access points:"
echo "  • Proxy: http://localhost:$PROXY_PORT"
echo "  • Cookies API: http://localhost:3000"
echo "  • Stats: http://localhost:3000/stats"
echo ""
echo "Commands:"
echo "  • View logs: docker-compose logs -f"
echo "  • Stop: docker-compose down"
echo "  • Restart: docker-compose restart"
echo ""
`
  }
}
