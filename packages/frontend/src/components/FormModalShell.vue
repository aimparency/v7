<script setup lang="ts">
import { X } from 'lucide-vue-next'
import CopyableMetaId from './CopyableMetaId.vue'
import { isModalConfirmKey } from '../stores/ui/modal-helpers'
import { useModalEscape } from '../composables/useModalEscape'

const props = withDefaults(defineProps<{
  show: boolean
  title: string
  entityId?: string | null
  entityIdLabel?: string
  width?: string
  closeOnOverlay?: boolean
  closeOnEscape?: boolean
  headerStyle?: string | Record<string, string>
  // Enter confirms the modal (see isModalConfirmKey); declared as a prop so
  // modals without @confirm keep Enter's default behaviour.
  onConfirm?: () => void
}>(), {
  entityId: null,
  entityIdLabel: 'ID',
  width: 'min(90vw, 50vw)',
  closeOnOverlay: true,
  closeOnEscape: true,
  headerStyle: ''
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
  if (props.onConfirm && isModalConfirmKey(event)) {
    event.preventDefault()
    event.stopPropagation()
    props.onConfirm()
  }
}

const { armed } = useModalEscape(() => emit('requestClose'), { open: () => props.show, enabled: () => props.closeOnEscape })
</script>

<template>
  <div
    v-if="show"
    class="modal-overlay"
    aria-modal="true"
    tabindex="-1"
    @click.self="handleOverlayClick"
    @keydown="handleKeydown"
  >
    <div class="modal-panel" :style="{ width }">
      <div class="modal-header" :style="headerStyle">
        <slot name="header">
          <div class="modal-header-content">
            <div class="modal-header-left">
              <h2>{{ title }}</h2>
              <CopyableMetaId
                v-if="entityId"
                :value="entityId"
                :label="entityIdLabel"
              />
            </div>
            <div class="modal-header-right">
              <slot name="header-right" />
              <span v-if="armed" class="hint">Esc again closes</span>
              <button type="button" class="icon-btn" :title="closeOnEscape ? 'Close (Esc)' : 'Close'" @click="emit('requestClose')"><X /></button>
            </div>
          </div>
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
  transition: background 0.25s ease;
}

.modal-header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.modal-header-left {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.modal-header-right {
  display: flex;
  align-items: center;
  gap: 0.375rem;
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
  /* Narrow screens: the buttons go onto further lines rather than out of the window. */
  flex-wrap: wrap;
  gap: 0.375rem;
  justify-content: flex-end;
  flex-shrink: 0;
}
</style>
