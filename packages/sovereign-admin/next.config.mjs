/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    PROD: process.env.NODE_ENV === 'production' ? '1' : '',
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  transpilePackages: ['@legion/core'],
}

export default nextConfig
