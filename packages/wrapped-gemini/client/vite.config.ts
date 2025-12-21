import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, '../../../ports.env') })

export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.PORT_BROKER_WS': JSON.stringify(process.env.PORT_BROKER_WS || '5001'),
  },
  server: {
    port: 5002, // Unique port for client dev
    proxy: {
      '/socket.io': {
        target: 'http://localhost:6000', // Default process start
        ws: true
      }
    }
  }
})