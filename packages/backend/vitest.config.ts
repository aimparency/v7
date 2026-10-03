import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve the shared workspace to its sources, so tests never run against a stale dist.
  ssr: { resolve: { conditions: ['aimparency-source'] } },
  test: {
    exclude: ['dist/**', 'node_modules/**']
  }
})
