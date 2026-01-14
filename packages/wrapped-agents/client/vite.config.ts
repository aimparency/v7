import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.PORT_BROKER_WS': JSON.stringify(process.env.PORT_BROKER_WS || '5001'),
  },
  server: {
    port: 5002, // Unique port for client dev
    proxy: {
      '/socket.io': {
        target: 'http://localhost:7000', // Default process start
        ws: true
      }
    }
  }
})