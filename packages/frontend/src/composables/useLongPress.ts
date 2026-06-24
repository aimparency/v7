import { onBeforeUnmount } from 'vue'

interface LongPressOptions {
  // How long to hold before firing (ms).
  durationMs?: number
  // How far the pointer may drift before it counts as a scroll/drag and cancels.
  moveTolerancePx?: number
}

/**
 * Touch long-press detector. Returns pointer handlers to bind on an element.
 * Mouse pointers are ignored on purpose — long-press is the mobile affordance;
 * desktop keeps its keyboard shortcuts.
 */
export function useLongPress(
  callback: (event: PointerEvent) => void,
  options: LongPressOptions = {}
) {
  const durationMs = options.durationMs ?? 450
  const moveTolerancePx = options.moveTolerancePx ?? 10

  let timer: number | null = null
  let startX = 0
  let startY = 0

  const clear = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return
    startX = event.clientX
    startY = event.clientY
    clear()
    timer = window.setTimeout(() => {
      timer = null
      callback(event)
    }, durationMs)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (timer === null) return
    if (
      Math.abs(event.clientX - startX) > moveTolerancePx ||
      Math.abs(event.clientY - startY) > moveTolerancePx
    ) {
      clear()
    }
  }

  onBeforeUnmount(clear)

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear
  }
}
