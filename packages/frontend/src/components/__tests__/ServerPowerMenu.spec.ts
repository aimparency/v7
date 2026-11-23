import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ServerPowerMenu from '../ServerPowerMenu.vue'

const { auth } = vi.hoisted(() => ({
  auth: {
    restartServer: { mutate: vi.fn(async () => ({ restarting: true })) },
    updateServer: { mutate: vi.fn(async () => ({ restarting: true, before: 'aaaaaaaa', after: 'bbbbbbbb', commits: ['bbbbbbb A commit'] })) }
  }
}))
vi.mock('../../trpc', () => ({ trpc: { auth } }))

describe('ServerPowerMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // The server never answers in this test: waiting for it is not what is tested.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  it('restarts after the person confirms, and does nothing when they cancel', async () => {
    const wrapper = mount(ServerPowerMenu, { attachTo: document.body })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    await wrapper.find('button[title="Restart the server"]').trigger('click')
    await wrapper.findAll('.menu-item')[0]!.trigger('click')
    expect(auth.restartServer.mutate).not.toHaveBeenCalled()

    await wrapper.find('button[title="Restart the server"]').trigger('click')
    await wrapper.findAll('.menu-item')[0]!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(auth.restartServer.mutate).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.restarting').text()).toBe('Restarting…')
    wrapper.unmount()
  })

  it('pulls main and restarts', async () => {
    const wrapper = mount(ServerPowerMenu, { attachTo: document.body })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.find('button[title="Restart the server"]').trigger('click')
    await wrapper.findAll('.menu-item')[1]!.trigger('click')
    await flushPromises()
    expect(auth.updateServer.mutate).toHaveBeenCalledTimes(1)
    expect(auth.restartServer.mutate).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
