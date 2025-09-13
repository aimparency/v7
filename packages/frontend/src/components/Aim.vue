<script setup lang="ts">
import { computed } from 'vue'
import type { Aim } from 'shared'
import { useUIStore } from '../stores/ui'

interface Props {
  aim: Aim
  isSelected?: boolean
  isExpanded?: boolean
  indentationLevel?: number
}

const props = withDefaults(defineProps<Props>(), {
  isSelected: false,
  isExpanded: false,
  indentationLevel: 0
})

const uiStore = useUIStore()

const hasIncomingAims = computed(() => {
  return props.aim.incoming && props.aim.incoming.length > 0
})

const canExpand = computed(() => {
  return hasIncomingAims.value && !props.isExpanded
})

const canCollapse = computed(() => {
  return hasIncomingAims.value && props.isExpanded
})

const statusColor = computed(() => {
  switch (props.aim.status.state) {
    case 'open': return '#ffa500'
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
      class="aim-item"
      :class="{ 
        selected: isSelected,
        'has-incoming': hasIncomingAims,
        expanded: isExpanded
      }"
    >
      <!-- Expansion indicator -->
      <div class="expansion-indicator">
        <span v-if="hasIncomingAims" class="expansion-icon">
          {{ isExpanded ? '▼' : '▶' }}
        </span>
      </div>
      
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
      <!-- TODO: Load and display incoming aims recursively -->
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
  padding: 0.25rem;
  border-radius: 3px;
  border-left: 2px solid #444;
  background: #2d2d2d;
  transition: all 0.2s ease;
  
  &.selected {
    background: #333;
  }
  
  &:hover:not(.selected) {
    background: #313131;
  }
  
  &.has-incoming {
    border-left-color: #666;
    
    &.expanded {
      border-left-color: #888;
    }
  }
}

.expansion-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 0.75rem;
  height: 0.75rem;
  margin-top: 0.125rem;
  
  .expansion-icon {
    color: #888;
    font-size: 0.75rem;
    cursor: pointer;
    
    &:hover {
      color: #007acc;
    }
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