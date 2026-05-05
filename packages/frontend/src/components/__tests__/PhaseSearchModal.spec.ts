import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import PhaseSearchModal from '../PhaseSearchModal.vue'
import { trpc } from '../../trpc'

vi.mock('../../trpc', () => ({
  trpc: {
    phase: {
      search: { query: vi.fn().mockResolvedValue([]) }
    }
  }
}))

const phase = {
  id: 'phase-1',
  name: 'Release Prep',
  from: Date.UTC(2026, 0, 1),
  to: Date.UTC(2026, 0, 31),
  parent: null
}

function mountPhaseSearchModal() {
  return mount(PhaseSearchModal, {
    global: {
      plugins: [createTestingPinia({
        createSpy: vi.fn,
        initialState: {
          project: {
            projectPath: '/test'
          }
        }
      })]
    }
  })
}

describe('PhaseSearchModal keyboard selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(trpc.phase.search.query).mockResolvedValue([phase] as any)
  })

  it('keeps the phase search open when activating a phase with Shift+Enter', async () => {
    const wrapper = mountPhaseSearchModal()
    await flushPromises()
    await nextTick()

    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(wrapper.emitted('select')).toEqual([
      [{ type: 'phase', data: phase, keepOpen: true }]
    ])
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('closes the phase search when activating a phase with Enter', async () => {
    const wrapper = mountPhaseSearchModal()
    await flushPromises()
    await nextTick()

    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('select')).toEqual([
      [{ type: 'phase', data: phase }]
    ])
    expect(wrapper.emitted('close')).toEqual([[]])
  })
})
