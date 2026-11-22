import { createApp } from 'vue'
import { createPinia } from 'pinia'

import './style.css'
import { loadRuntimeConfig } from './utils/runtime-config'
import { useToastStore } from './stores/toast'
import { blockBackspaceNavigation } from './utils/backspace-navigation'

await loadRuntimeConfig()

// Registered before any component, so no dialog's capture handler can hide Backspace from it.
blockBackspaceNavigation()

const { default: App } = await import('./App.vue')

const app = createApp(App)

app.use(createPinia())

// Last line of defense: an error nobody caught still reaches the human.
const toastStore = useToastStore()
app.config.errorHandler = error => toastStore.error('Unexpected error', error)
window.addEventListener('unhandledrejection', event => toastStore.error('Unexpected error', event.reason))

app.mount('#app')
