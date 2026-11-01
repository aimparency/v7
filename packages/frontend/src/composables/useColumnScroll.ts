import { onBeforeUnmount, watch, type Ref } from 'vue'

// The one place that scrolls a column. A column has one focus — the selected
// idea while navigating its ideas, otherwise the selected phase entry — and
// every trigger (selection change, re-measured heights, restore) only asks to
// reveal it. Revealing is idempotent: once the focus sits in the band, asking
// again never moves the column, so triggers can't compound or oscillate.

// The focus is kept between these fractions of the column height.
export const FOCUS_BAND_TOP = 0.15
export const FOCUS_BAND_BOTTOM = 0.85
// Farther than this many column heights, a reveal jumps instead of animating.
export const JUMP_PAGES = 2

// Vertical extent in the column's content coordinates (independent of scrolling).
export type FocusRect = { top: number; height: number }

// The scroll position that brings `focus` into the band with the least movement.
// A focus taller than the band fills it: already filling it, it stays put;
// otherwise the edge that is inside the band moves to the band's edge.
export function revealScrollTop(focus: FocusRect, scrollTop: number, viewport: number, maxScrollTop: number) {
  const bandTop = scrollTop + viewport * FOCUS_BAND_TOP
  const bandBottom = scrollTop + viewport * FOCUS_BAND_BOTTOM
  const focusBottom = focus.top + focus.height
  const alignTop = focus.top - viewport * FOCUS_BAND_TOP
  const alignBottom = focusBottom - viewport * FOCUS_BAND_BOTTOM

  let target = scrollTop
  if (focus.height <= bandBottom - bandTop) {
    if (focus.top < bandTop) target = alignTop
    else if (focusBottom > bandBottom) target = alignBottom
  } else if (focus.top > bandTop) {
    target = alignTop
  } else if (focusBottom < bandBottom) {
    target = alignBottom
  }
  return Math.max(0, Math.min(target, maxScrollTop))
}

// The scroll position that puts `focus` in the middle of the column: where a
// column opens (project open, UI-state restore), it has no previous position
// to keep.
export function centerScrollTop(focus: FocusRect, viewport: number, maxScrollTop: number) {
  return Math.max(0, Math.min(focus.top + focus.height / 2 - viewport / 2, maxScrollTop))
}

// The selected idea's own row, without its expanded sub-ideas. Every idea on
// the selection path carries `.active`, ancestors first: the last is the selected one.
export function selectedIdeaRow(container: HTMLElement) {
  const activeIdeas = container.querySelectorAll<HTMLElement>('.idea-item.active')
  const idea = activeIdeas[activeIdeas.length - 1]
  return idea?.querySelector<HTMLElement>(':scope > .idea-content') ?? idea ?? null
}

export function contentRect(container: HTMLElement, element: HTMLElement): FocusRect {
  const rect = element.getBoundingClientRect()
  return { top: rect.top - container.getBoundingClientRect().top + container.scrollTop, height: rect.height }
}

export function useColumnScroll(
  containerRef: Ref<HTMLElement | null>,
  getFocus: () => FocusRect | null,
  // Jump without animating, e.g. while restoring the UI state.
  isInstant: () => boolean = () => false
) {
  // Where a running smooth scroll ends. Decisions build on it, not on the
  // half-way position, so quickly repeated keys add up.
  let destination: number | null = null
  let frame: number | null = null
  let revealed = false

  // Returns whether it jumped (rather than animated or stayed).
  const scrollTo = (container: HTMLElement, top: number): boolean => {
    const distance = Math.abs(top - container.scrollTop)
    if (distance < 1) {
      destination = null
      return false
    }
    // The first reveal positions the column; far targets are mostly estimated
    // heights, so jump there and settle once the entries are measured.
    if (!revealed || isInstant() || distance > container.clientHeight * JUMP_PAGES) {
      destination = null
      container.scrollTop = top
      return true
    }
    destination = top
    container.scrollTo({ top, behavior: 'smooth' })
    return false
  }

  const revealNow = (settle: boolean) => {
    const container = containerRef.value
    const focus = container && getFocus()
    if (!container || !focus) return
    const from = destination ?? container.scrollTop
    const maxScrollTop = container.scrollHeight - container.clientHeight
    const target = !revealed || isInstant()
      ? centerScrollTop(focus, container.clientHeight, maxScrollTop)
      : revealScrollTop(focus, from, container.clientHeight, maxScrollTop)
    const jumped = target !== from && scrollTo(container, target)
    revealed = true
    if (jumped && settle) schedule(false)
  }

  const schedule = (settle: boolean) => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      revealNow(settle)
    })
  }

  // Coalesced to one reveal per frame, measured at that frame.
  const reveal = () => schedule(true)

  const scrollToEdge = (edge: 'top' | 'bottom') => {
    const container = containerRef.value
    if (container) scrollTo(container, edge === 'top' ? 0 : container.scrollHeight - container.clientHeight)
  }

  // Content above the focus changed height: move with it so the focus stays put.
  const shift = (delta: number) => {
    const container = containerRef.value
    if (!container || delta === 0) return
    container.scrollTop += delta
    if (destination !== null) {
      destination += delta
      container.scrollTo({ top: destination, behavior: 'smooth' })
    }
  }

  // A smooth scroll ends, or the user takes over.
  const forgetDestination = () => { destination = null }
  const onScroll = () => {
    const container = containerRef.value
    if (container && destination !== null && Math.abs(container.scrollTop - destination) < 1) destination = null
  }
  const listeners = { scroll: onScroll, scrollend: forgetDestination, wheel: forgetDestination, touchstart: forgetDestination, pointerdown: forgetDestination }
  watch(containerRef, (container, previous) => {
    for (const [type, listener] of Object.entries(listeners)) {
      previous?.removeEventListener(type, listener)
      container?.addEventListener(type, listener, { passive: true })
    }
    destination = null
    revealed = false
  }, { immediate: true })

  onBeforeUnmount(() => {
    if (frame !== null) cancelAnimationFrame(frame)
    for (const [type, listener] of Object.entries(listeners)) containerRef.value?.removeEventListener(type, listener)
  })

  return { reveal, scrollToEdge, shift }
}
