import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import LoopActionsOverlay from '../LoopActionsOverlay.vue'
import { useProjectStore } from '../../stores/project-store'

describe('LoopActionsOverlay', () => {
  beforeEach(() => localStorage.clear())

  const mountOverlay = () => {
    const wrapper = mount(LoopActionsOverlay, {
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })]
      }
    })
    const store = useProjectStore()
    store.showLoop = true
    store.showLoopActionsOverlay = true
    return { wrapper, store }
  }

  it('emits a direct-key command and closes', async () => {
    const { wrapper, store } = mountOverlay()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('action')).toEqual([['create-instance']])
    expect(store.showLoopActionsOverlay).toBe(false)
  })

  it('toggles fullscreen and closes', async () => {
    const { wrapper, store } = mountOverlay()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()

    expect(store.loopMaximized).toBe(true)
    expect(store.showLoopActionsOverlay).toBe(false)
  })

  it('supports keyboard navigation', async () => {
    const { wrapper } = mountOverlay()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('action')).toEqual([['create-instance']])
  })
})
