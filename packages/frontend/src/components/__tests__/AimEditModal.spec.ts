import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AimEditModal from '../AimEditModal.vue'
import { useDataStore } from '../../stores/data'
import { useProjectStore } from '../../stores/project-store'
import { useUIModalStore } from '../../stores/ui/modal-store'

vi.mock('../../trpc', () => ({
  trpc: {
    aim: {
      list: { query: vi.fn().mockResolvedValue([]) },
      commitEvidence: { query: vi.fn().mockResolvedValue([]) },
      linkRepo: { mutate: vi.fn().mockResolvedValue({}) },
      unlinkRepo: { mutate: vi.fn().mockResolvedValue({}) }
    },
    phase: {
      get: { query: vi.fn().mockResolvedValue(null) }
    }
  }
}))

function mountEditModal(description = 'Old description', statusState = 'open', archivedFlag = false) {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: {
      'ui-project': {
        projectPath: '/test/project'
      },
      data: {
        aims: {
          'aim-1': {
            id: 'aim-1',
            text: 'Old title',
            description,
            tags: [],
            status: { state: statusState, comment: '' },
            archived: archivedFlag,
            intrinsicValue: 0,
            cost: 1,
            loopWeight: 1,
            reflection: '',
            supportedAims: [],
            supportingConnections: [],
            incoming: [],
            committedIn: []
          }
        },
        meta: {
          statuses: [{ key: 'open', color: '#fff', ongoing: true }, { key: 'done', color: '#0f0', ongoing: false }]
        }
      }
    }
  })

  const wrapper = mount(AimEditModal, {
    props: {
      show: false,
      aimId: 'aim-1'
    },
    global: {
      plugins: [pinia]
    }
  })

  const dataStore = useDataStore(pinia)
  const projectStore = useProjectStore(pinia)
  dataStore.aims['aim-1'] = {
    id: 'aim-1',
    text: 'Old title',
    description,
    tags: [],
    status: { state: statusState, comment: '', date: Date.now() },
    archived: archivedFlag,
    intrinsicValue: 0,
    cost: 1,
    loopWeight: 1,
    reflection: '',
    supportedAims: [],
    supportingConnections: [],
    committedIn: []
  } as any
  projectStore.projectPath = '/test/project'

  return { wrapper, dataStore }
}

function mountBulkEditModal() {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: {
      'ui-project': { projectPath: '/test/project' },
      data: {
        aims: {
          'aim-1': {
            id: 'aim-1',
            text: 'First title',
            description: 'First description',
            tags: ['first'],
            status: { state: 'open', comment: '' },
            archived: false,
            intrinsicValue: 1,
            cost: 1,
            loopWeight: 1,
            reflection: '',
            supportedAims: [],
            supportingConnections: [],
            committedIn: []
          },
          'aim-2': {
            id: 'aim-2',
            text: 'Second title',
            description: 'Second description',
            tags: ['second'],
            status: { state: 'done', comment: 'Finished' },
            archived: true,
            intrinsicValue: 2,
            cost: 2,
            loopWeight: 2,
            reflection: 'Learned',
            supportedAims: [],
            supportingConnections: [],
            committedIn: []
          }
        },
        meta: {
          statuses: [
            { key: 'open', color: '#fff', ongoing: true },
            { key: 'done', color: '#0f0', ongoing: false }
          ]
        }
      }
    }
  })
  const dataStore = useDataStore(pinia)
  const projectStore = useProjectStore(pinia)
  projectStore.projectPath = '/test/project'
  const wrapper = mount(AimEditModal, {
    props: { show: false, aimId: 'aim-1', aimIds: ['aim-1', 'aim-2'] },
    global: { plugins: [pinia] }
  })
  return { wrapper, dataStore }
}

describe('AimEditModal keyboard save behavior', () => {
  it('shows Git commits that realize the selected aim', async () => {
    const { trpc } = await import('../../trpc')
    vi.mocked(trpc.aim.commitEvidence.query).mockResolvedValueOnce([{
      hash: '0123456789012345678901234567890123456789',
      shortHash: '01234567',
      subject: 'feat: realize aim aim-1',
      author: 'Codex',
      authoredAt: '2026-07-21T18:00:00+02:00'
    }])
    const { wrapper } = mountEditModal()

    await wrapper.setProps({ show: true })
    await vi.waitFor(() => expect(wrapper.text()).toContain('feat: realize aim aim-1'))

    expect(wrapper.text()).toContain('01234567')
  })

  it('does not persist bulk mixed fields until Save and only overrides activated fields', async () => {
    const { wrapper, dataStore } = mountBulkEditModal()
    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('input[placeholder="Aim title..."]').exists()).toBe(false)
    expect(wrapper.find('textarea[placeholder="Optional description..."]').exists()).toBe(false)
    expect(wrapper.find('.bulk-aim-titles').text()).toContain('First title')
    expect(wrapper.find('.bulk-aim-titles').text()).toContain('Second title')

    const statusOverride = wrapper.findAll('.mixed-activate')
      .find((button) => button.text().includes('Multiple values'))
    await statusOverride!.trigger('click')
    await wrapper.find('select').setValue('done')
    expect(dataStore.updateAim).not.toHaveBeenCalled()

    await wrapper.find('.btn-save').trigger('click')

    expect(dataStore.updateAim).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(dataStore.updateAim).mock.calls) {
      expect(call[2]).not.toHaveProperty('text')
      expect(call[2]).not.toHaveProperty('description')
      expect(call[2]).toMatchObject({ status: { state: 'done' } })
    }
  })

  it('does not persist bulk edits when cancelled', async () => {
    const { wrapper, dataStore } = mountBulkEditModal()
    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const statusOverride = wrapper.findAll('.mixed-activate')
      .find((button) => button.text().includes('Multiple values'))
    await statusOverride!.trigger('click')
    await wrapper.find('select').setValue('done')
    await wrapper.find('.btn-cancel').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.btn-discard').trigger('click')

    expect(dataStore.updateAim).not.toHaveBeenCalled()
  })

  it('uses explicit activation for mixed selects and protects mixed ongoing aims from archive', async () => {
    const { wrapper, dataStore } = mountBulkEditModal()
    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Archive this aim')

    const statusOverride = wrapper.findAll('.mixed-activate')
      .find((button) => button.text().includes('Multiple values'))
    expect(statusOverride).toBeDefined()
    await statusOverride!.trigger('click')
    await wrapper.vm.$nextTick()

    const status = wrapper.find('select')
    expect(status.exists()).toBe(true)
    await status.setValue('done')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Archive this aim')
    expect(dataStore.updateAim).not.toHaveBeenCalled()
  })

  it('saves and closes on Enter from title input', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const title = wrapper.find('input[placeholder=\"Aim title...\"]')
    await title.setValue('Updated title')
    await title.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not save on Enter in textarea, but saves on Ctrl+Enter', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const description = wrapper.find('textarea[placeholder=\"Optional description...\"]')
    await description.setValue('Line one')
    await description.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeFalsy()

    await description.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('sizes the edit description textarea to all initially loaded lines', async () => {
    const { wrapper } = mountEditModal('Line one\nLine two\nLine three\nLine four')

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const description = wrapper.find('textarea[placeholder="Optional description..."]')

    expect(description.attributes('rows')).toBe('4')
  })

  it('does not dynamically resize the edit description textarea after initial load', async () => {
    const { wrapper } = mountEditModal('Line one\nLine two\nLine three\nLine four')

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const description = wrapper.find('textarea[placeholder="Optional description..."]')
    await description.setValue('Line one\nLine two\nLine three\nLine four\nLine five\nLine six')
    await wrapper.vm.$nextTick()

    expect(description.attributes('rows')).toBe('4')
  })

  it('keeps the default edit description textarea height for short descriptions', async () => {
    const { wrapper } = mountEditModal('One line')

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const description = wrapper.find('textarea[placeholder="Optional description..."]')

    expect(description.attributes('rows')).toBe('3')
  })

  it('adds selected parent aims from search callback to the supports list', async () => {
    const { wrapper } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const modalStore = useUIModalStore()

    await wrapper.find('button[title="Add supported aim"]').trigger('click')

    expect(modalStore.openAimSearch).toHaveBeenCalledWith(
      'pick',
      expect.any(Function),
      undefined,
      expect.objectContaining({
        title: 'Select Supported Aim',
        placeholder: 'Search for a parent aim...'
      })
    )
    const calls = vi.mocked(modalStore.openAimSearch).mock.calls
    expect(calls[0]).toBeDefined()
    expect(calls[0]![1]).toEqual(expect.any(Function))

    const callback = calls[0]![1] as (payload: any) => void
    callback({
      type: 'aim',
      data: {
        id: 'parent-1',
        text: 'Parent Aim',
        status: { state: 'open', comment: '' }
      }
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Parent Aim')
  })

  it('closes on Escape from the title input', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const title = wrapper.find('input[placeholder="Aim title..."]')
    await title.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(dataStore.updateAim).not.toHaveBeenCalled()
  })

  it('closes on Escape from the status select', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const status = wrapper.find('select')
    await status.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(dataStore.updateAim).not.toHaveBeenCalled()
  })

  it('closes on Escape handled by the modal shell', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    await wrapper.find('.modal-overlay').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(dataStore.updateAim).not.toHaveBeenCalled()
  })

  it('saves on Enter from the modal content root when no field handles it', async () => {
    const { wrapper, dataStore } = mountEditModal()

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    await wrapper.find('.modal-content-root').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('opens confirmation on Escape when dirty, and cancels/stays on 2nd Escape', async () => {
    const div = document.createElement('div')
    document.body.appendChild(div)

    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        'ui-project': { projectPath: '/test/project' },
        data: {
          aims: {
            'aim-1': {
              id: 'aim-1', text: 'Old title', description: '', tags: [],
              status: { state: 'open', comment: '' }, archived: false,
              intrinsicValue: 0, cost: 1, loopWeight: 1, reflection: '',
              supportedAims: [], supportingConnections: [], incoming: [], committedIn: []
            }
          },
          meta: {
            statuses: [{ key: 'open', color: '#fff', ongoing: true }, { key: 'done', color: '#0f0', ongoing: false }]
          }
        }
      }
    })

    const wrapper = mount(AimEditModal, {
      props: { show: false, aimId: 'aim-1' },
      global: { plugins: [pinia] },
      attachTo: div
    })

    const dataStore = useDataStore(pinia)
    dataStore.aims['aim-1'] = {
      id: 'aim-1', text: 'Old title', description: '', tags: [],
      status: { state: 'open', comment: '', date: Date.now() }, archived: false,
      intrinsicValue: 0, cost: 1, loopWeight: 1, reflection: '',
      supportedAims: [], supportingConnections: [], committedIn: []
    } as any

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    // Make dirty
    const title = wrapper.find('input[placeholder="Aim title..."]')
    await title.setValue('Dirty updated title')
    await wrapper.vm.$nextTick()

    // 1st Escape: triggers confirmation overlay
    await title.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.confirmingDiscard).toBe(true)
    expect(wrapper.emitted('close')).toBeFalsy()

    // 2nd Escape: cancels confirmation, stays in modal
    await wrapper.find('.modal-content-root').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.confirmingDiscard).toBe(false)
    expect(wrapper.emitted('close')).toBeFalsy()

    wrapper.unmount()
    div.remove()
  })

  it('opens confirmation on Escape when dirty, focuses the discard button, and closes/discards on click', async () => {
    const div = document.createElement('div')
    document.body.appendChild(div)

    const pinia = createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        'ui-project': { projectPath: '/test/project' },
        data: {
          aims: {
            'aim-1': {
              id: 'aim-1', text: 'Old title', description: '', tags: [],
              status: { state: 'open', comment: '' }, archived: false,
              intrinsicValue: 0, cost: 1, loopWeight: 1, reflection: '',
              supportedAims: [], supportingConnections: [], incoming: [], committedIn: []
            }
          },
          meta: {
            statuses: [{ key: 'open', color: '#fff', ongoing: true }, { key: 'done', color: '#0f0', ongoing: false }]
          }
        }
      }
    })

    const wrapper = mount(AimEditModal, {
      props: { show: false, aimId: 'aim-1' },
      global: { plugins: [pinia] },
      attachTo: div
    })

    const dataStore = useDataStore(pinia)
    dataStore.aims['aim-1'] = {
      id: 'aim-1', text: 'Old title', description: '', tags: [],
      status: { state: 'open', comment: '', date: Date.now() }, archived: false,
      intrinsicValue: 0, cost: 1, loopWeight: 1, reflection: '',
      supportedAims: [], supportingConnections: [], committedIn: []
    } as any

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    // Make dirty
    const title = wrapper.find('input[placeholder="Aim title..."]')
    await title.setValue('Dirty updated title')
    await wrapper.vm.$nextTick()

    // Escape: triggers confirmation overlay
    await title.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.confirmingDiscard).toBe(true)

    // Focuses the discard button (OK button)
    const discardBtn = wrapper.find('.btn-discard')
    expect(document.activeElement).toBe(discardBtn.element)

    // Click: confirms modal close/discard
    await discardBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.confirmingDiscard).toBe(false)
    expect(wrapper.emitted('close')).toBeTruthy()

    wrapper.unmount()
    div.remove()
  })
})

describe('AimEditModal archive checkbox', () => {
  it('hides the archive checkbox for an ongoing status and shows it after switching to a halted one', async () => {
    const { wrapper } = mountEditModal('desc', 'open')

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.archive-toggle').exists()).toBe(false)

    await wrapper.find('.status-select').setValue('done')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.archive-toggle').exists()).toBe(true)
  })

  it('persists the archived flag when saving from a halted status', async () => {
    const { wrapper, dataStore } = mountEditModal('desc', 'done')

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const checkbox = wrapper.find('.archive-toggle input[type="checkbox"]')
    expect(checkbox.exists()).toBe(true)
    await checkbox.setValue(true)

    await wrapper.find('.modal-content-root').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalledWith(
      '/test/project',
      'aim-1',
      expect.objectContaining({ archived: true })
    )
  })

  it('forces archived back to false when the status returns to an ongoing one', async () => {
    const { wrapper, dataStore } = mountEditModal('desc', 'done', true)

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    await wrapper.find('.status-select').setValue('open')
    await wrapper.vm.$nextTick()

    await wrapper.find('.modal-content-root').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalledWith(
      '/test/project',
      'aim-1',
      expect.objectContaining({ archived: false })
    )
  })
})

describe('AimEditModal linked repos', () => {
  const R1 = '11111111-1111-4111-8111-111111111111'
  const R2 = '22222222-2222-4222-8222-222222222222'

  function mountWithRepos() {
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const wrapper = mount(AimEditModal, {
      props: { show: false, aimId: 'aim-1' },
      global: { plugins: [pinia] }
    })
    const dataStore = useDataStore(pinia)
    const projectStore = useProjectStore(pinia)
    dataStore.aims['aim-1'] = {
      id: 'aim-1', text: 'Local aim', description: '', tags: [],
      status: { state: 'open', comment: '', date: Date.now() }, archived: false,
      intrinsicValue: 0, cost: 1, loopWeight: 1, reflection: '',
      supportedAims: [], supportingConnections: [], committedIn: [],
      supportingRepos: [{ repoId: R1, weight: 1, relativePosition: [0, 0] }]
    } as any
    dataStore.meta = {
      name: 'p', color: '#ffffff',
      statuses: [{ key: 'open', color: '#fff', ongoing: true }],
      linkedRepos: [{ repoId: R1, name: 'Repo One' }, { repoId: R2, name: 'Repo Two' }]
    } as any
    projectStore.projectPath = '/test/project'
    return { wrapper, dataStore }
  }

  it('lists existing repo links and opens the funnel with only the unlinked repos', async () => {
    const { wrapper } = mountWithRepos()
    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    // The already-linked repo shows by its registry name.
    expect(wrapper.text()).toContain('Repo One')

    const modalStore = useUIModalStore()
    await wrapper.find('button[title="Link a whole repo"]').trigger('click')

    const calls = vi.mocked(modalStore.openAimSearch).mock.calls
    const options = (calls[0]![3] as any).additionalOptions
    // Only Repo Two is offered — Repo One is already linked.
    expect(options).toEqual([expect.objectContaining({ id: R2, label: 'Repo Two' })])

    // Picking the option stages the new repo link.
    const callback = calls[0]![1] as (payload: any) => void
    callback({ type: 'option', data: { id: R2, label: 'Repo Two' } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Repo Two')
  })

  it('reconciles added/removed repo links via linkRepo/unlinkRepo on save', async () => {
    const { trpc } = await import('../../trpc')
    vi.mocked(trpc.aim.linkRepo.mutate).mockClear()
    vi.mocked(trpc.aim.unlinkRepo.mutate).mockClear()

    const { wrapper } = mountWithRepos()
    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    const modalStore = useUIModalStore()
    // Add R2 through the funnel.
    await wrapper.find('button[title="Link a whole repo"]').trigger('click')
    const callback = vi.mocked(modalStore.openAimSearch).mock.calls[0]![1] as (payload: any) => void
    callback({ type: 'option', data: { id: R2, label: 'Repo Two' } })
    await wrapper.vm.$nextTick()

    // Remove the pre-existing R1 (two clicks: Remove → Confirm).
    const removeBtn = wrapper.findAll('.entry-action').find((b) => b.text() === 'Remove')!
    await removeBtn.trigger('click')
    await removeBtn.trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.find('.modal-content-root').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(trpc.aim.linkRepo.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/test/project', aimId: 'aim-1', repoId: R2 })
    )
    expect(trpc.aim.unlinkRepo.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/test/project', aimId: 'aim-1', repoId: R1 })
    )
  })
})

describe('AimEditModal custom color', () => {
  it('persists a picked custom color', async () => {
    const { wrapper, dataStore } = mountEditModal('desc', 'open')

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    await wrapper.find('.hidden-color-input').setValue('#ff8800')
    await wrapper.find('.modal-content-root').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalledWith(
      '/test/project',
      'aim-1',
      expect.objectContaining({ color: '#ff8800' })
    )
  })

  it('saves color as null when none is set', async () => {
    const { wrapper, dataStore } = mountEditModal('desc', 'open')

    await wrapper.setProps({ show: true })
    await wrapper.vm.$nextTick()

    await wrapper.find('.modal-content-root').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()

    expect(dataStore.updateAim).toHaveBeenCalledWith(
      '/test/project',
      'aim-1',
      expect.objectContaining({ color: null })
    )
  })
})
