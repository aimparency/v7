import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type DOMWrapper } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import AimSearchModal from '../AimSearchModal.vue'
import { trpc } from '../../trpc'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      search: { query: vi.fn().mockResolvedValue([]) },
      searchSemantic: { query: vi.fn().mockResolvedValue([]) },
      get: { query: vi.fn() }
    }
  }
}))

describe('AimSearchModal', () => {
  let wrapper: any
  
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(trpc.aim.get.query).mockResolvedValue({
      id: 'a1',
      text: 'Test aim',
      status: { state: 'open' }
    } as any)

    wrapper = mount(AimSearchModal, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          initialState: {
            data: {
                meta: { statuses: [{key:'open', color:'#fff'}, {key:'done', color:'#0f0'}] }
            },
            project: {
                projectPath: '/test',
                currentView: 'columns'
            }
          }
        })]
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders search input and filter bar', () => {
    expect(wrapper.find('input[placeholder="Go to aim..."]').exists()).toBe(true)
    expect(wrapper.find('.filter-bar').exists()).toBe(true)
  })

  it('filters trigger search', async () => {
    const input = wrapper.find('input[placeholder="Go to aim..."]')
    await input.setValue('test')

    await vi.advanceTimersByTimeAsync(200)
    
    expect(trpc.aim.search.query).toHaveBeenCalledWith(expect.objectContaining({
        query: 'test',
        status: undefined,
        archived: false
    }))
    
    // Toggle Archived
    // Find the archived checkbox (it's the one with label "Archived")
    const labels = wrapper.findAll('.checkbox-label')
    const archivedLabel = labels.find((l: DOMWrapper<Element>) => l.text().includes('Archived'))
    await archivedLabel.find('input').setValue(true)
    await vi.advanceTimersByTimeAsync(200)
    
    expect(trpc.aim.search.query).toHaveBeenCalledWith(expect.objectContaining({
        query: 'test',
        archived: true
    }))
    
    // Toggle Status Dropdown
    await wrapper.find('.filter-btn').trigger('click')
    const dropdownItems = wrapper.findAll('.dropdown-item')
    const openStatus = dropdownItems.filter((i: DOMWrapper<Element>) => i.text().includes('open'))[0]
    await openStatus.trigger('click')
    await vi.advanceTimersByTimeAsync(200)
    
    expect(trpc.aim.search.query).toHaveBeenCalledWith(expect.objectContaining({
        query: 'test',
        status: ['open']
    }))
  })

  it('emits aim selection directly in graph view', async () => {
    vi.mocked(trpc.aim.search.query).mockResolvedValue([
      { id: 'a1', text: 'Graph aim', status: { state: 'open' }, score: 0.7 } as any
    ])
    vi.mocked(trpc.aim.searchSemantic.query).mockResolvedValue([])
    vi.mocked(trpc.aim.get.query).mockResolvedValue({
      id: 'a1',
      text: 'Graph aim',
      status: { state: 'open' }
    } as any)

    wrapper.unmount()
    wrapper = mount(AimSearchModal, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          initialState: {
            data: {
              meta: { statuses: [{ key: 'open', color: '#fff' }] }
            },
            project: {
              projectPath: '/test',
              currentView: 'graph'
            }
          }
        })]
      }
    })

    const input = wrapper.find('input[placeholder="Go to aim..."]')
    await input.setValue('graph')
    await vi.advanceTimersByTimeAsync(200)

    const result = wrapper.find('.result-item')
    expect(result.exists()).toBe(true)

    await result.trigger('click')

    expect(wrapper.emitted('select')).toEqual([
      [{ type: 'aim', data: { id: 'a1', text: 'Graph aim', status: { state: 'open' } } }]
    ])
  })

  it('shows a server error instead of no-results when search fails', async () => {
    vi.mocked(trpc.aim.search.query).mockRejectedValueOnce(new Error('Embedder unavailable'))

    const input = wrapper.find('input[placeholder="Go to aim..."]')
    await input.setValue('broken')
    await vi.advanceTimersByTimeAsync(200)

    expect(wrapper.text()).toContain('Search failed: Embedder unavailable')
    expect(wrapper.text()).not.toContain('No aims found.')
  })

  it('keeps pick-mode search open when activating an aim with Shift+Enter', async () => {
    vi.mocked(trpc.aim.search.query).mockResolvedValue([
      { id: 'a1', text: 'Parent aim', status: { state: 'open' }, score: 0.8 } as any
    ])
    vi.mocked(trpc.aim.searchSemantic.query).mockResolvedValue([])
    vi.mocked(trpc.aim.get.query).mockResolvedValue({
      id: 'a1',
      text: 'Parent aim',
      status: { state: 'open' }
    } as any)

    wrapper.unmount()
    wrapper = mount(AimSearchModal, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          initialState: {
            'ui-modal': {
              aimSearchMode: 'pick'
            },
            data: {
              meta: { statuses: [{ key: 'open', color: '#fff' }] }
            },
            project: {
              projectPath: '/test',
              currentView: 'columns'
            }
          }
        })]
      }
    })

    const input = wrapper.find('input[placeholder="Go to aim..."]')
    await input.setValue('parent')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.result-item').exists()).toBe(true)

    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    await flushPromises()
    await nextTick()

    expect(wrapper.emitted('select')).toEqual([
      [{ type: 'aim', data: { id: 'a1', text: 'Parent aim', status: { state: 'open' } }, keepOpen: true }]
    ])
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('closes pick-mode search when activating an aim with Enter', async () => {
    vi.mocked(trpc.aim.search.query).mockResolvedValue([
      { id: 'a1', text: 'Parent aim', status: { state: 'open' }, score: 0.8 } as any
    ])
    vi.mocked(trpc.aim.searchSemantic.query).mockResolvedValue([])
    vi.mocked(trpc.aim.get.query).mockResolvedValue({
      id: 'a1',
      text: 'Parent aim',
      status: { state: 'open' }
    } as any)

    wrapper.unmount()
    wrapper = mount(AimSearchModal, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          initialState: {
            'ui-modal': {
              aimSearchMode: 'pick'
            },
            data: {
              meta: { statuses: [{ key: 'open', color: '#fff' }] }
            },
            project: {
              projectPath: '/test',
              currentView: 'columns'
            }
          }
        })]
      }
    })

    const input = wrapper.find('input[placeholder="Go to aim..."]')
    await input.setValue('parent')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.result-item').exists()).toBe(true)

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await nextTick()

    expect(wrapper.emitted('select')).toEqual([
      [{ type: 'aim', data: { id: 'a1', text: 'Parent aim', status: { state: 'open' } } }]
    ])
    expect(wrapper.emitted('close')).toEqual([[]])
  })
})
