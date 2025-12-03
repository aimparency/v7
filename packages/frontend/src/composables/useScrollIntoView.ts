import { type Ref } from 'vue'

export function useScrollIntoView(containerRef: Ref<HTMLElement | null>) {
  const handleScrollRequest = (element: HTMLElement) => {

    if (!containerRef.value) {
      return
    }

    const container = containerRef.value
    const containerRect = container.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()

    // Calculate 1/5 to 4/5 range (20% to 80%)
    const minY = containerRect.top + containerRect.height * 0.20
    const maxY = containerRect.top + containerRect.height * 0.80
    const rangeHeight = maxY - minY

    // Check if element is outside the range
    const isAboveRange = elementRect.top < minY
    const isBelowRange = elementRect.bottom > maxY

    // If element is within the optimal range, do nothing
    if (!isAboveRange && !isBelowRange) {
      return
    }

    // Calculate target scroll position
    let targetScroll = container.scrollTop

    // Logic for large elements (larger than the optimal range)
    if (elementRect.height > rangeHeight) {
      if (isAboveRange && isBelowRange) {
        // Element covers the whole range already, do nothing
        return
      }
      
      // Scroll just enough to bring the closer edge to the threshold
      if (isBelowRange) {
         // Bringing the top edge to the top threshold (minY) would be too much scrolling if we only want to see the top.
         // But wait, if it's "large", we just want to fill the area.
         // If we are scrolling down (it's below), we probably want to see the top of it?
         // Or do we want to see the bottom? 
         // "scroll as little as possible so that the entire 'scroll-into-area' is filled with the element."
         
         // If it is below, we need to scroll DOWN.
         // If we scroll down enough to put the TOP at minY, the element fills the area (and more below).
         // If we scroll down enough to put the BOTTOM at maxY, the element fills the area (and more above).
         // Which one involves "less" scrolling?
         
         // Actually, the aim says: "scroll only so far that the edge that is closer lies on the 1/5 or 4/5"
         // If element is below, its TOP edge is the "closer" one to the view? No, its Top edge is further away than the bottom of the view?
         // No, "edge that is closer" refers to the edge of the element relative to the viewport movement direction?
         
         // Let's re-read: "if the scroll-to-element box is higher than the "srcoll-into-area" ... then scroll only so far that the edge that is closer lies on the 1/5 or 4/5."
         
         // Case 1: Element is below. Top of element is at 900. MaxY is 800. 
         // We need to move it up. 
         // If we align Top (900) to MaxY (800), it starts filling from the bottom.
         // If we align Top (900) to MinY (200), it fills the whole view.
         
         // "scroll as little as possible so that the entire 'scroll-into-area' is filled"
         // If element is BELOW, we want to scroll DOWN. 
         // We want the TOP of the element to be at least at maxY? No, that would leave a gap.
         // We want the TOP of the element to be at minY? That fills the area.
         // If we align the BOTTOM of the element to maxY? That means we scrolled A LOT (passed the whole element).
         
         // So if it is below, we align TOP to minY.
         const offset = elementRect.top - minY
         targetScroll += offset
      } else if (isAboveRange) {
         // If it is above, we need to scroll UP.
         // We want the BOTTOM of the element to be at maxY.
         const offset = elementRect.bottom - maxY
         targetScroll += offset
      }
    } else {
      // Standard behavior for small elements (fit entirely)
      if (isBelowRange) {
        const offset = elementRect.bottom - maxY
        targetScroll += offset
      } else if (isAboveRange) {
        const offset = elementRect.top - minY
        targetScroll += offset
      }
    }

    // Clamp to valid scroll range
    const maxScroll = container.scrollHeight - container.clientHeight
    targetScroll = Math.max(0, Math.min(targetScroll, maxScroll))

    container.scrollTo({ top: targetScroll, behavior: 'smooth' })
  }

  return { handleScrollRequest }
}
