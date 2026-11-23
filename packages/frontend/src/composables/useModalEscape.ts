import { onMounted, onUnmounted, ref, type Ref } from 'vue'

// Escape closes the topmost open modal, wherever focus is. In multiline text
// it first only leaves the field (a vim habit: Escape ends insert mode) and
// says so; the next Escape closes. Keys a control handled itself
// (preventDefault) are left to it, and a modal that handles Escape on its own
// (enabled false) keeps the ones below it from closing.

type Entry = { close: () => void, open: () => boolean, enabled: () => boolean, armed: Ref<boolean> }

const stack: Entry[] = []

const isMultiline = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.isContentEditable)

function onKeydown(event: KeyboardEvent) {
  const top = [...stack].reverse().find(entry => entry.open())
  if (!top) return
  if (event.key !== 'Escape') {
    top.armed.value = false
    return
  }
  if (event.defaultPrevented || event.isComposing || !top.enabled()) return
  event.preventDefault()
  if (isMultiline(event.target) && !top.armed.value) {
    event.target.blur()
    top.armed.value = true
    return
  }
  top.armed.value = false
  top.close()
}

// open: the modal is shown (a shell may stay mounted while hidden).
// enabled: Escape closes it (false when the modal handles Escape itself).
export function useModalEscape(close: () => void, { open = () => true, enabled = () => true }: { open?: () => boolean, enabled?: () => boolean } = {}) {
  const entry: Entry = { close, open, enabled, armed: ref(false) }
  onMounted(() => {
    if (stack.length === 0) window.addEventListener('keydown', onKeydown)
    stack.push(entry)
  })
  onUnmounted(() => {
    const index = stack.indexOf(entry)
    if (index >= 0) stack.splice(index, 1)
    if (stack.length === 0) window.removeEventListener('keydown', onKeydown)
  })
  // True after Escape left a text field: the modal shows that Escape again closes.
  return { armed: entry.armed }
}
