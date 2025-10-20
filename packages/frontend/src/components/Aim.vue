<script setup lang="ts">
import { computed, ref, watch, onMounted, useAttrs } from 'vue'
import type { Aim } from 'shared'

defineOptions({ inheritAttrs: false })

interface Props {
  aim: Aim
  isExpanded?: boolean
  indentationLevel?: number
  isActive?: boolean
  isSelected?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isExpanded: false,
  indentationLevel: 0,
  isActive: false,
  isSelected: false
})

const emit = defineEmits<{
  'aim-clicked': []
  'scroll-request': [element: HTMLElement]
}>()

const attrs = useAttrs()
const aimContainerRef = ref<HTMLElement | null>(null)

const hasIncomingAims = computed(() => props.aim.incoming?.length > 0)

const statusColor = computed(() => ({
  'open': '#87f',
  'done': '#00ff00',
  'cancelled': '#ff0000',
  'partially': '#ffff00',
  'failed': '#ff6666'
}[props.aim.status.state] ?? '#888'))

const indentStyle = computed(() => ({
  marginLeft: `${props.indentationLevel * 0.75}rem`
}))

// Scroll into view when selected (active or not)
watch(() => props.isActive || props.isSelected, (shouldScroll) => {
  if (shouldScroll && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
}, { flush: 'post' })

// Scroll on mount if already selected (for cascade restoration)
onMounted(() => {
  if ((props.isActive || props.isSelected) && aimContainerRef.value) {
    emit('scroll-request', aimContainerRef.value)
  }
})
</script>

<template>
  <div
    ref="aimContainerRef"
    class="aim-container"
    :style="indentStyle"
  >
    <div
      class="aim-item"
      :class="[attrs.class, { expanded: isExpanded }]"
      @click.stop="$emit('aim-clicked')"
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