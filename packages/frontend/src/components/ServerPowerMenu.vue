<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Download, Power, RotateCw } from 'lucide-vue-next'
import { trpc } from '../trpc'
import { useToastStore } from '../stores/toast'

// Restart the server, or pull main and restart it. Shown where something starts
// it again: a supervisor, or the local stack itself (pnpm dev).
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const close = (event: Event) => {
  if (!open.value) return
  if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.value?.contains(event.target as Node)) open.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', close)
  document.addEventListener('keydown', close)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', close)
  document.removeEventListener('keydown', close)
})

// The server stops and is started again; once it answers, the page reloads
// (a pull may have brought a new UI).
const restarting = ref('')
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const waitForServer = async () => {
  await sleep(2000)
  for (let attempt = 0; attempt < 300; attempt++) {
    const up = await fetch(window.location.origin + '/', { cache: 'no-store' }).then(response => response.ok, () => false)
    if (up) return
    await sleep(1000)
  }
}
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const restart = async (pull: boolean) => {
  open.value = false
  const question = pull
    ? 'Pull main and restart the server? A built server builds first, which takes a few minutes; everyone is disconnected for a moment at the restart.'
    : 'Restart the server? Everyone is disconnected for a moment.'
  if (!window.confirm(question)) return
  restarting.value = pull ? 'Pulling…' : 'Restarting…'
  try {
    if (pull) {
      const { commits, before, after } = await trpc.auth.updateServer.mutate()
      useToastStore().info(commits.length > 0 ? `${plural(commits.length, 'new commit', 'new commits')}: ${before} → ${after}. Restarting…` : 'Already up to date. Restarting…')
    } else {
      await trpc.auth.restartServer.mutate()
    }
    restarting.value = 'Restarting…'
    await waitForServer()
    window.location.reload()
  } catch (caught) {
    restarting.value = ''
    useToastStore().error('Not restarted', caught)
  }
}
</script>

<template>
  <div ref="root" class="server-power-menu">
    <div class="menu-anchor">
      <button
        class="icon-btn"
        :class="{ on: open }"
        :aria-expanded="open"
        aria-haspopup="menu"
        :disabled="restarting !== ''"
        :title="restarting || 'Restart the server'"
        @click="open = !open"
      ><Power /></button>
      <div v-if="open" class="menu" role="menu">
        <div class="menu-label">Server</div>
        <button class="menu-item" role="menuitem" @click="restart(false)"><RotateCw /> Restart</button>
        <button class="menu-item" role="menuitem" title="git pull origin main, install, build if the server runs built, then restart" @click="restart(true)"><Download /> Pull main and restart</button>
      </div>
    </div>
    <span v-if="restarting" class="restarting">{{ restarting }}</span>
  </div>
</template>

<style scoped>
.server-power-menu {
  display: flex;
  align-items: center;
  gap: var(--gap-s);

  .restarting { color: var(--text-muted); white-space: nowrap; }
}
</style>
