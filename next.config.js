/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  poweredByHeader: false,
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: ['@deepgram/sdk', '@google/generative-ai', 'dotenv']
  }
};

module.exports = nextConfig;