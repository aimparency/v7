import { useDataStore, type IdeaCreationParams } from '../data'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'
import { trpc } from '../../trpc'
import { insertsAsFirstChild } from './idea-ui-state'
import type { useUIStore } from './list-store'

type UIStore = ReturnType<typeof useUIStore>

// Puts a new idea, or links an existing one, where the idea modal was opened:
// the graph, a phase list, or a sub-idea list (as a child of the selected
// idea), then selects it and offers the follow-up prompts (parent, phase,
// connection details). Exactly one of existingIdeaId / ideaAttributes is set.
export async function placeIdea(
  ui: UIStore,
  existingIdeaId: string | undefined,
  ideaAttributes: IdeaCreationParams | undefined,
  weight: number
): Promise<void> {
  const isExistingIdea = existingIdeaId !== undefined
  const dataStore = useDataStore()
  const modalStore = useUIModalStore()
  const projectStore = useProjectStore()

  const path = ui.getSelectionPath()
  let newIdeaId: string | undefined
  // Parent idea when creating/linking inside a sub-idea list (implicit connection).
  // Used to offer the contribution % + explanation modal afterwards.
  let implicitParentId: string | undefined
  let createdAsPhaseCommitmentWithoutImplicitSupportedIdea = false

  if (modalStore.ideaModalSource === 'graph') {
    if (isExistingIdea) {
      newIdeaId = existingIdeaId!
    } else {
      const result = await dataStore.createFloatingIdea(projectStore.projectPath, ideaAttributes!)
      newIdeaId = result.id
    }
  } else if (path.ideas.length === 0) {
    if (path.phase) {
      if (isExistingIdea) {
        await trpc.idea.commitToPhase.mutate({
          projectPath: projectStore.projectPath,
          ideaId: existingIdeaId!,
          phaseId: path.phase.id,
          insertionIndex: 0
        })
        newIdeaId = existingIdeaId!
      } else {
        const result = await dataStore.createCommittedIdea(projectStore.projectPath, path.phase.id, ideaAttributes!, 0)
        newIdeaId = result.id
        createdAsPhaseCommitmentWithoutImplicitSupportedIdea = true
      }
    } else if (isExistingIdea) {
      if (modalStore.ideaCreationCallback) {
        newIdeaId = existingIdeaId!
      } else {
        modalStore.showIdeaModal = false
        return
      }
    } else {
      const result = await dataStore.createFloatingIdea(projectStore.projectPath, ideaAttributes!)
      newIdeaId = result.id
    }
  } else {
    const currentIdea = path.ideas[path.ideas.length - 1]
    const currentIdeaState = path.ideaStates[path.ideaStates.length - 1]
    if (!currentIdea) {
      modalStore.showIdeaModal = false
      return
    }

    if (insertsAsFirstChild(currentIdea, currentIdeaState, modalStore.ideaModalInsertPosition)) {
      if (isExistingIdea) {
        await trpc.idea.connectIdeas.mutate({
          projectPath: projectStore.projectPath,
          parentIdeaId: currentIdea.id,
          childIdeaId: existingIdeaId!,
          parentIncomingIndex: 0,
          weight
        })
        newIdeaId = existingIdeaId!

        const updatedParent = await trpc.idea.get.query({
          projectPath: projectStore.projectPath,
          ideaId: currentIdea.id
        })
        dataStore.replaceIdea(currentIdea.id, updatedParent)
      } else {
        const result = await dataStore.createSubIdea(projectStore.projectPath, currentIdea.id, ideaAttributes!, 0, weight)
        newIdeaId = result.id
      }

      implicitParentId = currentIdea.id
      if (currentIdeaState) {
        currentIdeaState.selectedIncomingIndex = 0
      }
    } else if (path.ideas.length > 1) {
      const parentIdea = path.ideas[path.ideas.length - 2]
      const parentIdeaState = path.ideaStates[path.ideaStates.length - 2]
      if (parentIdea) {
        let insertionIndex = parentIdeaState?.selectedIncomingIndex ?? 0
        if (modalStore.ideaModalInsertPosition === 'after') {
          insertionIndex++
        }

        if (isExistingIdea) {
          await trpc.idea.connectIdeas.mutate({
            projectPath: projectStore.projectPath,
            parentIdeaId: parentIdea.id,
            childIdeaId: existingIdeaId!,
            parentIncomingIndex: insertionIndex,
            weight
          })
          newIdeaId = existingIdeaId!

          const updatedParent = await trpc.idea.get.query({
            projectPath: projectStore.projectPath,
            ideaId: parentIdea.id
          })
          dataStore.replaceIdea(parentIdea.id, updatedParent)
        } else {
          const result = await dataStore.createSubIdea(projectStore.projectPath, parentIdea.id, ideaAttributes!, insertionIndex, weight)
          newIdeaId = result.id
        }

        implicitParentId = parentIdea.id
        if (parentIdeaState) {
          parentIdeaState.selectedIncomingIndex = insertionIndex
        }
      }
    } else if (path.phase) {
      let insertionIndex = 0
      const phase = dataStore.phases[path.phase.id]
      if (phase && phase.selectedIdeaIndex !== undefined) {
        insertionIndex = phase.selectedIdeaIndex + (modalStore.ideaModalInsertPosition === 'after' ? 1 : 0)
      }

      if (isExistingIdea) {
        await trpc.idea.commitToPhase.mutate({
          projectPath: projectStore.projectPath,
          ideaId: existingIdeaId!,
          phaseId: path.phase.id,
          insertionIndex
        })
        newIdeaId = existingIdeaId!

        const updatedPhase = await trpc.phase.get.query({
          projectPath: projectStore.projectPath,
          phaseId: path.phase.id
        })
        dataStore.replacePhase(path.phase.id, updatedPhase)
      } else {
        const result = await dataStore.createCommittedIdea(projectStore.projectPath, path.phase.id, ideaAttributes!, insertionIndex)
        newIdeaId = result.id
        createdAsPhaseCommitmentWithoutImplicitSupportedIdea = true
      }

      const freshPhase = dataStore.phases[path.phase.id]
      if (freshPhase) {
        freshPhase.selectedIdeaIndex = insertionIndex
      }
    } else if (isExistingIdea) {
      if (modalStore.ideaCreationCallback) {
        newIdeaId = existingIdeaId!
      } else {
        modalStore.showIdeaModal = false
        return
      }
    } else {
      const result = await dataStore.createFloatingIdea(projectStore.projectPath, ideaAttributes!)
      newIdeaId = result.id
    }
  }

  let connectionCallbackPromptsPhase = false
  if (newIdeaId) {
    const shouldPromptForPhaseCommitment =
      !isExistingIdea &&
      modalStore.ideaModalSource === 'graph' &&
      projectStore.currentView === 'graph'

    if (modalStore.ideaCreationCallback) {
      if (shouldPromptForPhaseCommitment) {
        connectionCallbackPromptsPhase = true
        const promptPhase = () => {
          modalStore.openPhaseSearchPrompt(async (payload) => {
            if (payload.type !== 'phase') return
            await dataStore.commitIdeaToPhase(projectStore.projectPath, newIdeaId!, payload.data.id)
          }, {
            title: 'Commit to Phase',
            placeholder: 'Optional: search for a phase...',
            additionalOptions: [{
              id: 'skip-phase',
              label: 'Skip (leave uncommitted)',
              description: 'Keep this new graph idea uncommitted to any phase.',
              showWhenQueryEmptyOnly: true,
              actsAsEscape: true
            }]
          })
        }
        modalStore.ideaCreationCallback(newIdeaId, promptPhase)
      } else {
        modalStore.ideaCreationCallback(newIdeaId)
      }
      modalStore.ideaCreationCallback = null
    }

    if (path.phase) {
      const ideas = dataStore.getIdeasForPhase(path.phase.id)
      const newIdeaIndex = ideas.findIndex((idea) => idea.id === newIdeaId)
      if (newIdeaIndex !== -1) {
        const phase = dataStore.phases[path.phase.id]
        if (phase) {
          phase.selectedIdeaIndex = newIdeaIndex
        }
      }
    } else {
      const newIdeaIndex = dataStore.floatingIdeas.findIndex((idea) => idea.id === newIdeaId)
      if (newIdeaIndex !== -1) {
        ui.floatingIdeaIndex = newIdeaIndex
      }
    }
  }

  const shouldPromptForSupportedIdea =
    !isExistingIdea &&
    !!newIdeaId &&
    (ideaAttributes?.supportedIdeas.length ?? 0) === 0 &&
    createdAsPhaseCommitmentWithoutImplicitSupportedIdea &&
    modalStore.ideaModalSource === 'columns' &&
    projectStore.currentView === 'columns'

  const shouldPromptForPhaseCommitment =
    !isExistingIdea &&
    !!newIdeaId &&
    modalStore.ideaModalSource === 'graph' &&
    projectStore.currentView === 'graph' &&
    !connectionCallbackPromptsPhase

  modalStore.closeIdeaModal()

  // Sub-idea list creation/linking: offer contribution % + explanation for the
  // implicit parent->child connection. Reload the parent so its supportingConnections
  // include the freshly-created connection before the modal patches it.
  if (implicitParentId && newIdeaId && !shouldPromptForSupportedIdea && !shouldPromptForPhaseCommitment) {
    await dataStore.loadIdeas(projectStore.projectPath, [implicitParentId, newIdeaId])
    modalStore.openConnectionDetailsModal(implicitParentId, newIdeaId)
  }

  if (shouldPromptForSupportedIdea && newIdeaId) {
    modalStore.openIdeaSearch('pick', async (payload) => {
      if (payload.type !== 'idea') return

      await trpc.idea.connectIdeas.mutate({
        projectPath: projectStore.projectPath,
        parentIdeaId: payload.data.id,
        childIdeaId: newIdeaId
      })

      await dataStore.loadIdeas(projectStore.projectPath, [payload.data.id, newIdeaId])
    }, undefined, {
      title: 'Connect to Supported Idea',
      placeholder: 'Optional: search for a parent idea...',
      additionalOptions: [{
        id: 'skip-parent',
        label: 'Skip (no supported idea)',
        description: 'Leave this new idea without a supported idea connection.',
        showWhenQueryEmptyOnly: true,
        actsAsEscape: true
      }]
    })
  } else if (shouldPromptForPhaseCommitment && newIdeaId) {
    modalStore.openPhaseSearchPrompt(async (payload) => {
      if (payload.type !== 'phase') return
      await dataStore.commitIdeaToPhase(projectStore.projectPath, newIdeaId, payload.data.id)
    }, {
      title: 'Commit to Phase',
      placeholder: 'Optional: search for a phase...',
      additionalOptions: [{
        id: 'skip-phase',
        label: 'Skip (leave uncommitted)',
        description: 'Keep this new graph idea uncommitted to any phase.',
        showWhenQueryEmptyOnly: true,
        actsAsEscape: true
      }]
    })
  }
}
