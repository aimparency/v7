import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectSelectionView from './ProjectSelectionView.vue'

const { inspectPath } = vi.hoisted(() => ({ inspectPath: vi.fn() }))
vi.mock('../trpc', () => ({
  trpc: { project: { inspectPath: { query: inspectPath } } },
}))

const mountView = (modelValue: string) => mount(ProjectSelectionView, {
  props: {
    modelValue,
    projectHistory: [],
    discoveredProjects: [],
    scannedRoots: [],
    isRefreshingDiscoveredProjects: false,
  },
})

describe('ProjectSelectionView project kind', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    inspectPath.mockReset()
  })

  it('labels paths with an existing .bowman as Open Project', async () => {
    inspectPath.mockResolvedValue({ bowmanExists: true, matches: [] })
    const wrapper = mountView('/work/existing')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.select-project').text()).toBe('Open Project')
  })

  it('labels paths without a .bowman as New Project', async () => {
    inspectPath.mockResolvedValue({ bowmanExists: false, matches: [] })
    const wrapper = mountView('/work/fresh')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.select-project').text()).toBe('New Project')
  })

  it('shows the common folder completion and accepts it with Tab', async () => {
    inspectPath.mockResolvedValue({
      bowmanExists: false,
      matches: ['/work/projects-alpha', '/work/projects-beta'],
    })
    const wrapper = mountView('/work/pro')
    await vi.advanceTimersByTimeAsync(200)

    expect(wrapper.find('.path-completion').text()).toContain('jects-')
    await wrapper.find('input').trigger('keydown', { key: 'Tab' })
    const updates = wrapper.emitted('update:modelValue') ?? []
    expect(updates[updates.length - 1]).toEqual(['/work/projects-'])
  })
})
