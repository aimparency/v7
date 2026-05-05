<script setup lang="ts">
import CopyableMetaId from './CopyableMetaId.vue'

const props = withDefaults(defineProps<{
  show: boolean
  title: string
  entityId?: string | null
  entityIdLabel?: string
  width?: string
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
}>(), {
  entityId: null,
  entityIdLabel: 'ID',
  width: 'min(90vw, 50vw)',
  closeOnOverlay: true,
  closeOnEscape: true
})

const emit = defineEmits<{
  requestClose: []
}>()

const handleOverlayClick = () => {
  if (props.closeOnOverlay) {
    emit('requestClose')
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (props.closeOnEscape && event.key === 'Escape' && !event.defaultPrevented) {
    event.preventDefault()
    event.stopPropagation()
    emit('requestClose')
  }
}
</script>

<template>
  <div
    v-if="show"
    class="modal-overlay"
    tabindex="-1"
    @click.self="handleOverlayClick"
    @keydown="handleKeydown"
  >
    <div class="modal-panel" :style="{ width }">
      <div class="modal-header">
        <slot name="header">
          <h2>{{ title }}</h2>
          <CopyableMetaId
            v-if="entityId"
            :value="entityId"
            :label="entityIdLabel"
          />
        </slot>
      </div>

      <div class="modal-body">
        <slot />
      </div>

      <div v-if="$slots.footer" class="modal-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-panel {
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 0.3125rem;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: 0.875rem;
  border-bottom: 1px solid #555;
  flex-shrink: 0;
}

.modal-header h2 {
  margin: 0;
  color: #e0e0e0;
  font-size: 1.2rem;
}

.modal-body {
  padding: 0.875rem;
  flex: 1;
  overflow-y: auto;
}

.modal-footer {
  padding: 0.875rem;
  border-top: 1px solid #555;
  display: flex;
  gap: 0.375rem;
  justify-content: flex-end;
  flex-shrink: 0;
}
</style>
