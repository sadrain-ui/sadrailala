import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const optionalPeerStub = path.join(__dirname, 'src/shims/optional-peer-stub.cjs')
const isProductionBuild = process.env.NODE_ENV === 'production'

/** Production API plane — bake public client origin when only server ingress vars are set at build time. */
function pickLegionEngineApiOrigin() {
  const raw =
    process.env.NEXT_PUBLIC_LEGION_ENGINE_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    process.env.LEGION_ENGINE_API_URL?.trim() ||
    process.env.PRODUCTION_INGRESS_ORIGIN?.trim() ||
    process.env.PUBLIC_INGRESS_ORIGIN?.trim() ||
    ''
  return raw.replace(/\/+$/, '')
}

/**
 * VercelProductionManifest — Lethal Deployment environment plane.
 * Configure in Vercel → Settings → Environment Variables (Production). Do not embed service-role secrets here.
 *
 * Server-only: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (optional alias), RPC_ETHEREUM_PRIVATE,
 *   FLASHBOTS_RELAY_URL, JITO_SETTLEMENT_LANE_URL, SIGNATURE_ANCHOR_SIM_MODE
 * Client + server: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_RPC_URL,
 *   NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, …
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Security Posture: inline production plane for `!process.env.PROD` guards (client + server).
   * Dev: PROD is unset; production build: PROD is `1`.
   */
  env: {
    PROD: isProductionBuild ? '1' : '',
    /** Client weld + cross-origin fetch — mirrors `resolve-legion-api-origin.ts` at compile time. */
    NEXT_PUBLIC_LEGION_ENGINE_API_URL: pickLegionEngineApiOrigin(),
  },
  /** Asset + bundle optimization — active for static production trees (Vercel/Railway sibling deploy). */
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
  compiler: {
    removeConsole: isProductionBuild ? { exclude: ['error', 'warn'] } : false,
  },
  productionBrowserSourceMaps: false,
  /** Build-Time Optimization — production builds do not fail on lint or type diagnostics. */
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  poweredByHeader: false,
  /** HTTP response compression for static + SSR assets. */
  compress: true,
  /**
   * Deployment Sanity — no global Content-Security-Policy is defined in this manifest.
   * Recursive Predator discovery (stETH / JitoSOL + RPC fetch) is therefore not blocked by this layer.
   * If the host injects CSP, align `connect-src` with `NEXT_PUBLIC_RPC_URL`, Solana RPC, and Supabase.
   */
  transpilePackages: [
    '@legion/core',
    '@ledgerhq/connect-kit',
    '@trezor/connect-web',
    '@reown/appkit',
    '@reown/appkit-adapter-wagmi',
    '@reown/appkit-adapter-solana',
    '@reown/appkit-adapter-bitcoin',
  ],
  experimental: {
    instrumentationHook: true,
    outputFileTracingRoot: repoRoot,
    optimizePackageImports: ['@reown/appkit/react', '@tanstack/react-query'],
    serverComponentsExternalPackages: ['ox', 'viem'],
  },
  webpack: (config, { webpack }) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@metamask/connect-evm': false,
      accounts: false,
    }

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    }

    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^@react-native-async-storage\/async-storage$/,
        optionalPeerStub,
      ),
      new webpack.NormalModuleReplacementPlugin(/^pino-pretty$/, optionalPeerStub),
    )

    config.ignoreWarnings = [
      { module: /@metamask\/sdk/ },
      { module: /@walletconnect\/logger/ },
      { module: /pino\/lib/ },
    ]

    return config
  },
}

export default nextConfig
