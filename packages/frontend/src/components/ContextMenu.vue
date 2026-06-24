<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

export interface ContextMenuItem {
  id: string
  label: string
  // Optional second-tap confirmation (e.g. delete). The label switches to
  // `confirmLabel` after the first tap; `run` fires on both taps so callers
  // that drive a pending->commit flow (like the keyboard `d d`) work unchanged.
  confirm?: boolean
  confirmLabel?: string
  danger?: boolean
  run: () => void | Promise<void>
}

const props = defineProps<{
  items: ContextMenuItem[]
  x: number
  y: number
}>()

const emit = defineEmits<{ close: [] }>()

const menuRef = ref<HTMLElement | null>(null)
const confirmingId = ref<string | null>(null)

// Position is fixed at the press point, then clamped so the menu stays on screen.
const style = ref<Record<string, string>>({ left: `${props.x}px`, top: `${props.y}px` })

const clampToViewport = () => {
  const el = menuRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const margin = 8
  let left = props.x
  let top = props.y
  if (left + rect.width + margin > window.innerWidth) {
    left = Math.max(margin, window.innerWidth - rect.width - margin)
  }
  if (top + rect.height + margin > window.innerHeight) {
    top = Math.max(margin, window.innerHeight - rect.height - margin)
  }
  style.value = { left: `${left}px`, top: `${top}px` }
}

const labelFor = (item: ContextMenuItem) =>
  item.confirm && confirmingId.value === item.id
    ? (item.confirmLabel ?? 'Confirm')
    : item.label

const onItem = async (item: ContextMenuItem) => {
  if (item.confirm && confirmingId.value !== item.id) {
    confirmingId.value = item.id
    await item.run()
    return
  }
  await item.run()
  emit('close')
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  clampToViewport()
  window.addEventListener('keydown', onKey, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop catches the outside tap to dismiss. -->
    <div class="context-menu-backdrop" @pointerdown="emit('close')" @contextmenu.prevent>
      <div
        ref="menuRef"
        class="context-menu"
        :style="style"
        @pointerdown.stop
        @contextmenu.prevent
      >
        <button
          v-for="item in items"
          :key="item.id"
          class="context-menu-item"
          :class="{
            danger: item.danger,
            confirming: item.confirm && confirmingId === item.id
          }"
          @click="onItem(item)"
        >{{ labelFor(item) }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.context-menu {
  position: fixed;
  min-width: 11rem;
  max-width: 16rem;
  padding: 0.35rem;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 0.5rem;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 2.5rem;
  padding: 0 0.7rem;
  background: transparent;
  border: none;
  border-radius: 0.35rem;
  color: #e0e0e0;
  font: inherit;
  font-size: 0.9rem;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.context-menu-item:hover,
.context-menu-item:active {
  background: rgba(255, 255, 255, 0.1);
}

.context-menu-item.danger {
  color: #f08a8a;
}

.context-menu-item.confirming {
  background: #c04040;
  color: #fff;
}
</style>
