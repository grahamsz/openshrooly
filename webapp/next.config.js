/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  generateBuildId: async () => {
    if (process.env.NEXT_BUILD_ID && process.env.NEXT_BUILD_ID.length > 0) {
      return process.env.NEXT_BUILD_ID;
    }
    return 'openshrooly';
  },
}

module.exports = nextConfig
