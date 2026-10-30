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

  it('creates the missing parent, links it, then asks what the new parent supports', async () => {
    const link = vi.fn()
    pickSupportedIdea({ title: 'Select Supported Idea', placeholder: '' }, link)
    await pick({ type: 'option', data: { id: 'create-parent', label: '', createFromQuery: true, query: ' New aim ' } })

    expect(dataStore.createFloatingIdea).toHaveBeenCalledWith('/test', expect.objectContaining({ text: 'New aim' }))
    expect(link).toHaveBeenCalledWith({ id: 'new-parent', text: 'New aim' })
    expect(vi.mocked(modalStore.openIdeaSearch).mock.lastCall![3]).toMatchObject({ title: 'What does "New aim" support?' })

    await pick({ type: 'idea', data: { id: 'grandparent', text: 'Grandparent' } })
    expect(trpc.idea.connectIdeas.mutate).toHaveBeenCalledWith({ projectPath: '/test', parentIdeaId: 'grandparent', childIdeaId: 'new-parent' })
  })
})
