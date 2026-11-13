import os from 'node:os'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// The launcher gives each stack its runtime config in the environment; the
// file in public/ is the last started stack's and only the fallback.
function runtimeConfigFromEnv(): Plugin {
  const config = process.env.AIMPARENCY_RUNTIME_CONFIG
  const answer: Connect.NextHandleFunction = (req, res, next) => {
    if (!config || req.url?.split('?')[0] !== '/runtime-config.json') return next()
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(config)
  }
  return {
    name: 'aimparency-runtime-config',
    configureServer: (server) => { server.middlewares.use(answer) },
    configurePreviewServer: (server) => { server.middlewares.use(answer) },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const PORT = parseInt(process.env.PORT_FRONTEND || '4000')

  // When hosting over the network (pnpm host) BIND_HOST is set to the chosen
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
      runtimeConfigFromEnv(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        backend: fileURLToPath(new URL('../../packages/backend/src/index.ts', import.meta.url)),
      },
    },
    // Plain `pnpm dev` leaves BIND_HOST unset -> localhost only. `pnpm
    // dev:host` sets BIND_HOST so the dev server (with HMR) is exposed too.
    server: {
      host: bindHost,
      port: PORT,
      strictPort: true,
      allowedHosts,
    },
    // `vite preview` serves the production build (no dev tools / HMR) — used by
    // `pnpm host` to expose the app over the network, bound to BIND_HOST.
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
      'process.env.AIMPARENCY_DIR_NAME': JSON.stringify(process.env.AIMPARENCY_DIR_NAME || '.bowman'),
    }
  }
})
