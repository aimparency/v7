import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, type DOMWrapper } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
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
    wrapper = mount(AimSearchModal, {
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          initialState: {
            data: {
                meta: { statuses: [{key:'open', color:'#fff'}, {key:'done', color:'#0f0'}] }
            },
            ui: {
                projectPath: '/test'
            }
          }
        })]
      }
    })
  })

  it('renders search input and filter bar', () => {
    expect(wrapper.find('input[placeholder="Go to aim..."]').exists()).toBe(true)
    expect(wrapper.find('.filter-bar').exists()).toBe(true)
  })

  it('filters trigger search', async () => {
    const input = wrapper.find('input[placeholder="Go to aim..."]')
    await input.setValue('test')
    
    // Wait for debounce (mock timers or sleep)
    // For simplicity, we can inspect calls after a delay or assume immediate update if we force it.
    // The component uses debounce: setTimeout 150ms.
    // We should use vi.useFakeTimers().
    
    await new Promise(r => setTimeout(r, 200)) // Hack if using real timers
    
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
    
    expect(trpc.aim.search.query).toHaveBeenCalledWith(expect.objectContaining({
        query: 'test',
        archived: true
    }))
    
    // Toggle Status Dropdown
    await wrapper.find('.filter-btn').trigger('click')
    const dropdownItems = wrapper.findAll('.dropdown-item')
    const openStatus = dropdownItems.filter((i: DOMWrapper<Element>) => i.text().includes('open'))[0]
    await openStatus.trigger('click')
    
    expect(trpc.aim.search.query).toHaveBeenCalledWith(expect.objectContaining({
        query: 'test',
        status: ['open']
    }))
  })
})
