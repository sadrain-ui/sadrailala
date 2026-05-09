import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootEnvPath = path.resolve(__dirname, '../..', '.env')

if (fs.existsSync(rootEnvPath)) {
  const rootEnvRaw = fs.readFileSync(rootEnvPath, 'utf8')
  for (const line of rootEnvRaw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    if (!key || process.env[key] != null) continue
    process.env[key] = trimmed.slice(idx + 1)
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    PROD: process.env.NODE_ENV === 'production' ? '1' : '',
  },
  eslint: { ignoreDuringBuilds: true },
  /** Surface compile errors for Command Center /dashboard during `next build`. */
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
  transpilePackages: ['@legion/core'],
}

export default nextConfig
