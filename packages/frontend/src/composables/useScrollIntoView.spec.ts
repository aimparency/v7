import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useScrollIntoView } from './useScrollIntoView'

describe('useScrollIntoView', () => {
  const createMockContainer = (height = 800, scrollTop = 0) => {
    const scrollTo = vi.fn()
    const container = {
      scrollTop,
      scrollHeight: 2000,
      clientHeight: height,
      getBoundingClientRect: () => ({
        top: 0,
        height,
        bottom: height,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => {}
      }),
      scrollTo
    } as unknown as HTMLElement
    return { container, scrollTo }
  }

  const createMockElement = (top: number, height: number) => {
    return {
      getBoundingClientRect: () => ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => {}
      })
    } as unknown as HTMLElement
  }

  it('should not scroll if element is already in optimal range (small element)', () => {
    const { container, scrollTo } = createMockContainer(1000) // Range: 200-800 (20%-80%)
    const containerRef = ref(container)
    const { handleScrollRequest } = useScrollIntoView(containerRef)

    // Element at 300-400. Inside 200-800.
    const element = createMockElement(300, 100)
    
    handleScrollRequest(element)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('should scroll small element from below to align bottom with bottom edge', () => {
    const { container, scrollTo } = createMockContainer(1000) // Range: 200-800 (20%-80%)
    // Current implementation uses 0.20/0.80. 1000 * 0.20 = 200, 1000 * 0.80 = 800.
    const containerRef = ref(container)
    const { handleScrollRequest } = useScrollIntoView(containerRef)

    // Element at 800-900. Below 800.
    const element = createMockElement(800, 100)
    
    handleScrollRequest(element)
    
    // Expected: Align bottom (900) to max (800). Scroll down by 100.
    expect(scrollTo).toHaveBeenCalledWith({
      top: 100,
      behavior: 'smooth'
    })
  })

  it('should scroll large element from below to align top with top edge (Proposed behavior)', () => {
    // This test expects the NEW behavior. It should fail currently.
    
    // Setup: Container Height 1000. 
    // Range (Target): 20% - 80% = 200 - 800. Range Height = 600.
    // Element Height: 800. (Larger than 600).
    // Element Position: Top at 500. Bottom at 1300.
    // Element is "below" the optimal zone (Top > 200).
    // Current Code (25%-75% -> 250-750):
    //   Top 500 > 250. Bottom 1300 > 750.
    //   Small element logic: Align Bottom (1300) to Max (750). Offset = 550.
    //   Result Top = 500 - 550 = -50.
    
    // New Requirement: "Scroll as little as possible so that the entire 'scroll-into-area' is filled"
    // Target: Align Top (500) to Min (200). Offset = 300.
    // Result Top = 200. Bottom = 1000. (Covers 200-800).
    
    const { container, scrollTo } = createMockContainer(1000)
    const containerRef = ref(container)
    const { handleScrollRequest } = useScrollIntoView(containerRef)

    const element = createMockElement(500, 800) 
    
    handleScrollRequest(element)
    
    // We expect scroll to 300 (align top to 200). 
    // Current implementation (0.25/0.75) would scroll to: 1300 - 750 = 550.
    // Even with 0.20/0.80, current implementation would scroll to: 1300 - 800 = 500.
    
    // We verify the desired value.
    expect(scrollTo).toHaveBeenCalledWith({
      top: 300, 
      behavior: 'smooth'
    })
  })
})
