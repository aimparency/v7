import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import McpOffer from '../McpOffer.vue'
import { useViewerStore } from '../../stores/viewer'

const { listTokens } = vi.hoisted(() => ({ listTokens: vi.fn(async () => [] as { label: string }[]) }))
vi.mock('../../trpc', () => ({ trpc: { auth: { listTokens: { query: listTokens } } } }))
// Read when the component asks, after beforeEach has made them.
vi.mock('../../stores/project-load', () => ({ useProjectLoadStore: () => loadState }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: () => projectState }))
vi.mock('../../utils/runtime-config', () => ({ hasAccounts: () => true }))

let loadState: { status: string }
let projectState: { projectPath: string }

const mountOffer = async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  useViewerStore().name = 'david'
  const wrapper = mount(McpOffer, { global: { plugins: [pinia], stubs: { McpConnectModal: true } } })
  await flushPromises()
  return wrapper
}
// A space opens: its load goes from loading to done.
const openSpace = async (path = 'game') => {
  projectState.projectPath = path
  loadState.status = 'loading'
  await flushPromises()
  loadState.status = 'idle'
  await flushPromises()
}

describe('McpOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    loadState = reactive({ status: 'idle' })
    projectState = reactive({ projectPath: '' })
  })

  it('offers an assistant each time a space opens, until "not now" three times', async () => {
    const wrapper = await mountOffer()
    expect(wrapper.find('.mcp-offer').exists()).toBe(false)
    for (let time = 1; time <= 3; time++) {
      await openSpace()
      expect(wrapper.find('.mcp-offer').exists()).toBe(true)
      await wrapper.find('.btn-secondary').trigger('click')
      expect(wrapper.find('.mcp-offer').exists()).toBe(false)
    }
    await openSpace()
    expect(wrapper.find('.mcp-offer').exists()).toBe(false)
  })

  it('is silent for an account with an assistant connected', async () => {
    listTokens.mockResolvedValue([{ label: 'browser' }, { label: 'claude' }])
    const wrapper = await mountOffer()
    await openSpace()
    expect(wrapper.find('.mcp-offer').exists()).toBe(false)
  })

  it('opens the connect dialog', async () => {
    listTokens.mockResolvedValue([{ label: 'browser' }])
    const wrapper = await mountOffer()
    await openSpace()
    await wrapper.find('.btn-primary').trigger('click')
    expect(wrapper.find('.mcp-offer').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'McpConnectModal' }).exists()).toBe(true)
  })
})
