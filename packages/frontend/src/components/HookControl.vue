<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import HookLoopsModal from './HookLoopsModal.vue'
import { useProjectStore } from '../stores/project-store'
import { useToastStore } from '../stores/toast'
import { trpc } from '../trpc'
import { HOOK_AGENTS, NO_HOOK_STATE, type HookAgent, type HookState } from '../utils/hook-loops'

// The agents' Stop continuation hook of the space's repository: off, or on with
// one of its loops (what it tells the agent when it tries to stop).

const projectStore = useProjectStore()
const state = ref<HookState>(NO_HOOK_STATE)
const menuOpen = ref(false)
const manageOpen = ref(false)
const root = ref<HTMLElement | null>(null)

const refresh = async () => {
  const projectPath = projectStore.projectPath
  let next = NO_HOOK_STATE
  try {
    if (projectPath) next = await trpc.continueHook.get.query({ graph: projectPath })
  } catch {
    // stays off
  }
  if (projectPath === projectStore.projectPath) state.value = next
}
watch(() => projectStore.projectPath, refresh, { immediate: true })

// "none", "default" or a saved loop's slug.
const selected = computed(() => !state.value.enabled ? 'none' : state.value.loop ?? 'default')
const label = computed(() => {
  if (selected.value === 'none') return 'Hook off'
  return `Hook: ${state.value.loops.find(loop => loop.slug === selected.value)?.title ?? 'Default'}`
})

const select = async (loop: string, agent?: HookAgent) => {
  menuOpen.value = false
  try {
    state.value = await trpc.continueHook.select.mutate({ graph: projectStore.projectPath, loop, agent })
  } catch (failure) {
    useToastStore().error('Could not change the hook', failure)
  }
}

const openMenu = () => {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) void refresh()
}
const openManage = () => {
  menuOpen.value = false
  manageOpen.value = true
}

const onDocumentClick = (event: MouseEvent) => {
  if (menuOpen.value && !root.value?.contains(event.target as Node)) menuOpen.value = false
}
const onKeydown = (event: KeyboardEvent) => {
  if (menuOpen.value && event.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="hook-control menu-anchor">
    <button
      class="icon-btn text"
      :class="{ on: selected !== 'none' }"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      title="The Stop hook of your coding agent (Claude Code, Codex) in this repository: when the agent finishes, the chosen loop sends it back to work. Applies from its next stop, only in this clone."
      @click="openMenu"
    >{{ label }} <ChevronDown /></button>
    <div v-if="menuOpen" class="menu" role="menu">
      <button class="menu-item" role="menuitemradio" :aria-checked="selected === 'none'" @click="select('none')">
        <Check :class="{ hidden: selected !== 'none' }" /> Off
      </button>
      <template v-if="state.installed">
        <button
          v-for="loop in state.loops"
          :key="loop.slug"
          class="menu-item"
          role="menuitemradio"
          :aria-checked="selected === loop.slug"
          @click="select(loop.slug)"
        ><Check :class="{ hidden: selected !== loop.slug }" /> {{ loop.title }}</button>
      </template>
      <template v-else>
        <div class="menu-separator"></div>
        <div class="menu-label">Not installed in this repository. Install for</div>
        <button
          v-for="agent in HOOK_AGENTS"
          :key="agent.id"
          class="menu-item"
          role="menuitem"
          @click="select(state.loop ?? 'default', agent.id)"
        >{{ agent.label }}</button>
      </template>
      <div class="menu-separator"></div>
      <button class="menu-item" role="menuitem" @click="openManage">Manage loops…</button>
    </div>
    <HookLoopsModal v-if="manageOpen" :state="state" @update="state = $event" @close="manageOpen = false" />
  </div>
</template>

<style scoped>
.hook-control {
  .hidden { visibility: hidden; }
}
</style>
