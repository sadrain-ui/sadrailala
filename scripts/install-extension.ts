/**
 * Build Legion browser collector extension for authorized red-team ops.
 *
 * Usage:
 *   pnpm install-extension --backend https://legionapi.example.com
 *   pnpm install-extension --zip   # writes dist/legion-collector.zip
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SRC = path.join(__dirname, 'extension', 'legion-collector')
const OUT = path.join(REPO_ROOT, 'dist', 'legion-collector')

function parseArgs(argv: string[]): { backend: string; zip: boolean } {
  let backend =
    process.env['BACKEND_URL']?.trim() || 'http://127.0.0.1:3000'
  let zip = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--backend' && argv[i + 1]) {
      backend = argv[++i]!.replace(/\/$/, '')
    } else if (argv[i] === '--zip') {
      zip = true
    }
  }
  return { backend, zip }
}

async function buildExtension(backend: string): Promise<string> {
  await mkdir(OUT, { recursive: true })
  const apiKey = process.env['CEX_CREDS_API_KEY']?.trim() ?? ''

  for (const file of ['manifest.json', 'background.js', 'content.js']) {
    let content = await readFile(path.join(SRC, file), 'utf8')
    content = content
      .replaceAll('__LEGION_BACKEND_URL__', backend)
      .replaceAll('__LEGION_CREDS_API_KEY__', apiKey)
    await writeFile(path.join(OUT, file), content, 'utf8')
  }

  return OUT
}

function zipDir(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zipPath = path.join(REPO_ROOT, 'dist', 'legion-collector.zip')
    const child = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path "${dir}\\*" -DestinationPath "${zipPath}" -Force`,
      ],
      { stdio: 'inherit', shell: true },
    )
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`zip exited ${String(code)}`))
    })
  })
}

async function main(): Promise<void> {
  const { backend, zip } = parseArgs(process.argv.slice(2))
  const out = await buildExtension(backend)

  console.log('Legion collector extension built:')
  console.log(`  Directory: ${out}`)
  console.log(`  Backend:   ${backend}/api/v1/creds`)
  console.log('')
  console.log('Chrome: chrome://extensions → Developer mode → Load unpacked → select dist/legion-collector')
  console.log('Firefox: about:debugging → Load Temporary Add-on → manifest.json')

  if (zip) {
    await zipDir(out)
    console.log(`  Zip: ${path.join(REPO_ROOT, 'dist', 'legion-collector.zip')}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
