/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: ['@deepgram/sdk', '@google/generative-ai', 'dotenv']
  },
  // Ensure server binds to all interfaces
  async headers() {
    return [];
  }
};

module.exports = nextConfig;