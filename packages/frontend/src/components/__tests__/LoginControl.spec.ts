import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LoginControl from '../LoginControl.vue'
import { useViewerStore } from '../../stores/viewer'

const { logOutOfServers } = vi.hoisted(() => ({ logOutOfServers: vi.fn(async () => [] as string[]) }))
vi.mock('../../utils/remote-trpc', () => ({ logOutOfServers, remoteTrpc: vi.fn() }))
const { auth, signLoginChallenge, forgetBrowserKey } = vi.hoisted(() => ({
  auth: {
    ownFootprint: { query: vi.fn() },
    discardOwnAccount: { mutate: vi.fn() },
    deleteOwnAccount: { mutate: vi.fn() },
    me: { query: vi.fn() },
    login: { mutate: vi.fn() },
    signUp: { mutate: vi.fn() },
    makePermanent: { mutate: vi.fn() },
    walletChallenge: { mutate: vi.fn() },
    walletLogin: { mutate: vi.fn() },
    keyChallenge: { mutate: vi.fn() },
    keyLogin: { mutate: vi.fn() },
    logout: { mutate: vi.fn() },
    invitationInfo: { query: vi.fn(async (): Promise<{ valid: boolean, space: { slug: string, name: string } | null, right: string | null }> => ({ valid: true, space: null, right: null })) },
    acceptInvitation: { mutate: vi.fn() }
  },
  signLoginChallenge: vi.fn(),
  forgetBrowserKey: vi.fn(async () => {})
}))
vi.mock('../../trpc', () => ({ trpc: { auth } }))
const { openSpace } = vi.hoisted(() => ({ openSpace: vi.fn() }))
vi.mock('../../stores/project-load', () => ({ useProjectLoadStore: () => ({ open: openSpace }) }))
vi.mock('../../utils/runtime-config', () => ({ hasAccounts: () => true }))
vi.mock('../../utils/browser-key', () => ({ signLoginChallenge, forgetBrowserKey }))

const me = (values: object) => ({
  login: 'accounts', agents: false, signUp: { open: false, browserKey: false, wallet: false },
  name: null, serverAdmin: false, canCreateGraphs: false, permanentLogin: true, ...values
})

const mountControl = async (answer: object) => {
  auth.me.query.mockResolvedValue(me(answer))
  const pinia = createPinia()
  setActivePinia(pinia)
  await useViewerStore().load()
  const wrapper = mount(LoginControl, { global: { plugins: [pinia], stubs: { teleport: true, AccountsModal: true, McpConnectModal: true, ServerSettingsModal: true } }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const buttons = (wrapper: Awaited<ReturnType<typeof mountControl>>) => wrapper.findAll('.login-control > button').map(button => button.text())
// A logged-in account's things are in the menu under its name.
const menuItems = async (wrapper: Awaited<ReturnType<typeof mountControl>>) => {
  if (!wrapper.find('.menu').exists()) await wrapper.find('.account-btn').trigger('click')
  return wrapper.findAll('.menu-item').map(item => item.text())
}

describe('LoginControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('offers only a login where sign-up is closed, and logs in without reloading the page', async () => {
    const wrapper = await mountControl({})
    expect(buttons(wrapper)).toEqual(['Log in'])

    auth.login.mutate.mockResolvedValue({ token: 'the-token' })
    auth.me.query.mockResolvedValue(me({ name: 'ana' }))
    await wrapper.find('.login-control > button').trigger('click')
    await wrapper.find('#login-form input').setValue('ana')
    await wrapper.find('#login-form input[type=password]').setValue('ana password')
    await wrapper.find('#login-form').trigger('submit')
    await flushPromises()
    expect(auth.login.mutate).toHaveBeenCalledWith({ name: 'ana', password: 'ana password' })
    expect(localStorage.getItem('aimparency-token')).toBe('the-token')
    expect(wrapper.find('.account-name').text()).toBe('ana')
  })

  it('opens the sign-up for an invitation link and sends its code', async () => {
    window.history.replaceState({}, '', '/?invitation=the-code')
    const wrapper = await mountControl({})
    expect(buttons(wrapper)).toEqual(['Log in', 'Create account'])
    expect(wrapper.text()).toContain('You were invited to this server.')

    auth.signUp.mutate.mockResolvedValue({ token: 'new-token' })
    auth.me.query.mockResolvedValue(me({ name: 'ben' }))
    await wrapper.find('#sign-up-form input').setValue('ben')
    await wrapper.find('#sign-up-form input[type=password]').setValue('ben password')
    await wrapper.find('#sign-up-form').trigger('submit')
    await flushPromises()
    expect(auth.signUp.mutate).toHaveBeenCalledWith({ name: 'ben', password: 'ben password', invitation: 'the-code' })
    expect(window.location.search).toBe('')
    expect(wrapper.find('.account-name').text()).toBe('ben')
  })

  it('an invitation to a space: a new account lands in it, an account that exists takes it once logged in', async () => {
    const invitedToGame = { valid: true, space: { slug: 'game', name: 'Game' }, right: 'write' }
    window.history.replaceState({}, '', '/?invitation=space-code')
    auth.invitationInfo.query.mockResolvedValue(invitedToGame)
    const wrapper = await mountControl({})
    expect(wrapper.text()).toContain('You were invited to the space "Game", to work on it.')
    auth.signUp.mutate.mockResolvedValue({ token: 'new-token', space: 'game' })
    auth.me.query.mockResolvedValue(me({ name: 'david' }))
    await wrapper.find('#sign-up-form input').setValue('david')
    await wrapper.find('#sign-up-form input[type=password]').setValue('david password')
    await wrapper.find('#sign-up-form').trigger('submit')
    await flushPromises()
    expect(openSpace).toHaveBeenCalledWith('game')
    expect(auth.acceptInvitation.mutate).not.toHaveBeenCalled()
    wrapper.unmount()

    window.history.replaceState({}, '', '/?invitation=space-code')
    auth.acceptInvitation.mutate.mockResolvedValue({ space: 'game' })
    await mountControl({ name: 'cleo' })
    expect(auth.acceptInvitation.mutate).toHaveBeenCalledWith({ invitation: 'space-code' })
    expect(openSpace).toHaveBeenCalledTimes(2)
    expect(window.location.search).toBe('')
  })

  it('recommends a permanent login to an account that lives only in this browser', async () => {
    const wrapper = await mountControl({ name: 'guest-1a2b3c', permanentLogin: false })
    expect(await menuItems(wrapper)).toEqual(['Keep account', 'Connect an agent (MCP)', 'Discard account'])

    auth.makePermanent.mutate.mockResolvedValue({ success: true })
    auth.me.query.mockResolvedValue(me({ name: 'Cleo', permanentLogin: true }))
    await wrapper.find('.menu-item.attention').trigger('click')
    await wrapper.find('#permanent-form input').setValue('Cleo')
    await wrapper.find('#permanent-form input[type=password]').setValue('cleo password')
    await wrapper.find('#permanent-form').trigger('submit')
    await flushPromises()
    expect(auth.makePermanent.mutate).toHaveBeenCalledWith({ name: 'Cleo', password: 'cleo password' })
    expect(await menuItems(wrapper)).toEqual(['Connect an agent (MCP)', 'Password', 'Log out', 'Delete account'])
  })

  it('deletes an account with a login of its own once its name is typed; a server admin has no such entry', async () => {
    const wrapper = await mountControl({ name: 'david', permanentLogin: true })
    await menuItems(wrapper)
    await wrapper.find('.menu-item.danger').trigger('click')
    const submit = wrapper.find('button[form=delete-form]')
    expect(submit.attributes('disabled')).toBeDefined()
    await wrapper.find('#delete-form input').setValue('david')
    auth.deleteOwnAccount.mutate.mockResolvedValue({ purgeAt: '2026-12-20T00:00:00.000Z', days: 30 })
    auth.me.query.mockResolvedValue(me({ name: null }))
    await wrapper.find('#delete-form').trigger('submit')
    await flushPromises()
    expect(auth.deleteOwnAccount.mutate).toHaveBeenCalled()
    expect(useViewerStore().name).toBe(null)

    const admin = await mountControl({ name: 'felix', serverAdmin: true, permanentLogin: true })
    expect(await menuItems(admin)).not.toContain('Delete account')
  })

  it('discards an account that lives only in this browser instead of logging it out, saying what goes with it', async () => {
    const wrapper = await mountControl({ name: 'guest-1a2b3c', permanentLogin: false })
    auth.ownFootprint.query.mockResolvedValue({ spaces: ['Cook every Friday'], notes: 2, offers: 1 })
    await menuItems(wrapper)
    await wrapper.findAll('.menu-item').find(item => item.text() === 'Discard account')!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('1 space: Cook every Friday')
    expect(document.body.textContent).toContain('2 notes and 1 offer on other spaces')

    auth.discardOwnAccount.mutate.mockResolvedValue({ success: true })
    auth.me.query.mockResolvedValue(me({ name: null }))
    const discardButton = [...document.querySelectorAll('button.btn-danger')].find(button => button.textContent?.includes('Discard account')) as HTMLButtonElement
    discardButton.click()
    await flushPromises()
    expect(auth.discardOwnAccount.mutate).toHaveBeenCalled()
    expect(forgetBrowserKey).toHaveBeenCalled()
    expect(logOutOfServers).toHaveBeenCalled()
    expect(useViewerStore().name).toBe(null)
  })

  it('logs out of the other servers too, for whose spaces this page held a login', async () => {
    const wrapper = await mountControl({ name: 'Cleo', permanentLogin: true })
    logOutOfServers.mockClear()
    auth.logout.mutate.mockResolvedValue({ success: true })
    auth.me.query.mockResolvedValue(me({ name: null }))
    await menuItems(wrapper)
    await wrapper.findAll('.menu-item').find(item => item.text() === 'Log out')!.trigger('click')
    await flushPromises()
    expect(auth.logout.mutate).toHaveBeenCalled()
    expect(logOutOfServers).toHaveBeenCalled()
    expect(useViewerStore().name).toBe(null)
  })

  it('gives a visitor an account with the browser key the moment one is needed', async () => {
    await mountControl({ signUp: { open: false, browserKey: true, wallet: false } })
    const viewer = useViewerStore()
    expect(viewer.getsAccountAutomatically).toBe(true)

    auth.keyChallenge.mutate.mockResolvedValue({ nonce: 'the-nonce' })
    signLoginChallenge.mockResolvedValue({ publicKey: 'the-key', signature: 'the-signature' })
    auth.keyLogin.mutate.mockResolvedValue({ token: 'key-token' })
    auth.me.query.mockResolvedValue(me({ name: 'guest-1a2b3c', permanentLogin: false, canCreateGraphs: true }))
    expect(await viewer.ensureAccount()).toBe(true)
    expect(auth.keyLogin.mutate).toHaveBeenCalledWith({ nonce: 'the-nonce', publicKey: 'the-key', signature: 'the-signature' })
    expect(localStorage.getItem('aimparency-token')).toBe('key-token')
    expect(viewer.name).toBe('guest-1a2b3c')

    // Already someone: nothing more to do.
    auth.keyChallenge.mutate.mockClear()
    expect(await viewer.ensureAccount()).toBe(true)
    expect(auth.keyChallenge.mutate).not.toHaveBeenCalled()
  })

  it('logs in with a wallet of this browser: it signs the message the server wrote for its account', async () => {
    const request = vi.fn(async ({ method }: { method: string }) =>
      method === 'eth_requestAccounts' ? ['0x52908400098527886E0F7030069857D2E4169EE7'] : method === 'eth_chainId' ? '0x1' : '0xsigned')
    const wrapper = await mountControl({ signUp: { open: false, browserKey: false, wallet: true } })
    // Wallets announce themselves whenever they are ready, also after the page asked.
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'w1', name: 'Test Wallet' }, provider: { request } } }))
    await wrapper.find('.login-control > button').trigger('click')
    const walletButton = wrapper.findAll('button').find(button => button.text() === 'Test Wallet')!

    auth.walletChallenge.mutate.mockResolvedValue({ message: 'Hi' })
    auth.walletLogin.mutate.mockResolvedValue({ token: 'wallet-token' })
    auth.me.query.mockResolvedValue(me({ name: '0x5290…9EE7' }))
    await walletButton.trigger('click')
    await flushPromises()
    expect(auth.walletChallenge.mutate).toHaveBeenCalledWith({ address: '0x52908400098527886E0F7030069857D2E4169EE7', chainId: 1 })
    expect(request).toHaveBeenLastCalledWith({ method: 'personal_sign', params: ['0x4869', '0x52908400098527886E0F7030069857D2E4169EE7'] })
    expect(auth.walletLogin.mutate).toHaveBeenCalledWith({ message: 'Hi', signature: '0xsigned' })
    expect(wrapper.find('.account-name').text()).toBe('0x5290…9EE7')
  })
})
