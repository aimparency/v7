import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUIModalStore } from './modal-store'

describe('modal continuation order', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens the next prompt only after connection details close', () => {
    const store = useUIModalStore()
    const continueFlow = vi.fn(() => {
      store.openPhaseSearchPrompt()
    })

    store.openConnectionDetailsModal('parent', 'child', continueFlow)
    expect(store.showConnectionDetailsModal).toBe(true)
    expect(store.showPhaseSearchPrompt).toBe(false)

    store.closeConnectionDetailsModal()
    expect(store.showConnectionDetailsModal).toBe(false)
    expect(continueFlow).toHaveBeenCalledOnce()
    expect(store.showPhaseSearchPrompt).toBe(true)
  })
})
