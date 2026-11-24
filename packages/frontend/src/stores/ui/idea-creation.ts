import { useDataStore, type IdeaCreationParams } from '../data'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'
import { trpc } from '../../trpc'
import { insertsAsFirstChild } from './idea-ui-state'
import type { NewIdea, useUIStore } from './list-store'
import { IDEA_DEFAULTS } from '../../constants/ideaDefaults'

type UIStore = ReturnType<typeof useUIStore>

// Puts a new idea, or links an existing one, where the idea modal was opened:
// the space, a phase list, or a sub-idea list (as a child of the selected
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
  // Used to offer the contribution % + hypothesis modal afterwards.
  let implicitParentId: string | undefined
  let createdAsPhaseCommitmentWithoutImplicitSupportedIdea = false

  if (modalStore.ideaModalSource === 'graph') {
    if (isExistingIdea) {
      newIdeaId = existingIdeaId!
    } else {
      const result = await dataStore.createFloatingIdea(projectStore.projectPath, ideaAttributes!, modalStore.ideaCreationParentId ?? undefined)
      newIdeaId = result.id
    }
  } else if (path.ideas.length === 0) {
    if (path.phase) {
      if (isExistingIdea) {
        await trpc.idea.commitToPhase.mutate({
          space: projectStore.projectPath,
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
          space: projectStore.projectPath,
          parentIdeaId: currentIdea.id,
          childIdeaId: existingIdeaId!,
          parentIncomingIndex: 0,
          weight
        })
        newIdeaId = existingIdeaId!

        const updatedParent = await trpc.idea.get.query({
          space: projectStore.projectPath,
          ideaId: currentIdea.id
        })
        dataStore.replaceIdea(currentIdea.id, updatedParent)
      } else {
        const result = await dataStore.createSubIdea(projectStore.projectPath, currentIdea.id, ideaAttributes!, 0, weight)
        newIdeaId = result.id
      }

      implicitParentId = currentIdea.id
      if (currentIdeaState) {
        currentIdeaState.selectedChildId = newIdeaId
      }
    } else if (path.ideas.length > 1) {
      const parentIdea = path.ideas[path.ideas.length - 2]
      const parentIdeaState = path.ideaStates[path.ideaStates.length - 2]
      if (parentIdea) {
        let insertionIndex = Math.max(0, (parentIdea.supportingConnections ?? []).findIndex((connection) => connection.ideaId === currentIdea.id))
        if (modalStore.ideaModalInsertPosition === 'after') {
          insertionIndex++
        }

        if (isExistingIdea) {
          await trpc.idea.connectIdeas.mutate({
            space: projectStore.projectPath,
            parentIdeaId: parentIdea.id,
            childIdeaId: existingIdeaId!,
            parentIncomingIndex: insertionIndex,
            weight
          })
          newIdeaId = existingIdeaId!

          const updatedParent = await trpc.idea.get.query({
            space: projectStore.projectPath,
            ideaId: parentIdea.id
          })
          dataStore.replaceIdea(parentIdea.id, updatedParent)
        } else {
          const result = await dataStore.createSubIdea(projectStore.projectPath, parentIdea.id, ideaAttributes!, insertionIndex, weight)
          newIdeaId = result.id
        }

        implicitParentId = parentIdea.id
        if (parentIdeaState) {
          parentIdeaState.selectedChildId = newIdeaId
        }
      }
    } else if (path.phase) {
      const selectedIndex = path.phase.commitments.indexOf(currentIdea.id)
      const insertionIndex = selectedIndex === -1 ? 0 : selectedIndex + (modalStore.ideaModalInsertPosition === 'after' ? 1 : 0)

      if (isExistingIdea) {
        await trpc.idea.commitToPhase.mutate({
          space: projectStore.projectPath,
          ideaId: existingIdeaId!,
          phaseId: path.phase.id,
          insertionIndex
        })
        newIdeaId = existingIdeaId!

        const updatedPhase = await trpc.phase.get.query({
          space: projectStore.projectPath,
          phaseId: path.phase.id
        })
        dataStore.replacePhase(path.phase.id, updatedPhase)
      } else {
        const result = await dataStore.createCommittedIdea(projectStore.projectPath, path.phase.id, ideaAttributes!, insertionIndex)
        newIdeaId = result.id
        createdAsPhaseCommitmentWithoutImplicitSupportedIdea = true
      }

      ui.selectTopIdea(path.phase.id, newIdeaId)
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
      projectStore.currentView === 'graph' &&
      // The phases are the open space's; an idea of a space opened in place has none here.
      !dataStore.ideaSpaces[newIdeaId]

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
              description: 'Keep this new space idea uncommitted to any phase.',
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
      modalStore.ideaCreationParentId = null
    }

    const topLevelIdeas = path.phase ? dataStore.getIdeasForPhase(path.phase.id) : dataStore.floatingIdeas
    if (topLevelIdeas.some((idea) => idea.id === newIdeaId)) {
      ui.selectTopIdea(path.phase?.id, newIdeaId)
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
    !connectionCallbackPromptsPhase &&
    !dataStore.ideaSpaces[newIdeaId!]

  modalStore.closeIdeaModal()

  // Sub-idea list creation/linking: offer contribution % + hypothesis for the
  // implicit parent->child connection. Reload the parent so its supportingConnections
  // include the freshly-created connection before the modal patches it.
  if (implicitParentId && newIdeaId && !shouldPromptForSupportedIdea && !shouldPromptForPhaseCommitment) {
    await dataStore.loadIdeas(projectStore.projectPath, [implicitParentId, newIdeaId])
    modalStore.openConnectionDetailsModal(implicitParentId, newIdeaId)
  }

  if (shouldPromptForSupportedIdea && newIdeaId) {
    pickSupportedIdea(
      { title: 'Connect to Supported Idea', placeholder: 'Optional: search for a parent idea...', skippable: true },
      (parent) => connectToParent(parent.id, newIdeaId)
    )
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
        description: 'Keep this new space idea uncommitted to any phase.',
        showWhenQueryEmptyOnly: true,
        actsAsEscape: true
      }]
    })
  }
}

const connectToParent = async (parentId: string, childId: string) => {
  const projectPath = useProjectStore().projectPath
  await trpc.idea.connectIdeas.mutate({ space: projectPath, parentIdeaId: parentId, childIdeaId: childId })
  await useDataStore().loadIdeas(projectPath, [parentId, childId])
}

export function toCreationParams(idea: NewIdea): IdeaCreationParams {
  return {
    text: idea.text,
    description: idea.description,
    tags: idea.tags || [],
    status: { state: idea.statusState ?? 'open', comment: idea.statusComment ?? '', date: Date.now() },
    supportingConnections: idea.supportingConnections ?? [],
    supportedIdeas: idea.supportedIdeas ?? [],
    intrinsicValue: idea.intrinsicValue ?? IDEA_DEFAULTS.intrinsicValue,
    valueRationale: (idea.valueRationale ?? IDEA_DEFAULTS.valueRationale).trim() || undefined,
    selfWeight: idea.selfWeight ?? IDEA_DEFAULTS.selfWeight,
    cost: idea.cost,
    duration: idea.duration ?? IDEA_DEFAULTS.duration,
    costVariance: 0,
    valueVariance: 0,
    archived: false,
    color: idea.color || undefined
  }
}

type SupportedIdeaPrompt = { title: string; placeholder: string; skippable?: boolean }
type LinkSupportedIdea = (parent: { id: string; text: string }) => Promise<void> | void

// Asks which idea something supports. The right parent often does not exist
// yet: "Create new" opens the idea modal for it and, on Save, puts it on a
// stack of drafts and asks what that one supports. Picking an existing idea,
// skipping or closing the search creates the whole stack as a chain:
// link(first draft), each draft supports the next, the last one the pick.
export function pickSupportedIdea(prompt: SupportedIdeaPrompt, link: LinkSupportedIdea): void {
  askForSupportedIdea(prompt, link, [])
}

function askForSupportedIdea(
  prompt: SupportedIdeaPrompt,
  link: LinkSupportedIdea,
  drafts: IdeaCreationParams[]
): void {
  const createChain = (top?: { id: string; text: string }) => createDraftChain(drafts, link, top)
  useUIModalStore().openIdeaSearch('pick', async (payload) => {
    if (payload.type === 'idea') return createChain(payload.data)
    if (!payload.data.createFromQuery) return createChain()
    const text = payload.data.query?.trim()
    if (!text) return createChain()
    // The search closes right after this callback returns; reopen after that.
    await Promise.resolve()
    draftSupportedIdea(text, {
      save: (draft) => askForSupportedIdea(
        { title: `What does "${draft.text}" support?`, placeholder: 'Optional: search for a parent idea...', skippable: true },
        link,
        [...drafts, draft]
      ),
      cancel: () => askForSupportedIdea(prompt, link, drafts)
    })
  }, undefined, {
    title: prompt.title,
    placeholder: prompt.placeholder,
    onDismiss: () => { void createChain() },
    additionalOptions: [
      ...(prompt.skippable ? [{
        id: 'skip-parent',
        label: 'Skip (no supported idea)',
        description: 'Leave this idea without a supported idea connection.',
        showWhenQueryEmptyOnly: true,
        actsAsEscape: true
      }] : []),
      { id: 'create-parent', label: 'Create new', createFromQuery: true }
    ]
  })
}

// Opens the idea modal for a draft. When it is already open (the picker was
// started from it), the draft is taken as typed instead.
function draftSupportedIdea(text: string, handlers: { save: (draft: IdeaCreationParams) => void; cancel: () => void }): void {
  const modalStore = useUIModalStore()
  if (modalStore.showIdeaModal) {
    handlers.save(toCreationParams({ text }))
    return
  }
  modalStore.openIdeaDraft({ text, ...handlers })
}

async function createDraftChain(
  drafts: IdeaCreationParams[],
  link: LinkSupportedIdea,
  top?: { id: string; text: string }
): Promise<void> {
  const projectPath = useProjectStore().projectPath
  let child: string | undefined
  for (const draft of drafts) {
    const { id } = await useDataStore().createFloatingIdea(projectPath, draft)
    if (child) await connectToParent(id, child)
    else await link({ id, text: draft.text })
    child = id
  }
  if (!top) return
  if (child) await connectToParent(top.id, child)
  else await link(top)
}
