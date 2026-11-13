import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    globalSetup: ['./vitest.global-setup.ts'],
    // Tests never read or write the real server directory of this machine;
    // tests of accounts and graphs point this at their own directory.
    env: { AIMPARENCY_SERVER_DIR: path.join(os.tmpdir(), `aimparency-test-server-${process.pid}`) }
  }
})
