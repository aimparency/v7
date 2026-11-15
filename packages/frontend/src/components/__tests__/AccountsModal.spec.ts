import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ADMIN_SHELL_WARNING } from 'shared'
import AccountsModal from '../AccountsModal.vue'

const { createAccount, setRights, listAccounts, listInvitations, createInvitation } = vi.hoisted(() => ({
  listInvitations: vi.fn().mockResolvedValue([]),
  createInvitation: vi.fn().mockResolvedValue({ code: 'the-code' }),
  createAccount: vi.fn().mockResolvedValue(undefined),
  setRights: vi.fn().mockResolvedValue(undefined),
  listAccounts: vi.fn().mockResolvedValue([{ name: 'ana', serverAdmin: false, canCreateGraphs: false }])
}))
vi.mock('../../trpc', () => ({
  trpc: {
    auth: {
      createAccount: { mutate: createAccount }, setRights: { mutate: setRights }, listAccounts: { query: listAccounts },
      listInvitations: { query: listInvitations }, createInvitation: { mutate: createInvitation }
    }
  }
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
    listInvitations.mockResolvedValue([])
    createInvitation.mockResolvedValue({ code: 'the-code' })
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

  it('makes an invitation link, shown once, and lists who used the earlier ones', async () => {
    listInvitations.mockResolvedValue([{ id: 'first', kind: 'once', expiresAt: null, canCreateGraphs: false, redeemedBy: 'ben', createdAt: '' }])
    const wrapper = await mountModal()
    expect(wrapper.text()).toContain('for one person · used by ben')

    const form = wrapper.findAll('form')[1]!
    await form.find('input[type=checkbox]').setValue(false)
    await form.find('input[type=number]').setValue(7)
    await form.trigger('submit')
    await flushPromises()
    expect(createInvitation).toHaveBeenCalledWith({ kind: 'permanent', days: 7 })
    expect(wrapper.find('code').text()).toBe(`${window.location.origin}/?invitation=the-code`)
  })

  it('gives an invitation the rights of an account: server admin only for one person, after confirming', async () => {
    listInvitations.mockResolvedValue([{ id: 'first', kind: 'once', expiresAt: null, serverAdmin: true, canCreateGraphs: true, redeemedBy: null, createdAt: '' }])
    const wrapper = await mountModal()
    expect(wrapper.text()).toContain('for one person · no end · server admin · creates graphs')

    const form = wrapper.find('form.invite')
    const [once, createsGraphs, serverAdmin] = form.findAll('input[type=checkbox]')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await createsGraphs!.setValue(true)
    await serverAdmin!.setValue(true)
    await form.trigger('submit')
    await flushPromises()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(ADMIN_SHELL_WARNING))
    expect(createInvitation).toHaveBeenCalledWith({ kind: 'once', serverAdmin: true, canCreateGraphs: true })

    // A link for anyone never makes a server admin.
    await once!.setValue(false)
    expect((serverAdmin!.element as HTMLInputElement).disabled).toBe(true)
    await form.trigger('submit')
    await flushPromises()
    expect(createInvitation).toHaveBeenLastCalledWith({ kind: 'permanent', canCreateGraphs: true })
  })
})
