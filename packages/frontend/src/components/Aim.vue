<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { Aim } from 'shared'
import { useUIStore } from '../stores/ui'

defineOptions({
  inheritAttrs: false
})

interface Props {
  aim: Aim
  isExpanded?: boolean
  indentationLevel?: number
  pendingDelete?: boolean
  pendingRemove?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isExpanded: false,
  indentationLevel: 0,
  pendingDelete: false,
  pendingRemove: false
})

const emit = defineEmits<{
  focused: []
}>()

const uiStore = useUIStore()

// Template refs
const aimRef = ref<HTMLElement | null>(null)

// Focus management
const ignoreNextFocus = ref(false)

// Focus methods
const focusByParent = () => {
  if (document.activeElement === aimRef.value) return // Already focused

  ignoreNextFocus.value = true
  aimRef.value?.focus()
}

const blurByParent = () => {
  aimRef.value?.blur()
}

// Focus event handler
const handleFocus = () => {
  if (ignoreNextFocus.value) {
    ignoreNextFocus.value = false
    return
  }

  emit('focused')
}

// Keyboard handling
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'e') {
    e.preventDefault()
    openEditModal()
  }
  // j/k/d are handled by parent, let them bubble
}

// Modal state
const showEditModal = ref(false)
const aimModalPhaseId = ref<string | null>(null)
const aimModalInsertionIndex = ref(0)

const openEditModal = () => {
  showEditModal.value = true
  // Note: phaseId and aimIndex need to be passed as props from parent
  // Will be implemented when integrating with Phase/RootAimsColumn
}

// Keyboard hints
const keyboardHints = ref<Record<string, string>>({
  'e': 'edit aim'
})

let unregisterHints: (() => void) | null = null

onMounted(() => {
  unregisterHints = uiStore.registerKeyboardHints(keyboardHints)
})

onUnmounted(() => {
  unregisterHints?.()
})

// Expose methods for parent
defineExpose({
  focusByParent,
  blurByParent
})

// Computed properties
const hasIncomingAims = computed(() => {
  return props.aim.incoming && props.aim.incoming.length > 0
})

const statusColor = computed(() => {
  switch (props.aim.status.state) {
    case 'open': return '#87f'
    case 'done': return '#00ff00'
    case 'cancelled': return '#ff0000'
    case 'partially': return '#ffff00'
    case 'failed': return '#ff6666'
    default: return '#888'
  }
})

const indentStyle = computed(() => {
  return {
    marginLeft: `${props.indentationLevel * 0.75}rem`
  }
})
</script>

<template>
  <div
    class="aim-container"
    :style="indentStyle"
  >
    <div
      ref="aimRef"
      class="aim-item focusable"
      :class="[$attrs.class, {
        expanded: isExpanded,
        'pending-delete': pendingDelete,
        'pending-remove': pendingRemove
      }]"
      tabindex="0"
      @focus="handleFocus"
      @keydown="handleKeydown"
    >
      <!-- Aim content -->
      <div class="aim-content">
        <div class="aim-text">{{ aim.text }}</div>
        <div class="aim-meta">
          <div
            class="aim-status"
            :style="{ color: statusColor }"
          >
            {{ aim.status.state }}
          </div>
          <div v-if="aim.status.comment" class="aim-comment">
            {{ aim.status.comment }}
          </div>
        </div>
      </div>
    </div>

    <!-- Expanded incoming aims (recursive) -->
    <div v-if="isExpanded && hasIncomingAims" class="incoming-aims">
      <div class="incoming-placeholder">
        {{ aim.incoming.length }} incoming aims (not yet loaded)
      </div>
    </div>
  </div>
</template>

<style scoped>
.aim-container {
  display: flex;
  flex-direction: column;
}

.aim-item {
  display: flex;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.5rem;
  margin-bottom: 0.25rem;
  cursor: pointer;
  
  &.pending-delete {
    background-color: rgba(255, 0, 0, 0.2);
  }
  
  &.pending-remove {
    background-color: rgba(255, 165, 0, 0.2);
  }
}

.aim-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  
  .aim-text {
    color: #e0e0e0;
    line-height: 1.4;
  }
  
  .aim-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.8rem;
    
    .aim-status {
      text-transform: uppercase;
      font-weight: bold;
    }
    
    .aim-comment {
      color: #888;
      font-style: italic;
    }
  }
}

.incoming-aims {
  margin-top: 0.5rem;
  
  .incoming-placeholder {
    color: #666;
    font-style: italic;
    font-size: 0.9rem;
    padding: 0.5rem 0 0.5rem 2rem;
  }
}
</style>