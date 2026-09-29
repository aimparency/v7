import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const restore = vi.fn()
vi.mock('../../trpc', () => ({ trpc: { history: { restore: { mutate: (input: unknown) => restore(input) } } } }))

import { useHistoryStore } from '../history'
import { useDataStore } from '../data'
import { useUIStore } from '../ui'
import { clientId, mutationActivity } from '../../utils/mutation-activity'

const userAction = (events: Array<Record<string, unknown>>, paths = ['phase.delete']) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
  for (const path of paths) mutationActivity.onStart(path)
  for (const event of events) useHistoryStore().recordChange({ origin: clientId, ...event } as any)
  for (const path of paths) mutationActivity.onEnd(path)
}

describe('history store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    restore.mockReset()
    const store = useHistoryStore()
    store.install()
    store.reset()
  })

  it('groups one action into one entry and undoes it with compare-and-swap', async () => {
    userAction([
      { type: 'phase', id: 'child', entity: { id: 'child', parent: 'root' }, previous: { id: 'child', parent: 'doomed' } },
      { type: 'phase', id: 'doomed', deleted: true, previous: { id: 'doomed', name: 'Doomed' } }
    ], ['phase.update', 'phase.delete'])
    // Another client's change is not part of this client's history.
    useHistoryStore().recordChange({ origin: 'someone-else', type: 'aim', id: 'x', entity: {}, previous: null })

    restore.mockResolvedValue({ ok: true, conflicts: [] })
    await useHistoryStore().undo()

    expect(restore).toHaveBeenCalledTimes(1)
    expect(restore.mock.calls[0]![0].changes).toEqual([
      { type: 'phase', id: 'child', expected: { id: 'child', parent: 'root' }, target: { id: 'child', parent: 'doomed' } },
      { type: 'phase', id: 'doomed', expected: null, target: { id: 'doomed', name: 'Doomed' } }
    ])
    expect(useHistoryStore().undoStack).toHaveLength(0)
    expect(useHistoryStore().redoStack).toHaveLength(1)

    await useHistoryStore().redo()
    expect(restore.mock.calls[1]![0].changes[1]).toEqual({ type: 'phase', id: 'doomed', expected: { id: 'doomed', name: 'Doomed' }, target: null })
  })

  it('keeps the entry and reports the conflict when an entity changed since', async () => {
    userAction([{ type: 'phase', id: 'p', entity: { name: 'B' }, previous: { name: 'A' } }])

    restore.mockResolvedValue({ ok: false, conflicts: [{ type: 'phase', id: 'p' }] })
    await useHistoryStore().undo()

    expect(useHistoryStore().undoStack).toHaveLength(1)
    expect(useHistoryStore().message).toContain('changed since')
  })

  it('refuses to undo an action whose prior state was not recorded', async () => {
    userAction([{ type: 'aim', id: 'a', entity: { text: 'new' } }])

    await useHistoryStore().undo()

    expect(restore).not.toHaveBeenCalled()
    expect(useHistoryStore().message).toContain("wasn't fully recorded")
  })

  it('a new action clears the redo stack', async () => {
    userAction([{ type: 'phase', id: 'p', entity: { name: 'B' }, previous: { name: 'A' } }])
    restore.mockResolvedValue({ ok: true, conflicts: [] })
    await useHistoryStore().undo()
    expect(useHistoryStore().redoStack).toHaveLength(1)

    userAction([{ type: 'phase', id: 'p', entity: { name: 'C' }, previous: { name: 'A' } }])
    useHistoryStore().closeGroup()
    expect(useHistoryStore().redoStack).toHaveLength(0)
    expect(useHistoryStore().undoStack).toHaveLength(1)
  })

  it('keeps a moved aim selected when the move is undone and redone', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    dataStore.phases = { p: { id: 'p', name: 'P', parent: null, childPhaseIds: [], commitments: ['x', 'y'], selectedAimIndex: 0 } } as any
    dataStore.aims = {
      x: { id: 'x', text: 'X', supportingConnections: [], supportedAims: [], committedIn: ['p'] },
      y: { id: 'y', text: 'Y', supportingConnections: [], supportedAims: [], committedIn: ['p'] }
    } as any
    uiStore.selectedEntryKeyByColumn = { 0: 'phase:p' }
    uiStore.activeColumn = 0
    uiStore.navigatingAims = true
    const setOrder = (commitments: string[]) => { dataStore.phases.p!.commitments = commitments }

    // Shift+J: x moves below y and stays selected.
    userAction([{ type: 'phase', id: 'p', entity: { commitments: ['y', 'x'] }, previous: { commitments: ['x', 'y'] } }], ['aim.commitToPhase'])
    setOrder(['y', 'x'])
    dataStore.phases.p!.selectedAimIndex = 1

    restore.mockImplementation(async ({ changes }) => { setOrder(changes[0].target.commitments); return { ok: true, conflicts: [] } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u' }))
    await useHistoryStore().undo()
    expect(uiStore.getCurrentAim()?.id).toBe('x')
    expect(dataStore.phases.p!.selectedAimIndex).toBe(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    await useHistoryStore().redo()
    expect(uiStore.getCurrentAim()?.id).toBe('x')
    expect(dataStore.phases.p!.selectedAimIndex).toBe(1)
  })
})
