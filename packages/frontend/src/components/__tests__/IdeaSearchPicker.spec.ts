import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import IdeaSearchPicker from '../IdeaSearchPicker.vue'
import { trpc } from '../../trpc'

vi.mock('../../trpc', () => ({
  trpc: {
    idea: {
      search: { query: vi.fn().mockResolvedValue([]) },
      searchSemantic: { query: vi.fn().mockResolvedValue([]) },
      getMany: { query: vi.fn().mockResolvedValue([]) },
      list: { query: vi.fn().mockResolvedValue([]) }
    }
  }
}))

const parentIdea = { id: 'parent-1', text: 'Parent idea', status: { state: 'open' }, supportedIdeas: [], supportingConnections: [], score: 1 }
const childIdea = { id: 'child-1', text: 'Child idea', status: { state: 'open' }, supportedIdeas: ['idea-with-relatives'], supportingConnections: [], score: 1 }
const ideaWithRelatives = {
  id: 'idea-with-relatives',
  text: 'Idea with relatives',
  status: { state: 'open' },
  supportedIdeas: ['parent-1'],
  supportingConnections: ['child-1'],
  score: 1
}

const pluginConfig = () => createTestingPinia({
  createSpy: vi.fn,
  initialState: {
    data: { meta: { statuses: [{ key: 'open', color: '#fff' }] } },
    project: { projectPath: '/test', currentView: 'columns' }
  }
})

describe('IdeaSearchPicker h/l navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(trpc.idea.getMany.query).mockResolvedValue([parentIdea] as any)
    vi.mocked(trpc.idea.list.query).mockResolvedValue([childIdea] as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('h on focused result navigates to parents', async () => {
    const wrapper = mount(IdeaSearchPicker, {
      props: { externalResults: [ideaWithRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    const item = wrapper.find('.result-item')
    await item.trigger('click')
    await item.trigger('keydown', { key: 'h' })
    await flushPromises()

    expect(trpc.idea.getMany.query).toHaveBeenCalledWith(
      expect.objectContaining({ ideaIds: ['parent-1'] })
    )
    expect(wrapper.text()).toContain('Parent idea')
    expect(wrapper.find('.nav-title').text()).toContain('Parents of:')
  })

  it('l on focused result navigates to children', async () => {
    const wrapper = mount(IdeaSearchPicker, {
      props: { externalResults: [ideaWithRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    const item = wrapper.find('.result-item')
    await item.trigger('click')
    await item.trigger('keydown', { key: 'l' })
    await flushPromises()

    expect(trpc.idea.list.query).toHaveBeenCalledWith(
      expect.objectContaining({ parentIdeaId: 'idea-with-relatives' })
    )
    expect(wrapper.text()).toContain('Child idea')
    expect(wrapper.find('.nav-title').text()).toContain('Children of:')
  })

  it('h from input navigates to parents when query is empty', async () => {
    const wrapper = mount(IdeaSearchPicker, {
      props: { externalResults: [ideaWithRelatives] as any, showInput: true },
      global: { plugins: [pluginConfig()] }
    })

    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'h' })
    await flushPromises()

    expect(trpc.idea.getMany.query).toHaveBeenCalledWith(
      expect.objectContaining({ ideaIds: ['parent-1'] })
    )
    expect(wrapper.text()).toContain('Parent idea')
  })

  it('h from input does not navigate when query is non-empty', async () => {
    const wrapper = mount(IdeaSearchPicker, {
      props: { showInput: true },
      global: { plugins: [pluginConfig()] }
    })

    const input = wrapper.find('input')
    await input.setValue('h')
    await input.trigger('keydown', { key: 'h' })
    await flushPromises()

    expect(trpc.idea.getMany.query).not.toHaveBeenCalled()
  })

  it('h on result with no parents navigates back in navigation mode', async () => {
    const wrapper = mount(IdeaSearchPicker, {
      props: { externalResults: [ideaWithRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    // Navigate to parents
    const item = wrapper.find('.result-item')
    await item.trigger('click')
    await item.trigger('keydown', { key: 'h' })
    await flushPromises()
    expect(wrapper.find('.nav-title').exists()).toBe(true)

    // parentIdea has no parents, so h should go back instead
    const parentItem = wrapper.find('.result-item')
    await parentItem.trigger('click')
    await parentItem.trigger('keydown', { key: 'h' })
    await flushPromises()

    expect(wrapper.find('.nav-title').exists()).toBe(false)
    expect(wrapper.text()).toContain('Idea with relatives')
  })

  it('Escape in navigation mode navigates back', async () => {
    const wrapper = mount(IdeaSearchPicker, {
      props: { externalResults: [ideaWithRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    const item = wrapper.find('.result-item')
    await item.trigger('click')
    await item.trigger('keydown', { key: 'h' })
    await flushPromises()
    expect(wrapper.find('.nav-title').exists()).toBe(true)

    // Re-find after DOM update to avoid stale reference
    await wrapper.find('.result-item').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.find('.nav-title').exists()).toBe(false)
    expect(wrapper.text()).toContain('Idea with relatives')
  })

  it('shows idea title bold with parent path below in smaller text', async () => {
    const childWithParent = {
      id: 'child-with-parent',
      text: 'Child idea',
      status: { state: 'open' },
      supportedIdeas: ['parent-1'],
      supportingConnections: [],
      score: 1
    }

    const wrapper = mount(IdeaSearchPicker, {
      props: { externalResults: [childWithParent] as any },
      global: {
        plugins: [createTestingPinia({
          createSpy: vi.fn,
          initialState: {
            data: {
              meta: { statuses: [{ key: 'open', color: '#fff' }] },
              ideas: {
                'parent-1': parentIdea,
                'child-with-parent': childWithParent
              }
            },
            project: { projectPath: '/test', currentView: 'columns' }
          }
        })]
      }
    })

    const item = wrapper.find('.result-item')
    expect(item.find('.idea-title').text()).toBe('Child idea')
    expect(item.find('.idea-path').text()).toBe('Parent idea')
  })

  it('shows H and L indicators only when relatives exist', async () => {
    const ideaNoRelatives = { id: 'lonely', text: 'Lonely idea', status: { state: 'open' }, supportedIdeas: [], supportingConnections: [], score: 1 }
    const wrapper = mount(IdeaSearchPicker, {
      props: { externalResults: [ideaWithRelatives, ideaNoRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    const items = wrapper.findAll('.result-item')
    expect(items[0]!.text()).toContain('H ←')
    expect(items[0]!.text()).toContain('→ L')
    expect(items[1]!.text()).not.toContain('H ←')
    expect(items[1]!.text()).not.toContain('→ L')
  })
})
