<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, computed } from 'vue'
import { useUIStore, type AimPath } from '../stores/ui'
import { useDataStore } from '../stores/data'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { trpc } from '../trpc'
import type { Aim, SearchAimResult } from 'shared'
import type { AimSearchAdditionalOption } from '../stores/ui/aim-search-types'
import AimSearchPicker, { type AimSearchSelection } from './AimSearchPicker.vue'

type AimSearchModalPayload =
  | { type: 'aim'; data: Aim; keepOpen?: boolean }
  | { type: 'path'; data: AimPath; keepOpen?: boolean }
  | { type: 'option'; data: AimSearchAdditionalOption; keepOpen?: boolean }

const uiStore = useUIStore()
const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()

const emit = defineEmits<{
  (e: 'select', payload: AimSearchModalPayload): void
  (e: 'close'): void
}>()

const pickerRef = ref<InstanceType<typeof AimSearchPicker>>()
const loading = ref(false)

const pathSelectionMode = ref(false)
const availablePaths = ref<(AimPath & { label: string })[]>([])
const selectedAimText = ref('')

const externalResults = computed<SearchAimResult[] | undefined>(() => {
  if (!pathSelectionMode.value) return undefined
  return availablePaths.value.map((path, index) => ({
    id: `path-${index}`,
    text: path.label,
    status: { state: 'open', comment: '', date: Date.now() },
    committedIn: [],
    supportedAims: [],
    supportingConnections: [],
    intrinsicValue: 0,
    cost: 0,
    tags: [],
    archived: false,
    reflections: [],
    loopWeight: 0,
    duration: 1,
    costVariance: 0,
    valueVariance: 0,
    score: index 
  }))
})

// Unified key event handler for modal-level events (Escape)
// Picker handles its own navigation.
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}

const selectAim = async (aim: Aim, keepOpen = false) => {
  if (modalStore.aimSearchMode === 'pick') {
    try {
      const fullAim = await trpc.aim.get.query({ projectPath: projectStore.projectPath, aimId: aim.id })
      emit('select', keepOpen ? { type: 'aim', data: fullAim, keepOpen } : { type: 'aim', data: fullAim })
    } catch (error) {
      console.error('Failed to load aim for selection', error)
      emit('select', keepOpen ? { type: 'aim', data: aim, keepOpen } : { type: 'aim', data: aim })
    }
    if (shouldKeepOpen(keepOpen)) {
      nextTick(() => pickerRef.value?.focusInput())
    } else {
      close()
    }
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

      // Merge paths sharing common suffixes
      const mergedPaths: (AimPath & { isMerged?: boolean })[] = []
      const processed = new Set<number>()

      for (let i = 0; i < paths.length; i++) {
        if (processed.has(i)) continue
        const pathA = paths[i]!
        let matches: number[] = []
        let commonSuffixLen = 0

        for (let j = i + 1; j < paths.length; j++) {
          if (processed.has(j)) continue
          const pathB = paths[j]!
          if (pathA.phaseId !== pathB.phaseId) continue

          let suffixLen = 0
          const lenA = pathA.aims.length
          const lenB = pathB.aims.length
          while (suffixLen < lenA && suffixLen < lenB) {
            if (pathA.aims[lenA - 1 - suffixLen]?.id === pathB.aims[lenB - 1 - suffixLen]?.id) {
              suffixLen++
            } else {
              break
            }
          }

          if (suffixLen > 1) {
            if (matches.length === 0) {
              commonSuffixLen = suffixLen
              matches.push(j)
            } else if (suffixLen === commonSuffixLen) {
              matches.push(j)
            }
          }
        }

        if (matches.length > 0) {
          mergedPaths.push({
            ...pathA,
            aims: pathA.aims.slice(-commonSuffixLen),
            isMerged: true
          })
          processed.add(i)
          matches.forEach(idx => processed.add(idx))
        } else {
          mergedPaths.push(pathA)
          processed.add(i)
        }
      }

      availablePaths.value = await Promise.all(mergedPaths.map(async path => {
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

        const trailAims = path.isMerged ? path.aims : path.aims.slice(0, -1)
        const trail = trailAims.map(step => step.text).join(' > ')
        
        if (path.isMerged) {
          label += ` > ... > ${trail}`
        } else if (trail) {
          label += ` > ${trail}`
        }

        return { ...path, label }
      }))

      pathSelectionMode.value = true
    }
  } catch (error) {
    console.error('Error preparing navigation:', error)
  } finally {
    loading.value = false
  }
}

const shouldKeepOpen = (keepOpenRequested?: boolean) => {
  return modalStore.aimSearchMode === 'pick' && keepOpenRequested === true
}

const handlePickerActivate = (payload: AimSearchSelection) => {
  if (!payload) return

  if (pathSelectionMode.value) {
    if (payload.type === 'aim') {
      const pathIndex = payload.data.score ?? 0
      const path = availablePaths.value[pathIndex]
      if (path) {
        emit('select', { type: 'path', data: path })
        close()
      }
    }
    return
  }

  const keepOpen = shouldKeepOpen(payload.keepOpen)

  if (payload.type === 'option') {
    emit('select', keepOpen ? payload : { type: 'option', data: payload.data })
    if (keepOpen) {
      nextTick(() => pickerRef.value?.focusInput())
    } else {
      close()
    }
    return
  }

  void selectAim(payload.data, keepOpen)
}

const handleEscape = () => {
  if (pathSelectionMode.value) {
    pathSelectionMode.value = false
    nextTick(() => pickerRef.value?.focusInput())
    return
  }
  close()
}

const close = () => {
  pathSelectionMode.value = false
  availablePaths.value = []
  selectedAimText.value = ''
  emit('close')
}

onMounted(async () => {
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
</script>

<template>
  <div class="search-overlay" @click.self="close" @keydown="handleKeydown">
    <div class="search-modal">
      <div class="modal-header">
        <h3>{{ pathSelectionMode ? 'Select Path' : modalStore.aimSearchTitle }}</h3>
      </div>

      <AimSearchPicker
        ref="pickerRef"
        :placeholder="modalStore.aimSearchPlaceholder"
        :show-filters="!pathSelectionMode && modalStore.aimSearchShowFilters"
        :show-input="!pathSelectionMode"
        :autofocus="true"
        :additional-options="!pathSelectionMode ? modalStore.aimSearchAdditionalOptions : []"
        :external-results="externalResults"
        :navigation-title="pathSelectionMode ? selectedAimText : ''"
        @activate="handlePickerActivate"
        @escape="handleEscape"
      />

      <div v-if="loading" class="loading-state">...</div>
    </div>
  </div>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1100;
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

.loading-state {
  padding: 0.75rem 1rem 1rem;
  color: #888;
}
</style>
