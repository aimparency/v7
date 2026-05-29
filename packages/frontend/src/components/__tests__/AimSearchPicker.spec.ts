import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AimSearchPicker from '../AimSearchPicker.vue'
import { trpc } from '../../trpc'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      search: { query: vi.fn().mockResolvedValue([]) },
      searchSemantic: { query: vi.fn().mockResolvedValue([]) },
      getMany: { query: vi.fn().mockResolvedValue([]) },
      list: { query: vi.fn().mockResolvedValue([]) }
    }
  }
}))

const parentAim = { id: 'parent-1', text: 'Parent aim', status: { state: 'open' }, supportedAims: [], supportingConnections: [], score: 1 }
const childAim = { id: 'child-1', text: 'Child aim', status: { state: 'open' }, supportedAims: ['aim-with-relatives'], supportingConnections: [], score: 1 }
const aimWithRelatives = {
  id: 'aim-with-relatives',
  text: 'Aim with relatives',
  status: { state: 'open' },
  supportedAims: ['parent-1'],
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

describe('AimSearchPicker h/l navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(trpc.aim.getMany.query).mockResolvedValue([parentAim] as any)
    vi.mocked(trpc.aim.list.query).mockResolvedValue([childAim] as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('h on focused result navigates to parents', async () => {
    const wrapper = mount(AimSearchPicker, {
      props: { externalResults: [aimWithRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    const item = wrapper.find('.result-item')
    await item.trigger('click')
    await item.trigger('keydown', { key: 'h' })
    await flushPromises()

    expect(trpc.aim.getMany.query).toHaveBeenCalledWith(
      expect.objectContaining({ aimIds: ['parent-1'] })
    )
    expect(wrapper.text()).toContain('Parent aim')
    expect(wrapper.find('.nav-title').text()).toContain('Parents of:')
  })

  it('l on focused result navigates to children', async () => {
    const wrapper = mount(AimSearchPicker, {
      props: { externalResults: [aimWithRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    const item = wrapper.find('.result-item')
    await item.trigger('click')
    await item.trigger('keydown', { key: 'l' })
    await flushPromises()

    expect(trpc.aim.list.query).toHaveBeenCalledWith(
      expect.objectContaining({ parentAimId: 'aim-with-relatives' })
    )
    expect(wrapper.text()).toContain('Child aim')
    expect(wrapper.find('.nav-title').text()).toContain('Children of:')
  })

  it('h from input navigates to parents when query is empty', async () => {
    const wrapper = mount(AimSearchPicker, {
      props: { externalResults: [aimWithRelatives] as any, showInput: true },
      global: { plugins: [pluginConfig()] }
    })

    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'h' })
    await flushPromises()

    expect(trpc.aim.getMany.query).toHaveBeenCalledWith(
      expect.objectContaining({ aimIds: ['parent-1'] })
    )
    expect(wrapper.text()).toContain('Parent aim')
  })

  it('h from input does not navigate when query is non-empty', async () => {
    const wrapper = mount(AimSearchPicker, {
      props: { showInput: true },
      global: { plugins: [pluginConfig()] }
    })

    const input = wrapper.find('input')
    await input.setValue('h')
    await input.trigger('keydown', { key: 'h' })
    await flushPromises()

    expect(trpc.aim.getMany.query).not.toHaveBeenCalled()
  })

  it('h on result with no parents navigates back in navigation mode', async () => {
    const wrapper = mount(AimSearchPicker, {
      props: { externalResults: [aimWithRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    // Navigate to parents
    const item = wrapper.find('.result-item')
    await item.trigger('click')
    await item.trigger('keydown', { key: 'h' })
    await flushPromises()
    expect(wrapper.find('.nav-title').exists()).toBe(true)

    // parentAim has no parents, so h should go back instead
    const parentItem = wrapper.find('.result-item')
    await parentItem.trigger('click')
    await parentItem.trigger('keydown', { key: 'h' })
    await flushPromises()

    expect(wrapper.find('.nav-title').exists()).toBe(false)
    expect(wrapper.text()).toContain('Aim with relatives')
  })

  it('Escape in navigation mode navigates back', async () => {
    const wrapper = mount(AimSearchPicker, {
      props: { externalResults: [aimWithRelatives] as any },
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
    expect(wrapper.text()).toContain('Aim with relatives')
  })

  it('shows H and L indicators only when relatives exist', async () => {
    const aimNoRelatives = { id: 'lonely', text: 'Lonely aim', status: { state: 'open' }, supportedAims: [], supportingConnections: [], score: 1 }
    const wrapper = mount(AimSearchPicker, {
      props: { externalResults: [aimWithRelatives, aimNoRelatives] as any },
      global: { plugins: [pluginConfig()] }
    })

    const items = wrapper.findAll('.result-item')
    expect(items[0]!.text()).toContain('H ←')
    expect(items[0]!.text()).toContain('→ L')
    expect(items[1]!.text()).not.toContain('H ←')
    expect(items[1]!.text()).not.toContain('→ L')
  })
})
