import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const PORT = parseInt(process.env.PORT_FRONTEND || '4000')

  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      vue(),
      vueDevTools(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      },
    },
    server: {
      port: PORT,
      strictPort: true
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
