<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import type { Aim } from 'shared'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import AimComponent from './Aim.vue'

interface Props {
  pageFrom: number
  pageTo: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  pageNavigation: [delta: number]
}>()

const dataStore = useDataStore()
const uiStore = useUIStore()

// Template refs
const columnRef = ref<HTMLElement | null>(null)
const aimsListRef = ref<HTMLElement | null>(null)
const aimRefs = ref<InstanceType<typeof AimComponent>[]>([])

// Local state
const focusedAimIndex = ref(0)
const showCreateModal = ref(false)
const ignoreNextFocus = ref(false)

// Load uncommitted aims
const rootAims = computed(() => {
  return dataStore.getPhaseAims('null') || []
})

// Compute visibility
const isVisible = computed(() => {
  const columnIndex = 0 // RootAimsColumn is always column 0
  return columnIndex >= props.pageFrom && columnIndex <= props.pageTo
})

// Focus methods
const focusByParent = () => {
  const targetAim = aimRefs.value[focusedAimIndex.value] || aimRefs.value[0]
  if (targetAim) {
    targetAim.focusByParent()
  } else {
    // No aims, focus the column itself (empty state)
    if (document.activeElement === columnRef.value) return
    ignoreNextFocus.value = true
    columnRef.value?.focus()
  }
}

const blurByParent = () => {
  const focusedAim = aimRefs.value[focusedAimIndex.value]
  if (focusedAim) {
    focusedAim.blurByParent()
  }
  columnRef.value?.blur()
}

// Focus event handlers
const handleFocus = () => {
  if (ignoreNextFocus.value) {
    ignoreNextFocus.value = false
    return
  }

  // Column received focus (empty state case)
  // Don't emit 'focused' for columns - parent doesn't need to track
}

const handleAimFocused = (index: number) => {
  focusedAimIndex.value = index
  scrollAimIntoView(index)
}

// Navigation
const navigateDown = () => {
  if (focusedAimIndex.value < rootAims.value.length - 1) {
    uiStore.clearPendingDelete()
    focusedAimIndex.value++
    aimRefs.value[focusedAimIndex.value]?.focusByParent()
  }
}

const navigateUp = () => {
  if (focusedAimIndex.value > 0) {
    uiStore.clearPendingDelete()
    focusedAimIndex.value--
    aimRefs.value[focusedAimIndex.value]?.focusByParent()
  }
}

// Keyboard handling
const handleKeydown = (e: KeydownEvent) => {
  switch (e.key) {
    case 'j':
      e.preventDefault()
      navigateDown()
      break
    case 'k':
      e.preventDefault()
      navigateUp()
      break
    case 'h':
      e.preventDefault()
      emit('pageNavigation', -1)
      break
    case 'l':
      e.preventDefault()
      emit('pageNavigation', +1)
      break
    case 'o':
      e.preventDefault()
      openCreateModal()
      break
    case 'd':
      e.preventDefault()
      handleDeleteAim()
      break
  }
}

// Modal management
const openCreateModal = () => {
  showCreateModal.value = true
  // TODO: Implement modal integration in Phase 7
}

// Delete handling
const handleDeleteAim = () => {
  const aimIndex = focusedAimIndex.value
  if (uiStore.pendingDeleteAimIndex === aimIndex) {
    // Confirm delete
    deleteAim(aimIndex)
    uiStore.clearPendingDelete()
  } else {
    // First press - mark for deletion
    uiStore.setPendingDeleteAim(aimIndex)
  }
}

const deleteAim = async (aimIndex: number) => {
  const aim = rootAims.value[aimIndex]
  if (!aim) return

  try {
    // TODO: Implement actual deletion via tRPC
    // await trpc.aim.removeFromPhase.mutate({ ... })

    // Reload aims
    await dataStore.loadPhaseAims(uiStore.projectPath, 'null')

    // Adjust focus
    if (rootAims.value.length === 0) {
      // No more aims, focus column
      columnRef.value?.focus()
    } else if (focusedAimIndex.value >= rootAims.value.length) {
      // Was last aim, move to previous
      focusedAimIndex.value = rootAims.value.length - 1
      aimRefs.value[focusedAimIndex.value]?.focusByParent()
    }
  } catch (error) {
    console.error('Failed to delete aim:', error)
  }
}

// Scroll into view (1/4 to 3/4 viewport)
const scrollAimIntoView = async (aimIndex: number) => {
  await nextTick()

  const container = aimsListRef.value
  if (!container) return

  const aimElement = aimRefs.value[aimIndex]?.$el || aimRefs.value[aimIndex]
  if (!aimElement) return

  const containerRect = container.getBoundingClientRect()
  const aimRect = aimElement.getBoundingClientRect()

  const viewportHeight = window.innerHeight
  const quarterMark = viewportHeight * 0.25
  const threeQuarterMark = viewportHeight * 0.75

  const isAboveRange = aimRect.top < quarterMark
  const isBelowRange = aimRect.bottom > threeQuarterMark

  if (!isAboveRange && !isBelowRange) return

  let targetScroll = container.scrollTop

  if (isBelowRange) {
    const offset = aimRect.bottom - threeQuarterMark
    targetScroll += offset
  } else if (isAboveRange) {
    const offset = aimRect.top - quarterMark
    targetScroll += offset
  }

  const maxScroll = container.scrollHeight - container.clientHeight
  targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

  container.scrollTo({ top: targetScroll, behavior: 'smooth' })
}

// Keyboard hints
const keyboardHints = ref<Record<string, string>>({
  'j': 'next aim',
  'k': 'prev aim',
  'o': 'create aim',
  'd': 'delete aim',
  'h': 'prev page',
  'l': 'next page'
})

let unregisterHints: (() => void) | null = null

onMounted(() => {
  unregisterHints = uiStore.registerKeyboardHints(keyboardHints)
})

onUnmounted(() => {
  unregisterHints?.()
})

// Expose methods
defineExpose({
  focusByParent,
  blurByParent
})
</script>

<template>
  <div
    ref="columnRef"
    class="root-aims-column"
    :class="{ 'not-visible': !isVisible }"
    tabindex="0"
    @focus="handleFocus"
    @keydown="handleKeydown"
  >
    <div v-if="rootAims.length === 0" class="empty-state">
      No aims yet, create one with o
    </div>

    <template v-else>
      <div class="info">free floating aims</div>
      <div ref="aimsListRef" class="aims-list">
        <AimComponent
          v-for="(aim, index) in rootAims"
          :key="aim.id"
          :ref="el => { if (el) aimRefs[index] = el as InstanceType<typeof AimComponent> }"
          :aim="aim"
          :class="{
            'pending-delete': uiStore.pendingDeleteAimIndex === index
          }"
          @focused="handleAimFocused(index)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.root-aims-column {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.root-aims-column.not-visible {
  opacity: 0.3;
  pointer-events: none;
}

.aims-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 0.375rem;
  }

  &::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 0.1875rem;

    &:hover {
      background: #666;
    }
  }

  /* Firefox scrollbar */
  scrollbar-width: thin;
  scrollbar-color: #555 #1a1a1a;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-style: italic;
}

.pending-delete {
  background: rgba(192, 64, 64, 0.5);
}

.info {
  font-size: 0.8rem;
  color: #fff4;
  text-align: center;
  margin-top: 0.5rem;
}
</style>
