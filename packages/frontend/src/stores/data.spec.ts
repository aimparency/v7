import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../trpc', () => ({
  trpc: { idea: { update: { mutate: vi.fn().mockResolvedValue({}) } } }
}))

import { useDataStore } from './data'

describe('data store connections', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('moving a node in the graph keeps the connection\'s hypothesis and evaluation', async () => {
    const dataStore = useDataStore()
    dataStore.ideas['parent'] = {
      id: 'parent',
      supportingConnections: [{ ideaId: 'child', weight: 2, relativePosition: [0, 0], hypothesis: 'why', evaluation: 'how' }]
    } as any

    await dataStore.updateConnectionPosition('/project', 'parent', 'child', [1, 2])

    expect(dataStore.ideas['parent']!.supportingConnections[0]).toEqual(
      { ideaId: 'child', weight: 2, relativePosition: [1, 2], hypothesis: 'why', evaluation: 'how' }
    )
  })
})
