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

  it('asks for one evaluation after the other; skipping one moves on', () => {
    const store = useUIModalStore()
    store.promptConnectionEvaluations([
      { parentId: 'parent-a', childId: 'child' },
      { parentId: 'parent-b', childId: 'child' }
    ])
    expect([store.connectionDetailsParentId, store.connectionDetailsEvaluate]).toEqual(['parent-a', true])

    store.closeConnectionDetailsModal()
    expect([store.showConnectionDetailsModal, store.connectionDetailsParentId, store.connectionDetailsEvaluate]).toEqual([true, 'parent-b', true])

    store.closeConnectionDetailsModal()
    expect(store.showConnectionDetailsModal).toBe(false)
    expect(store.connectionDetailsEvaluate).toBe(false)
  })
})
