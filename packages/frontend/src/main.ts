import { createApp } from 'vue'
import { createPinia } from 'pinia'

import './style.css'
import { loadRuntimeConfig } from './utils/runtime-config'

await loadRuntimeConfig()

const { default: App } = await import('./App.vue')

const app = createApp(App)

app.use(createPinia())

app.mount('#app')
