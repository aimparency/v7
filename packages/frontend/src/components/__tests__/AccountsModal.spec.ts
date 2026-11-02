import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ADMIN_SHELL_WARNING } from 'shared'
import AccountsModal from '../AccountsModal.vue'

const { createUser, setRole, listUsers } = vi.hoisted(() => ({
  createUser: vi.fn().mockResolvedValue(undefined),
  setRole: vi.fn().mockResolvedValue(undefined),
  listUsers: vi.fn().mockResolvedValue([{ name: 'ana', role: 'write' }])
}))
vi.mock('../../trpc', () => ({
  trpc: { auth: { createUser: { mutate: createUser }, setRole: { mutate: setRole }, listUsers: { query: listUsers } } }
}))

const mountModal = async () => {
  const wrapper = mount(AccountsModal, { props: { me: 'felix' }, global: { stubs: { teleport: true } } })
  await flushPromises()
  return wrapper
}

describe('AccountsModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows what admin hands over', async () => {
    expect((await mountModal()).text()).toContain(ADMIN_SHELL_WARNING)
  })

  it('promotes to admin only after confirming the shell warning, and puts the role back when declined', async () => {
    const wrapper = await mountModal()
    const select = wrapper.find('.row select')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    await select.setValue('admin')
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(ADMIN_SHELL_WARNING))
    expect(setRole).not.toHaveBeenCalled()
    expect((select.element as HTMLSelectElement).value).toBe('write')

    await select.setValue('admin')
    await flushPromises()
    expect(setRole).toHaveBeenCalledWith({ name: 'ana', role: 'admin' })
  })

  it('adds write accounts without asking, admins only after confirming', async () => {
    const wrapper = await mountModal()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const form = wrapper.find('form')
    await form.find('input.name').setValue('ben')
    await form.find('input[type=password]').setValue('long enough')

    await form.trigger('submit')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(createUser).toHaveBeenCalledWith({ name: 'ben', role: 'write', password: 'long enough' })

    createUser.mockClear()
    await form.find('input.name').setValue('cleo')
    await form.find('input[type=password]').setValue('long enough')
    await form.find('select').setValue('admin')
    await form.trigger('submit')
    await flushPromises()
    expect(confirm).toHaveBeenCalledOnce()
    expect(createUser).not.toHaveBeenCalled()
  })
})
