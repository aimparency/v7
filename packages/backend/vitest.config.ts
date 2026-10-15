import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    globalSetup: ['./vitest.global-setup.ts']
  }
})
