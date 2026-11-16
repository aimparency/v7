import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { pickSupportedIdea } from './idea-creation'
import { useUIModalStore } from './modal-store'
import { useDataStore } from '../data'
import { trpc } from '../../trpc'

vi.mock('../../trpc', () => ({
  trpc: { idea: { connectIdeas: { mutate: vi.fn().mockResolvedValue({}) } } }
}))

describe('pickSupportedIdea', () => {
  let modalStore: ReturnType<typeof useUIModalStore>
  let dataStore: ReturnType<typeof useDataStore>

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, initialState: { project: { projectPath: '/test' } } }))
    modalStore = useUIModalStore()
    dataStore = useDataStore()
    vi.mocked(dataStore.createFloatingIdea).mockResolvedValue({ id: 'new-parent' })
  })

  const pick = (payload: any) => vi.mocked(modalStore.openIdeaSearch).mock.lastCall![1]!(payload)

  it('links a picked idea and ends there', async () => {
    const link = vi.fn()
    pickSupportedIdea({ title: 'Select Supported Idea', placeholder: '' }, link)
    await pick({ type: 'idea', data: { id: 'existing', text: 'Existing' } })

    expect(link).toHaveBeenCalledWith({ id: 'existing', text: 'Existing' })
    expect(modalStore.openIdeaSearch).toHaveBeenCalledTimes(1)
  })

  const createNew = (query: string) => pick({ type: 'option', data: { id: 'create-parent', label: '', createFromQuery: true, query } })
  const saveDraft = (text: string) => modalStore.openIdeaDraft.mock.lastCall![0].save({ text })
  const lastTitle = () => vi.mocked(modalStore.openIdeaSearch).mock.lastCall![3]!.title

  it('edits each new parent in the idea modal and creates nothing until an existing idea is picked', async () => {
    const link = vi.fn()
    let created = 0
    vi.mocked(dataStore.createFloatingIdea).mockImplementation(async () => ({ id: `new-${++created}` }))
    pickSupportedIdea({ title: 'Select Supported Idea', placeholder: '' }, link)

    await createNew(' Middle aim ')
    expect(modalStore.openIdeaDraft).toHaveBeenCalledWith(expect.objectContaining({ text: 'Middle aim' }))
    saveDraft('Middle aim (edited)')
    expect(lastTitle()).toBe('What does "Middle aim (edited)" support?')

    await createNew('Upper aim')
    saveDraft('Upper aim')
    expect(dataStore.createFloatingIdea).not.toHaveBeenCalled()

    await pick({ type: 'idea', data: { id: 'existing', text: 'Existing' } })
    expect(vi.mocked(dataStore.createFloatingIdea).mock.calls.map((call) => call[1].text)).toEqual(['Middle aim (edited)', 'Upper aim'])
    expect(link).toHaveBeenCalledWith({ id: 'new-1', text: 'Middle aim (edited)' })
    expect(vi.mocked(trpc.idea.connectIdeas.mutate).mock.calls.map(([call]) => [call.childIdeaId, call.parentIdeaId])).toEqual([
      ['new-1', 'new-2'],
      ['new-2', 'existing']
    ])
  })

  it('creates the stacked drafts when skipped or dismissed', async () => {
    const link = vi.fn()
    pickSupportedIdea({ title: 'Select Supported Idea', placeholder: '' }, link)
    await createNew('Aim')
    saveDraft('Aim')
    vi.mocked(modalStore.openIdeaSearch).mock.lastCall![3]!.onDismiss!()
    await vi.waitFor(() => expect(link).toHaveBeenCalledWith({ id: 'new-parent', text: 'Aim' }))
    expect(trpc.idea.connectIdeas.mutate).not.toHaveBeenCalled()
  })

  it('cancelling the draft asks the same question again with the stack unchanged', async () => {
    pickSupportedIdea({ title: 'Select Supported Idea', placeholder: '' }, vi.fn())
    await createNew('Aim')
    modalStore.openIdeaDraft.mock.lastCall![0].cancel()
    expect(lastTitle()).toBe('Select Supported Idea')
    await pick({ type: 'option', data: { id: 'skip-parent', label: '' } })
    expect(dataStore.createFloatingIdea).not.toHaveBeenCalled()
  })
})
