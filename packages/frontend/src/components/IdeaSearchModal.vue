<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { useUIStore, type IdeaPath } from '../stores/ui'
import { mergePathsByEnd, type MergedPath } from '../utils/path-merge'
import { useDataStore } from '../stores/data'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { trpc } from '../trpc'
import type { Idea, SearchIdeaResult } from 'shared'
import type { IdeaSearchAdditionalOption } from '../stores/ui/idea-search-types'
import IdeaSearchPicker, { type IdeaSearchSelection } from './IdeaSearchPicker.vue'

type IdeaSearchModalPayload =
  | { type: 'idea'; data: Idea; keepOpen?: boolean }
  | { type: 'path'; data: IdeaPath; keepOpen?: boolean }
  | { type: 'option'; data: IdeaSearchAdditionalOption; keepOpen?: boolean }

const uiStore = useUIStore()
const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()

const emit = defineEmits<{
  (e: 'select', payload: IdeaSearchModalPayload): void
  (e: 'close'): void
}>()

const pickerRef = ref<InstanceType<typeof IdeaSearchPicker>>()
const loading = ref(false)

const pathSelectionMode = ref(false)
const availablePaths = ref<(IdeaPath & { label: string })[]>([])

// "Phase > A > B" per path; merged paths show only their common end after "…".
// `dropLast` leaves out the path's final idea when it is the idea being navigated to.
const labelPaths = (paths: MergedPath[], dropLast: boolean) => Promise.all(paths.map(async ({ path, shownIdeas, merged }) => {
  let phase = path.phaseId ? dataStore.phases[path.phaseId] : undefined
  if (path.phaseId && !phase) {
    phase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId: path.phaseId }).catch(() => undefined)
  }
  const steps = (dropLast ? shownIdeas.slice(0, -1) : shownIdeas).map(step => step.text)
  const label = [path.phaseId ? phase?.name ?? 'Unknown Phase' : 'Floating', ...(merged ? ['…'] : []), ...steps].join(' > ')
  return { ...path, label }
}))
const selectedIdeaText = ref('')

const externalResults = computed<SearchIdeaResult[] | undefined>(() => {
  if (!pathSelectionMode.value) return undefined
  return availablePaths.value.map((path, index) => ({
    id: `path-${index}`,
    text: path.label,
    status: { state: 'open', comment: '', date: Date.now() },
    committedIn: [],
    supportedIdeas: [],
    supportingConnections: [],
    intrinsicValue: 0,
    cost: 0,
    tags: [],
    archived: false,
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

const selectIdea = async (idea: Idea, keepOpen = false) => {
  if (modalStore.ideaSearchMode === 'pick') {
    try {
      const fullIdea = await trpc.idea.get.query({ projectPath: projectStore.projectPath, ideaId: idea.id })
      emit('select', keepOpen ? { type: 'idea', data: fullIdea, keepOpen } : { type: 'idea', data: fullIdea })
    } catch (error) {
      console.error('Failed to load idea for selection', error)
      emit('select', keepOpen ? { type: 'idea', data: idea, keepOpen } : { type: 'idea', data: idea })
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
      const fullIdea = await trpc.idea.get.query({ projectPath: projectStore.projectPath, ideaId: idea.id })
      emit('select', { type: 'idea', data: fullIdea })
    } catch (error) {
      console.error('Failed to load idea for graph navigation', error)
      emit('select', { type: 'idea', data: idea })
    }
    close()
    return
  }

  loading.value = true
  try {
    const paths = await uiStore.prepareNavigation(idea.id)

    if (paths.length === 0) {
      close()
    } else if (paths.length === 1 && paths[0]) {
      emit('select', { type: 'path', data: paths[0] })
      close()
    } else {
      selectedIdeaText.value = idea.text.length > 50 ? `${idea.text.substring(0, 50)}...` : idea.text

      // The paths end at the idea itself: merge those through the same parent.
      availablePaths.value = await labelPaths(mergePathsByEnd(paths, 2), true)
      pathSelectionMode.value = true
    }
  } catch (error) {
    console.error('Error preparing navigation:', error)
  } finally {
    loading.value = false
  }
}

const shouldKeepOpen = (keepOpenRequested?: boolean) => {
  return modalStore.ideaSearchMode === 'pick' && keepOpenRequested === true
}

const handlePickerActivate = (payload: IdeaSearchSelection) => {
  if (!payload) return

  if (pathSelectionMode.value) {
    if (payload.type === 'idea') {
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

  void selectIdea(payload.data, keepOpen)
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
  selectedIdeaText.value = ''
  emit('close')
}

const handlePathSelectionKeydown = (event: KeyboardEvent) => {
  if (event.key === 'j' || event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    pickerRef.value?.navigate(1)
  } else if (event.key === 'k' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    pickerRef.value?.navigate(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    pickerRef.value?.activateSelection()
  } else if (event.key === 'Backspace' || event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    handleEscape()
  }
}

watch(pathSelectionMode, (active) => {
  if (active) {
    window.addEventListener('keydown', handlePathSelectionKeydown, true)
  } else {
    window.removeEventListener('keydown', handlePathSelectionKeydown, true)
  }
})

onMounted(async () => {
  if (modalStore.ideaSearchInitialIdeaId && modalStore.ideaSearchShowParentPaths) {
    const ideaId = modalStore.ideaSearchInitialIdeaId
    loading.value = true
    try {
      const idea = await trpc.idea.get.query({ projectPath: projectStore.projectPath, ideaId })

      if (!idea.supportedIdeas || idea.supportedIdeas.length === 0) {
        loading.value = false
        nextTick(() => pickerRef.value?.focusInput())
        return
      }

      const allPaths: IdeaPath[] = []
      for (const parentId of idea.supportedIdeas) {
        const paths = await uiStore.prepareNavigation(parentId)
        allPaths.push(...paths)
      }

      selectedIdeaText.value = `Parent ideas of: ${idea.text.length > 40 ? `${idea.text.substring(0, 40)}...` : idea.text}`
      availablePaths.value = await labelPaths(mergePathsByEnd(allPaths, 1), false)

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

  if (modalStore.ideaSearchInitialIdeaId) {
    loading.value = true
    try {
      const idea = await trpc.idea.get.query({
        projectPath: projectStore.projectPath,
        ideaId: modalStore.ideaSearchInitialIdeaId
      })
      await selectIdea(idea)
    } catch (error) {
      console.error('Failed to load initial idea', error)
    } finally {
      loading.value = false
    }
    return
  }

  nextTick(() => pickerRef.value?.focusInput())
})

onUnmounted(() => {
  window.removeEventListener('keydown', handlePathSelectionKeydown, true)
})
</script>

<template>
  <div class="search-overlay" @click.self="close" @keydown="handleKeydown">
    <div class="search-modal">
      <div class="modal-header">
        <h3>{{ pathSelectionMode ? 'Select Path' : modalStore.ideaSearchTitle }}</h3>
      </div>

      <IdeaSearchPicker
        ref="pickerRef"
        :placeholder="modalStore.ideaSearchPlaceholder"
        :show-filters="!pathSelectionMode && modalStore.ideaSearchShowFilters"
        :show-input="!pathSelectionMode"
        :autofocus="true"
        :additional-options="!pathSelectionMode ? modalStore.ideaSearchAdditionalOptions : []"
        :external-results="externalResults"
        :navigation-title="pathSelectionMode ? selectedIdeaText : ''"
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
