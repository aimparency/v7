import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// A tiny server that handles one mutation at a time (10ms each) and, like the
// real backend, pushes the changed phase to the client before the mutation
// resolves. phase.get returns the current server order.
const { server, mockTrpc } = vi.hoisted(() => {
  const server = {
    commitments: [] as string[],
    push: (_commitments: string[]) => {},
    busy: Promise.resolve() as Promise<unknown>
  }
  const serially = <T>(work: () => T) => {
    const done = server.busy.then(() => new Promise<T>((resolve) => setTimeout(() => resolve(work()), 10)))
    server.busy = done
    return done
  }
  const mockTrpc = {
    aim: {
      commitToPhase: {
        mutate: vi.fn(({ aimId, insertionIndex }: { aimId: string; insertionIndex: number }) => serially(() => {
          server.commitments = server.commitments.filter((id) => id !== aimId)
          server.commitments.splice(insertionIndex, 0, aimId)
          server.push([...server.commitments])
          return { success: true }
        }))
      }
    },
    phase: {
      get: { query: vi.fn(async () => ({ id: 'phase', name: 'phase', parent: null, childPhaseIds: [], commitments: [...server.commitments] })) }
    }
  }
  return { server, mockTrpc }
})

vi.mock('../../trpc', () => ({ trpc: mockTrpc }))

import { useDataStore } from '../data'
import { useUIStore } from './list-store'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('structural edits', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    server.commitments = ['a', 'b', 'c', 'd']
    server.busy = Promise.resolve()
  })

  it('keeps moving the same aim when J is pressed again while earlier moves are in flight', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    for (const id of server.commitments) {
      dataStore.aims[id] = { id, text: id, supportingConnections: [], supportedAims: [], committedIn: ['phase'] } as any
    }
    const phase = (commitments: string[]) => ({ id: 'phase', name: 'phase', parent: null, childPhaseIds: [], commitments })
    dataStore.phases['phase'] = { ...phase([...server.commitments]), selectedAimIndex: 0 } as any
    // What the subscription does with the pushed entity.
    server.push = (commitments) => dataStore.replacePhaseIfCurrent('phase', phase(commitments) as any, dataStore.beginPhaseSync('phase'))
    dataStore.meta = { rootPhaseIds: ['phase'] }
    uiStore.activeColumn = 0
    uiStore.selectedEntryKeyByColumn[0] = 'phase:phase'
    uiStore.navigatingAims = true

    const presses = [uiStore.moveAimDown(), uiStore.moveAimDown()]
    // Third press between the first and the second push.
    await sleep(15)
    presses.push(uiStore.moveAimDown())
    await Promise.all(presses)
    await server.busy

    expect(server.commitments).toEqual(['b', 'c', 'd', 'a'])
    expect(uiStore.getCurrentAim()?.id).toBe('a')
  })
})
