import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { handleColumnNavigationKeysAction, handleGlobalKeydownAction, handleGraphKeydownAction, handleIdeaNavigationKeysAction, navigateColumnForward } from './keyboard-actions'
import { useGraphUIStore } from './graph-store'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'
import { useDataStore } from '../data'
import { useUIStore } from './list-store'
import { useHistoryStore } from '../history'

const makeIdea = (id: string, text: string) => ({
  id,
  text,
  description: '',
  supportedIdeas: [] as string[],
  supportingConnections: [] as Array<{ ideaId: string, weight: number, relativePosition: [number, number] }>,
  status: { state: 'open', comment: '', date: 0 },
  intrinsicValue: 0,
  cost: 1,
  loopWeight: 1,
  incoming: [] as string[],
  committedIn: [] as string[]
})

describe('keyboard actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('deletes a selected graph connection on confirmed dd', async () => {
    const graphStore = useGraphUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'

    const dataStore = { removeConnection: vi.fn().mockResolvedValue(undefined) }

    graphStore.selectLink('parent', 'child')

    await handleGraphKeydownAction({}, new KeyboardEvent('keydown', { key: 'd' }), dataStore)
    expect(graphStore.pendingDeleteLink).toEqual({ parentId: 'parent', childId: 'child' })
    expect(dataStore.removeConnection).not.toHaveBeenCalled()

    await handleGraphKeydownAction({}, new KeyboardEvent('keydown', { key: 'd' }), dataStore)

    expect(graphStore.selectedLink).toBe(null)
    expect(dataStore.removeConnection).toHaveBeenCalledWith('/tmp/project', 'parent', 'child')
  })

  it.each([
    [{ key: 'u' }, 'undo'],
    [{ key: 'r' }, 'redo'],
    [{ key: 'z', ctrlKey: true }, 'undo'],
    [{ key: 'y', ctrlKey: true }, 'redo'],
    [{ key: 'Z', ctrlKey: true, shiftKey: true }, 'redo'],
    [{ key: 'z', metaKey: true }, 'undo']
  ] as const)('maps %o to %s', async (init, action) => {
    const historyStore = useHistoryStore()
    const undo = vi.spyOn(historyStore, 'undo').mockResolvedValue(undefined as any)
    const redo = vi.spyOn(historyStore, 'redo').mockResolvedValue(undefined as any)
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true })

    await handleGlobalKeydownAction(useUIStore(), event, useDataStore())

    expect(event.defaultPrevented).toBe(true)
    expect(action === 'undo' ? undo : redo).toHaveBeenCalledOnce()
    expect(action === 'undo' ? redo : undo).not.toHaveBeenCalled()
  })

  it('toggles the focused graph idea with Space in multi-select mode', async () => {
    const graphStore = useGraphUIStore()
    const uiStore = useUIStore()
    const dataStore = useDataStore()
    const idea = makeIdea('idea-a', 'Idea A')
    dataStore.ideas[idea.id] = idea as any
    graphStore.setGraphSelection(idea.id)
    uiStore.enterMultiSelect(idea.id)

    const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    await handleGraphKeydownAction(uiStore, event, dataStore)

    expect(event.defaultPrevented).toBe(true)
    expect(uiStore.multiSelectedIdeaIds).toEqual([])
    expect(uiStore.multiSelectMode).toBe(false)
  })

  it('keeps graph delete confirmation in graph UI state', async () => {
    const graphStore = useGraphUIStore()
    const uiStore = useUIStore()
    const dataStore = {
      previewCascadingDelete: vi.fn().mockResolvedValue(['idea-a']),
      deleteIdeas: vi.fn().mockResolvedValue(['idea-a'])
    }
    useProjectStore().projectPath = '/tmp/project'
    graphStore.setGraphSelection('idea-a')

    await handleGraphKeydownAction(uiStore, new KeyboardEvent('keydown', { key: 'd' }), dataStore)

    expect(graphStore.pendingDeleteIdeaId).toBe('idea-a')
    expect('pendingDeleteIdeaId' in uiStore).toBe(false)

    await handleGraphKeydownAction(uiStore, new KeyboardEvent('keydown', { key: 'd' }), dataStore)

    expect(dataStore.deleteIdeas).toHaveBeenCalledWith('/tmp/project', ['idea-a'], { cascade: false })
    expect(graphStore.pendingDeleteIdeaId).toBe(null)
    expect(graphStore.graphSelectedIdeaId).toBe(null)
  })

  it('moves a phase across parent boundaries and repairs the selected parent path', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'

    dataStore.meta = { rootPhaseIds: ['root-a', 'root-b'] } as any
    dataStore.phases = {
      'root-a': {
        id: 'root-a',
        name: 'Root A',
        from: 0,
        to: 0,
        parent: null,
        childPhaseIds: ['child-a'],
        commitments: []
      },
      'root-b': {
        id: 'root-b',
        name: 'Root B',
        from: 0,
        to: 0,
        parent: null,
        childPhaseIds: ['child-b'],
        commitments: []
      },
      'child-a': {
        id: 'child-a',
        name: 'Child A',
        from: 0,
        to: 0,
        parent: 'root-a',
        childPhaseIds: [],
        commitments: []
      },
      'child-b': {
        id: 'child-b',
        name: 'Child B',
        from: 0,
        to: 0,
        parent: 'root-b',
        childPhaseIds: [],
        commitments: []
      }
    } as any
    const movePhase = vi.spyOn(dataStore, 'movePhase').mockImplementation(async (_projectPath, phaseId, parentId, newIndex) => {
      const phase = dataStore.phases[phaseId]
      if (!phase || !phase.parent || !parentId) throw new Error('invalid test phase move')
      const oldParent = dataStore.phases[phase.parent!]
      const newParent = dataStore.phases[parentId!]
      if (!oldParent || !newParent) throw new Error('invalid test phase parent')
      oldParent.childPhaseIds = oldParent.childPhaseIds?.filter((id) => id !== phaseId) ?? []
      const nextChildIds = [...(newParent.childPhaseIds ?? [])]
      nextChildIds.splice(newIndex, 0, phaseId)
      newParent.childPhaseIds = nextChildIds
      phase.parent = parentId
    })

    uiStore.activeColumn = 1
    uiStore.maxColumn = 1
    uiStore.windowStart = 0
    uiStore.windowSize = 2
    uiStore.selectedEntryKeyByColumn[0] = 'phase:root-a'
    uiStore.selectedEntryKeyByColumn[1] = 'phase:child-a'

    await handleColumnNavigationKeysAction(uiStore, {
      key: 'J',
      preventDefault: vi.fn()
    } as any, dataStore)

    expect(movePhase).toHaveBeenCalledWith('/tmp/project', 'child-a', 'root-b', 0)
    expect(dataStore.phases['root-a']?.childPhaseIds).toEqual([])
    expect(dataStore.phases['root-b']?.childPhaseIds).toEqual(['child-a', 'child-b'])
    expect(uiStore.selectedPhaseIdByColumn[0]).toBe('root-b')
    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-a')
  })

  it('does not move right past a selected empty-child placeholder', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'

    // Column 1 holds child-a (childless) and child-b (has a grandchild), so
    // column 2 has entries even though child-a has nothing to its right.
    dataStore.meta = { rootPhaseIds: ['root'] } as any
    dataStore.phases = {
      root: { id: 'root', name: 'Root', parent: null, childPhaseIds: ['child-a', 'child-b'], commitments: [] },
      'child-a': { id: 'child-a', name: 'Child A', parent: 'root', childPhaseIds: [], commitments: [] },
      'child-b': { id: 'child-b', name: 'Child B', parent: 'root', childPhaseIds: ['grandchild-b'], commitments: [] },
      'grandchild-b': { id: 'grandchild-b', name: 'Grandchild B', parent: 'child-b', childPhaseIds: [], commitments: [] }
    } as any

    uiStore.windowStart = 0
    uiStore.windowSize = 4
    uiStore.activeColumn = 2
    uiStore.maxColumn = 2
    uiStore.selectedEntryKeyByColumn[0] = 'phase:root'
    uiStore.selectedEntryKeyByColumn[1] = 'phase:child-a'
    uiStore.selectedEntryKeyByColumn[2] = 'placeholder:child-a'

    await navigateColumnForward(uiStore, dataStore)

    expect(uiStore.activeColumn).toBe(2)
    expect(uiStore.maxColumn).toBe(2)
  })

  it('moves a phase upward after the previous parent children when crossing parent boundaries', async () => {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const projectStore = useProjectStore()
    projectStore.projectPath = '/tmp/project'

    dataStore.meta = { rootPhaseIds: ['root-a', 'root-b'] } as any
    dataStore.phases = {
      'root-a': {
        id: 'root-a',
        name: 'Root A',
        from: 0,
        to: 0,
        parent: null,
        childPhaseIds: ['child-a1', 'child-a2'],
        commitments: []
      },
      'root-b': {
        id: 'root-b',
        name: 'Root B',
        from: 0,
        to: 0,
        parent: null,
        childPhaseIds: ['child-b'],
        commitments: []
      },
      'child-a1': {
        id: 'child-a1',
        name: 'Child A1',
        from: 0,
        to: 0,
        parent: 'root-a',
        childPhaseIds: [],
        commitments: []
      },
      'child-a2': {
        id: 'child-a2',
        name: 'Child A2',
        from: 0,
        to: 0,
        parent: 'root-a',
        childPhaseIds: [],
        commitments: []
      },
      'child-b': {
        id: 'child-b',
        name: 'Child B',
        from: 0,
        to: 0,
        parent: 'root-b',
        childPhaseIds: [],
        commitments: []
      }
    } as any
    const movePhase = vi.spyOn(dataStore, 'movePhase').mockImplementation(async (_projectPath, phaseId, parentId, newIndex) => {
      const phase = dataStore.phases[phaseId]
      if (!phase || !phase.parent || !parentId) throw new Error('invalid test phase move')
      const oldParent = dataStore.phases[phase.parent!]
      const newParent = dataStore.phases[parentId!]
      if (!oldParent || !newParent) throw new Error('invalid test phase parent')
      oldParent.childPhaseIds = oldParent.childPhaseIds?.filter((id) => id !== phaseId) ?? []
      const nextChildIds = [...(newParent.childPhaseIds ?? [])]
      nextChildIds.splice(newIndex, 0, phaseId)
      newParent.childPhaseIds = nextChildIds
      phase.parent = parentId
    })

    uiStore.activeColumn = 1
    uiStore.maxColumn = 1
    uiStore.windowStart = 0
    uiStore.windowSize = 2
    uiStore.selectedEntryKeyByColumn[0] = 'phase:root-b'
    uiStore.selectedEntryKeyByColumn[1] = 'phase:child-b'

    await handleColumnNavigationKeysAction(uiStore, {
      key: 'K',
      preventDefault: vi.fn()
    } as any, dataStore)

    expect(movePhase).toHaveBeenCalledWith('/tmp/project', 'child-b', 'root-a', 2)
    expect(dataStore.phases['root-a']?.childPhaseIds).toEqual(['child-a1', 'child-a2', 'child-b'])
    expect(dataStore.phases['root-b']?.childPhaseIds).toEqual([])
    expect(uiStore.selectedPhaseIdByColumn[0]).toBe('root-a')
    expect(uiStore.selectedPhaseIdByColumn[1]).toBe('child-b')
  })

  describe('dd in a list removes the idea from the list it is shown in', () => {
    const press = (uiStore: any, dataStore: any) =>
      handleIdeaNavigationKeysAction(uiStore, new KeyboardEvent('keydown', { key: 'd' }), dataStore)

    const listStores = (path: any) => {
      const dataStore = {
        ideas: {} as Record<string, any>,
        phases: {} as Record<string, any>,
        floatingIdeas: [] as any[],
        getIdeasForPhase: vi.fn(() => []),
        previewCascadingDelete: vi.fn(async (_projectPath: string, ideaIds: string[]) => ideaIds),
        detachIdea: vi.fn().mockResolvedValue(undefined),
        deleteIdeas: vi.fn().mockResolvedValue([])
      }
      const uiStore = { getSelectionPath: () => path, multiSelectMode: false, navigatingIdeas: true, floatingIdeaIndex: 0 }
      return { dataStore, uiStore }
    }

    // Answers the removal dialog as soon as it opens.
    const answerDialog = (choice: 'keep' | 'cascade' | null) => {
      const modalStore = useUIModalStore()
      modalStore.$subscribe(() => {
        if (modalStore.ideaRemoval) queueMicrotask(() => modalStore.answerIdeaRemoval(choice))
      })
      return modalStore
    }

    beforeEach(() => {
      useProjectStore().projectPath = '/tmp/project'
    })

    it('detaches an idea that another parent keeps, without asking, and selects the successor', async () => {
      const parent = makeIdea('parent', 'Parent')
      parent.supportingConnections = ['first', 'removed', 'last'].map((ideaId) => ({ ideaId, weight: 1, relativePosition: [0, 0] as [number, number] }))
      const removed = makeIdea('removed', 'Removed')
      removed.supportedIdeas = ['parent', 'other-parent']
      const parentState = { pendingDelete: false, selectedIncomingIndex: 2 }
      const { dataStore, uiStore } = listStores({
        phase: undefined,
        ideas: [parent, removed],
        ideaStates: [parentState, { pendingDelete: false }]
      })
      dataStore.ideas.parent = parent
      const modalStore = useUIModalStore()

      await press(uiStore, dataStore)
      expect(dataStore.detachIdea).not.toHaveBeenCalled()
      await press(uiStore, dataStore)

      expect(modalStore.ideaRemoval).toBe(null)
      expect(dataStore.detachIdea).toHaveBeenCalledWith('/tmp/project', 'removed', { parentId: 'parent' })
      expect(parentState.selectedIncomingIndex).toBe(1)
    })

    it('asks before taking the last anchor; r keeps the idea floating', async () => {
      const phase = { id: 'phase', name: 'April', selectedIdeaIndex: 0, commitments: ['idea'] }
      const idea = makeIdea('idea', 'Idea')
      idea.committedIn = ['phase']
      const { dataStore, uiStore } = listStores({ phase, ideas: [idea], ideaStates: [{ pendingDelete: true }] })
      dataStore.phases.phase = phase
      const modalStore = answerDialog('keep')
      const opened = vi.spyOn(modalStore, 'askIdeaRemoval')

      await press(uiStore, dataStore)

      expect(opened).toHaveBeenCalledWith({ ideaIds: ['idea'], fromLabel: 'April', cascadeIds: ['idea'] })
      expect(dataStore.detachIdea).toHaveBeenCalledWith('/tmp/project', 'idea', { phaseId: 'phase' })
      expect(dataStore.deleteIdeas).not.toHaveBeenCalled()
      expect(uiStore.navigatingIdeas).toBe(false)
    })

    it('x deletes the last-anchored idea with its unanchored subtree', async () => {
      const parent = makeIdea('parent', 'Parent')
      const idea = makeIdea('idea', 'Idea')
      idea.supportedIdeas = ['parent']
      const { dataStore, uiStore } = listStores({
        phase: undefined,
        ideas: [parent, idea],
        ideaStates: [{ pendingDelete: false }, { pendingDelete: true }]
      })
      dataStore.previewCascadingDelete.mockResolvedValue(['idea', 'child'])
      answerDialog('cascade')

      await press(uiStore, dataStore)

      expect(dataStore.deleteIdeas).toHaveBeenCalledWith('/tmp/project', ['idea'], { cascade: true })
      expect(dataStore.detachIdea).not.toHaveBeenCalled()
    })

    it('Esc cancels and leaves everything as it was', async () => {
      const parent = makeIdea('parent', 'Parent')
      const idea = makeIdea('idea', 'Idea')
      idea.supportedIdeas = ['parent']
      const parentState = { pendingDelete: false, selectedIncomingIndex: 0 }
      const { dataStore, uiStore } = listStores({
        phase: undefined,
        ideas: [parent, idea],
        ideaStates: [parentState, { pendingDelete: true }]
      })
      answerDialog(null)

      await press(uiStore, dataStore)

      expect(dataStore.detachIdea).not.toHaveBeenCalled()
      expect(dataStore.deleteIdeas).not.toHaveBeenCalled()
      expect(parentState.selectedIncomingIndex).toBe(0)
    })

    it('deletes a floating idea without sub-ideas directly', async () => {
      const { dataStore, uiStore } = listStores({
        phase: undefined,
        ideas: [makeIdea('idea', 'Idea')],
        ideaStates: [{ pendingDelete: true }]
      })

      await press(uiStore, dataStore)

      expect(useUIModalStore().ideaRemoval).toBe(null)
      expect(dataStore.deleteIdeas).toHaveBeenCalledWith('/tmp/project', ['idea'], { cascade: false })
    })
  })
})
