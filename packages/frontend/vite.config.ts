import os from 'node:os'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const PORT = parseInt(process.env.PORT_FRONTEND || '4000')

  // When hosting over the network (npm run host) BIND_HOST is set to the chosen
  // interface (e.g. the Tailscale IP). Hostnames used to reach the preview must
  // be allow-listed; the machine's own hostname (e.g. "l13y") is included
  // automatically, plus anything in PREVIEW_ALLOWED_HOSTS (comma-separated).
  const bindHost = process.env.BIND_HOST || undefined
  const allowedHosts = [
    os.hostname(),
    ...(process.env.PREVIEW_ALLOWED_HOSTS || '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  ]

  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      vue(),
      vueDevTools(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        shared: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
        backend: fileURLToPath(new URL('../../packages/backend/src/index.ts', import.meta.url)),
      },
    },
    // Plain `npm run dev` leaves BIND_HOST unset -> localhost only. `npm run
    // dev:host` sets BIND_HOST so the dev server (with HMR) is exposed too.
    server: {
      host: bindHost,
      port: PORT,
      strictPort: true,
      allowedHosts,
    },
    // `vite preview` serves the production build (no dev tools / HMR) — used by
    // `npm run host` to expose the app over the network, bound to BIND_HOST.
    preview: {
      host: bindHost,
      port: PORT,
      strictPort: true,
      allowedHosts,
    },
    define: {
      'process.env.PORT_FRONTEND': JSON.stringify(process.env.PORT_FRONTEND || '4000'),
      'process.env.PORT_BACKEND_HTTP': JSON.stringify(process.env.PORT_BACKEND_HTTP || '3000'),
      'process.env.PORT_BACKEND_WS': JSON.stringify(process.env.PORT_BACKEND_WS || '3001'),
      'process.env.PORT_BROKER_HTTP': JSON.stringify(process.env.PORT_BROKER_HTTP || '5000'),
      'process.env.PORT_BROKER_WS': JSON.stringify(process.env.PORT_BROKER_WS || '5001'),
      'process.env.PORT_PROCESS_START': JSON.stringify(process.env.PORT_PROCESS_START || '7000'),
      'process.env.AIMPARENCY_DIR_NAME': JSON.stringify(process.env.AIMPARENCY_DIR_NAME),
    }
  }
})
