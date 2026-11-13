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
