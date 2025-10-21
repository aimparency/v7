import { type Ref } from 'vue'

export function useScrollIntoView(containerRef: Ref<HTMLElement | null>) {
  const handleScrollRequest = (element: HTMLElement) => {

    if (!containerRef.value) {
      return
    }

    const container = containerRef.value
    const containerRect = container.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()

    // Calculate 1/4 to 3/4 range
    const minY = containerRect.top + containerRect.height * 0.25
    const maxY = containerRect.top + containerRect.height * 0.75

    // Check if element is outside the range
    const isAboveRange = elementRect.top < minY
    const isBelowRange = elementRect.bottom > maxY

    // If element exceeds both thresholds (too large), don't scroll
    if (isAboveRange && isBelowRange) {
      return
    }

    if (!isAboveRange && !isBelowRange) {
      return
    }

    // Calculate target scroll position
    let targetScroll = container.scrollTop

    if (isBelowRange) {
      const offset = elementRect.bottom - maxY
      targetScroll += offset
    } else if (isAboveRange) {
      const offset = elementRect.top - minY
      targetScroll += offset
    }

    // Clamp to valid scroll range
    const maxScroll = container.scrollHeight - container.clientHeight
    targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

    container.scrollTo({ top: targetScroll, behavior: 'smooth' })
  }

  return { handleScrollRequest }
}
