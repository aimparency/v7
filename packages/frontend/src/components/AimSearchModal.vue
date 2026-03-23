<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useUIStore, type AimPath } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { trpc } from '../trpc'
import type { Aim } from 'shared'
import type { AimSearchAdditionalOption } from '../stores/ui/aim-search-types'
import AimSearchPicker from './AimSearchPicker.vue'

type AimSearchModalPayload =
  | { type: 'aim'; data: Aim }
  | { type: 'path'; data: AimPath }
  | { type: 'option'; data: AimSearchAdditionalOption }

const uiStore = useUIStore()
const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()

const emit = defineEmits<{
  (e: 'select', payload: AimSearchModalPayload): void
  (e: 'close'): void
}>()

const pickerRef = ref<InstanceType<typeof AimSearchPicker>>()
const selectedIndex = ref(0)
const resultsListRef = ref<HTMLDivElement>()
const loading = ref(false)

const pathSelectionMode = ref(false)
const availablePaths = ref<(AimPath & { label: string })[]>([])
const selectedAimText = ref('')

const blockLeakage = (event: KeyboardEvent) => {
  const isInputTarget = event.target instanceof HTMLInputElement
  const isNavKey = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab', 'j', 'k'].includes(event.key)

  if (isInputTarget && !isNavKey) {
    event.stopPropagation()
    return
  }

  if (!pathSelectionMode.value) {
    return
  }

  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'j', 'k'].includes(event.key)) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const listLength = availablePaths.value.length
  if (event.key === 'Escape') {
    pathSelectionMode.value = false
    selectedIndex.value = 0
    nextTick(() => pickerRef.value?.focusInput())
    return
  }

  if (listLength === 0) return

  if (event.key === 'ArrowDown' || event.key === 'j') {
    selectedIndex.value = Math.min(selectedIndex.value + 1, listLength - 1)
    scrollToPath(selectedIndex.value)
    return
  }

  if (event.key === 'ArrowUp' || event.key === 'k') {
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollToPath(selectedIndex.value)
    return
  }

  if (event.key === 'Enter') {
    const path = availablePaths.value[selectedIndex.value]
    if (path) {
      selectPath(path)
    }
  }
}

const scrollToPath = (index: number) => {
  nextTick(() => {
    const item = resultsListRef.value?.querySelectorAll<HTMLElement>('.result-item')[index]
    item?.scrollIntoView({ block: 'nearest' })
  })
}

const selectAim = async (aim: Aim) => {
  if (modalStore.aimSearchMode === 'pick') {
    try {
      const fullAim = await trpc.aim.get.query({ projectPath: projectStore.projectPath, aimId: aim.id })
      emit('select', { type: 'aim', data: fullAim })
    } catch (error) {
      console.error('Failed to load aim for selection', error)
      emit('select', { type: 'aim', data: aim })
    }
    close()
    return
  }

  if (projectStore.currentView === 'graph') {
    try {
      const fullAim = await trpc.aim.get.query({ projectPath: projectStore.projectPath, aimId: aim.id })
      emit('select', { type: 'aim', data: fullAim })
    } catch (error) {
      console.error('Failed to load aim for graph navigation', error)
      emit('select', { type: 'aim', data: aim })
    }
    close()
    return
  }

  loading.value = true
  try {
    const paths = await uiStore.prepareNavigation(aim.id)

    if (paths.length === 0) {
      close()
    } else if (paths.length === 1 && paths[0]) {
      emit('select', { type: 'path', data: paths[0] })
      close()
    } else {
      selectedAimText.value = aim.text.length > 50 ? `${aim.text.substring(0, 50)}...` : aim.text

      availablePaths.value = await Promise.all(paths.map(async path => {
        let label = ''
        if (path.phaseId) {
          let phase = dataStore.phases[path.phaseId]
          if (!phase) {
            try {
              phase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId: path.phaseId })
            } catch {}
          }
          label = phase ? phase.name : 'Unknown Phase'
        } else {
          label = 'Floating'
        }

        const trail = path.aims.slice(0, -1).map(step => step.text).join(' > ')
        if (trail) {
          label += ` > ${trail}`
        }

        return { ...path, label }
      }))

      pathSelectionMode.value = true
      selectedIndex.value = 0
      scrollToPath(0)
    }
  } catch (error) {
    console.error('Error preparing navigation:', error)
  } finally {
    loading.value = false
  }
}

const handlePickerActivate = (payload: { type: 'aim'; data: Aim } | { type: 'option'; data: AimSearchAdditionalOption }) => {
  if (payload.type === 'option') {
    emit('select', payload)
    close()
    return
  }

  void selectAim(payload.data)
}

const selectPath = (path: AimPath) => {
  emit('select', { type: 'path', data: path })
  close()
}

const close = () => {
  pathSelectionMode.value = false
  availablePaths.value = []
  selectedAimText.value = ''
  selectedIndex.value = 0
  emit('close')
}

onMounted(async () => {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }

  window.addEventListener('keydown', blockLeakage, true)

  if (modalStore.aimSearchInitialAimId && modalStore.aimSearchShowParentPaths) {
    const aimId = modalStore.aimSearchInitialAimId
    loading.value = true
    try {
      const aim = await trpc.aim.get.query({ projectPath: projectStore.projectPath, aimId })

      if (!aim.supportedAims || aim.supportedAims.length === 0) {
        loading.value = false
        nextTick(() => pickerRef.value?.focusInput())
        return
      }

      const allPaths: AimPath[] = []
      for (const parentId of aim.supportedAims) {
        const paths = await uiStore.prepareNavigation(parentId)
        allPaths.push(...paths)
      }

      selectedAimText.value = `Parent aims of: ${aim.text.length > 40 ? `${aim.text.substring(0, 40)}...` : aim.text}`
      availablePaths.value = await Promise.all(allPaths.map(async path => {
        let label = ''
        if (path.phaseId) {
          let phase = dataStore.phases[path.phaseId]
          if (!phase) {
            try {
              phase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId: path.phaseId })
            } catch {}
          }
          label = phase ? phase.name : 'Unknown Phase'
        } else {
          label = 'Floating'
        }

        const trail = path.aims.map(step => step.text).join(' > ')
        if (trail) {
          label += ` > ${trail}`
        }

        return { ...path, label }
      }))

      if (availablePaths.value.length > 0) {
        pathSelectionMode.value = true
        selectedIndex.value = 0
      }
    } catch (error) {
      console.error('Failed to load parent paths', error)
    } finally {
      loading.value = false
    }
    return
  }

  if (modalStore.aimSearchInitialAimId) {
    loading.value = true
    try {
      const aim = await trpc.aim.get.query({
        projectPath: projectStore.projectPath,
        aimId: modalStore.aimSearchInitialAimId
      })
      await selectAim(aim)
    } catch (error) {
      console.error('Failed to load initial aim', error)
    } finally {
      loading.value = false
    }
    return
  }

  nextTick(() => pickerRef.value?.focusInput())
})

onUnmounted(() => {
  window.removeEventListener('keydown', blockLeakage, true)
})
</script>

<template>
  <div class="search-overlay" @click.self="close">
    <div class="search-modal">
      <div class="modal-header">
        <h3>{{ pathSelectionMode ? 'Select Path' : modalStore.aimSearchTitle }}</h3>
        <div v-if="pathSelectionMode" class="path-selection-header">
          {{ selectedAimText }}
        </div>
      </div>

      <div v-if="!pathSelectionMode">
        <AimSearchPicker
          ref="pickerRef"
          :placeholder="modalStore.aimSearchPlaceholder"
          :show-filters="modalStore.aimSearchShowFilters"
          :autofocus="true"
          :additional-options="modalStore.aimSearchAdditionalOptions"
          @activate="handlePickerActivate"
          @escape="close"
        />
      </div>

      <div v-else ref="resultsListRef" class="results-list">
        <div
          v-for="(path, index) in availablePaths"
          :key="`${path.phaseId ?? 'floating'}-${index}`"
          class="result-item"
          :class="{ selected: index === selectedIndex }"
          @click="selectPath(path)"
          @mouseenter="selectedIndex = index"
        >
          <div class="result-text">
            <span class="aim-text">{{ path.label }}</span>
          </div>
        </div>
      </div>

      <div v-if="loading" class="loading-state">...</div>
    </div>
  </div>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 300;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 15vh;
}

.search-modal {
  width: 36rem;
  max-width: 92vw;
  max-height: 90vh;
  background: #252526;
  border: 1px solid #454545;
  border-radius: 0.375rem;
  box-shadow: 0 0.25rem 1.25rem rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  padding: 0.9rem 1rem 0.75rem;
  border-bottom: 1px solid #333;
  background: #191919;
}

.modal-header h3 {
  margin: 0;
  font-size: 0.95rem;
}

.path-selection-header {
  margin-top: 0.45rem;
  color: #b9b9b9;
  font-size: 0.85rem;
}

.results-list {
  overflow-y: auto;
  max-height: 22rem;
}

.result-item {
  padding: 0.8rem 1rem;
  border-bottom: 1px solid #2d2d2d;
  cursor: pointer;
}

.result-item.selected {
  background: #094771;
}

.result-text {
  display: flex;
  gap: 1rem;
}

.aim-text {
  color: #f0f0f0;
}

.loading-state {
  padding: 0.75rem 1rem 1rem;
  color: #888;
}
</style>
