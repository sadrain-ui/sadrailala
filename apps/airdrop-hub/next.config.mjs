/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@tonconnect/ui', '@tonconnect/ui-react', '@tonconnect/sdk'],
}

export default nextConfig
