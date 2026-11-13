import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import McpConnectModal from '../McpConnectModal.vue'

const { listGraphs, listTokens, issueToken, revokeOwnToken } = vi.hoisted(() => ({
  listGraphs: vi.fn(), listTokens: vi.fn(), issueToken: vi.fn(), revokeOwnToken: vi.fn()
}))
vi.mock('../../trpc', () => ({
  trpc: {
    graphs: { list: { query: listGraphs } },
    auth: { listTokens: { query: listTokens }, issueToken: { mutate: issueToken }, revokeOwnToken: { mutate: revokeOwnToken } }
  }
}))

const mountModal = async () => {
  const wrapper = mount(McpConnectModal, { global: { stubs: { teleport: true } }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('McpConnectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listGraphs.mockResolvedValue([
      { slug: 'mine', name: 'Mine', right: 'owner' }, { slug: 'shared', name: 'Shared', right: 'write' }, { slug: 'theirs', name: 'Theirs', right: 'read' }
    ])
    listTokens.mockResolvedValue([
      { id: 'b1', label: 'browser', createdAt: new Date().toISOString(), graphs: null },
      { id: 'm1', label: 'laptop', createdAt: new Date().toISOString(), graphs: ['mine'] }
    ])
    issueToken.mockResolvedValue({ token: 'the-token' })
    revokeOwnToken.mockResolvedValue({ success: true })
  })

  it('gives a client all graphs by default, through the server\'s address', async () => {
    const wrapper = await mountModal()
    await wrapper.find('form input').setValue('laptop')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(issueToken).toHaveBeenCalledWith({ label: 'laptop', graphs: undefined })
    expect(wrapper.find('code').text()).toBe(`${window.location.origin}/mcp/sse?token=the-token`)
  })

  it('limits a client to chosen graphs the account writes; one graph gets its own address', async () => {
    const wrapper = await mountModal()
    await wrapper.findAll('input[type=radio]')[1]!.setValue(true)
    expect(wrapper.findAll('.graphs label').map(label => label.text())).toEqual(['Mine', 'Shared'])
    await flushPromises()
    expect(wrapper.find('form button').attributes('disabled')).toBeDefined()

    await wrapper.findAll('.graphs input')[0]!.setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(issueToken).toHaveBeenCalledWith({ label: 'mcp', graphs: ['mine'] })
    expect(wrapper.find('code').text()).toBe(`${window.location.origin}/g/mine/mcp/sse?token=the-token`)
  })

  it('lists the connected clients, not the browsers, and revokes one', async () => {
    const wrapper = await mountModal()
    expect(wrapper.findAll('.row .grow').filter(row => row.element.tagName === 'SPAN').map(row => row.text().split(' · ').slice(0, 2).join(' · ')))
      .toEqual(['laptop · mine'])
    await wrapper.find('.row .btn-secondary').trigger('click')
    await flushPromises()
    expect(revokeOwnToken).toHaveBeenCalledWith({ id: 'm1' })
  })
})

describe('McpAuthorizeModal', () => {
  const { pending, approve, deny } = vi.hoisted(() => ({ pending: vi.fn(), approve: vi.fn(), deny: vi.fn() }))

  it('shows who asks, lets the person choose graphs and sends the browser back with the approval', async () => {
    const { trpc } = await import('../../trpc') as unknown as { trpc: Record<string, unknown> }
    trpc.mcpAuth = { pending: { query: pending }, approve: { mutate: approve }, deny: { mutate: deny } }
    pending.mockResolvedValue({ clientName: 'Coding agent', redirectHost: 'localhost:7777' })
    approve.mockResolvedValue({ redirectTo: 'http://localhost:7777/callback?code=abc' })
    const location = { href: '' }
    vi.stubGlobal('location', location)

    const { default: McpAuthorizeModal } = await import('../McpAuthorizeModal.vue')
    const { createTestingPinia } = await import('@pinia/testing')
    const wrapper = mount(McpAuthorizeModal, {
      props: { requestId: 'r1' },
      global: {
        plugins: [createTestingPinia({ createSpy: vi.fn, initialState: { viewer: { name: 'ana', signUp: { open: false, browserKey: false, wallet: false } } } })],
        stubs: { teleport: true, LoginControl: true }
      },
      attachTo: document.body
    })
    const { useViewerStore } = await import('../../stores/viewer')
    vi.mocked(useViewerStore().ensureAccount).mockResolvedValue(true)
    await flushPromises()
    expect(wrapper.text()).toContain('Coding agent asks to act as you on this server')
    expect(wrapper.text()).toContain('localhost:7777')

    await wrapper.findAll('input[type=radio]')[1]!.setValue(true)
    await flushPromises()
    await wrapper.findAll('.graphs input')[1]!.setValue(true)
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()
    expect(approve).toHaveBeenCalledWith({ requestId: 'r1', graphs: ['shared'] })
    expect(location.href).toBe('http://localhost:7777/callback?code=abc')
    vi.unstubAllGlobals()
  })
})
