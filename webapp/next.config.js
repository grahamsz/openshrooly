const { createHash } = require('crypto')

// Next's entry-loader identifiers contain absolute checkout paths. Normalize
// those paths before assigning IDs so static chunks are reproducible.
class StableProjectModuleIdsPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('StableProjectModuleIdsPlugin', (compilation) => {
      compilation.hooks.moduleIds.tap(
        { name: 'StableProjectModuleIdsPlugin', stage: -1000 },
        (modules) => {
          const encodedProjectRoot = encodeURIComponent(__dirname)
          const assignedIds = new Map()

          for (const module of modules) {
            if (compilation.chunkGraph.getModuleId(module) !== null) {
              continue
            }

            const identifier = module.identifier()
            const hasPathDependentLoader =
              identifier.includes('next-flight-client-entry-loader.js?') ||
              identifier.includes('next-client-pages-loader.js?absolutePagePath=')
            if (!hasPathDependentLoader) {
              continue
            }

            const normalizedIdentifier = identifier
              .split(encodedProjectRoot).join('<project>')
              .split(__dirname).join('<project>')

            if (normalizedIdentifier === identifier) {
              continue
            }

            const moduleId = `project-${createHash('sha256')
              .update(normalizedIdentifier)
              .digest('hex')
              .slice(0, 12)}`
            const existingIdentifier = assignedIds.get(moduleId)
            if (
              existingIdentifier !== undefined &&
              existingIdentifier !== normalizedIdentifier
            ) {
              throw new Error(`Stable module ID collision: ${moduleId}`)
            }

            assignedIds.set(moduleId, normalizedIdentifier)
            compilation.chunkGraph.setModuleId(module, moduleId)
          }
        },
      )
    })
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  outputFileTracingRoot: __dirname,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    config.context = __dirname
    config.plugins.push(new StableProjectModuleIdsPlugin())
    return config
  },
  generateBuildId: async () => {
    if (process.env.NEXT_BUILD_ID && process.env.NEXT_BUILD_ID.length > 0) {
      return process.env.NEXT_BUILD_ID;
    }
    return 'openshrooly';
  },
}

module.exports = nextConfig
