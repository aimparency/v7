import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ADMIN_SHELL_WARNING } from 'shared'
import AccountsModal from '../AccountsModal.vue'

const { createAccount, setRights, listAccounts } = vi.hoisted(() => ({
  createAccount: vi.fn().mockResolvedValue(undefined),
  setRights: vi.fn().mockResolvedValue(undefined),
  listAccounts: vi.fn().mockResolvedValue([{ name: 'ana', serverAdmin: false, canCreateGraphs: false }])
}))
vi.mock('../../trpc', () => ({
  trpc: { auth: { createAccount: { mutate: createAccount }, setRights: { mutate: setRights }, listAccounts: { query: listAccounts } } }
}))

const mountModal = async () => {
  const wrapper = mount(AccountsModal, { props: { me: 'felix' }, global: { stubs: { teleport: true } } })
  await flushPromises()
  return wrapper
}

describe('AccountsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAccounts.mockResolvedValue([{ name: 'ana', serverAdmin: false, canCreateGraphs: false }])
  })

  it('shows what server admin hands over', async () => {
    expect((await mountModal()).text()).toContain(ADMIN_SHELL_WARNING)
  })

  it('makes a server admin only after confirming the shell warning, and puts the box back when declined', async () => {
    const wrapper = await mountModal()
    const [createsGraphs, serverAdmin] = wrapper.findAll('.row input[type=checkbox]')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    await serverAdmin!.setValue(true)
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(ADMIN_SHELL_WARNING))
    expect(setRights).not.toHaveBeenCalled()
    expect((serverAdmin!.element as HTMLInputElement).checked).toBe(false)

    listAccounts.mockResolvedValue([{ name: 'ana', serverAdmin: true, canCreateGraphs: false }])
    await serverAdmin!.setValue(true)
    await flushPromises()
    expect(setRights).toHaveBeenCalledWith({ name: 'ana', serverAdmin: true })
    expect((serverAdmin!.element as HTMLInputElement).checked).toBe(true)

    // Creating graphs is no shell: nothing to confirm.
    setRights.mockClear()
    confirm.mockClear()
    await createsGraphs!.setValue(true)
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(setRights).toHaveBeenCalledWith({ name: 'ana', canCreateGraphs: true })
  })

  it('adds an account with no server-wide rights', async () => {
    const wrapper = await mountModal()
    const form = wrapper.find('form')
    await form.find('input.name').setValue('ben')
    await form.find('input[type=password]').setValue('long enough')
    await form.trigger('submit')
    await flushPromises()
    expect(createAccount).toHaveBeenCalledWith({ name: 'ben', password: 'long enough' })
  })
})
