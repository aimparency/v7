import { trpc } from '../../trpc'
import type { AimCreationParams } from '../data'
import { useUIModalStore } from './modal-store'
import { useProjectStore } from '../project-store'

export async function createAimAction(
  uiStore: any,
  dataStore: any,
  aimTextOrId: string,
  isExistingAim: boolean,
  aimAttributes: AimCreationParams,
  weight: number
) {
  const modalStore = useUIModalStore()
  const projectStore = useProjectStore()
  const path = uiStore.getSelectionPath()
  let newAimId: string | undefined

  if (path.aims.length === 0) {
    if (path.phase) {
      if (isExistingAim) {
        await trpc.aim.commitToPhase.mutate({
          projectPath: projectStore.projectPath,
          aimId: aimTextOrId,
          phaseId: path.phase.id,
          insertionIndex: 0
        })
        newAimId = aimTextOrId
      } else {
        const result = await dataStore.createCommittedAim(projectStore.projectPath, path.phase.id, aimAttributes, 0)
        newAimId = result.id
      }

      await dataStore.loadPhaseAims(projectStore.projectPath, path.phase.id)
    } else if (isExistingAim) {
      if (modalStore.aimCreationCallback) {
        newAimId = aimTextOrId
      } else {
        modalStore.showAimModal = false
        return
      }
    } else {
      const result = await dataStore.createFloatingAim(projectStore.projectPath, aimAttributes)
      newAimId = result.id
    }
  } else {
    const currentAim = path.aims[path.aims.length - 1]
    if (!currentAim) {
      modalStore.showAimModal = false
      return
    }

    if (currentAim.expanded && modalStore.aimModalInsertPosition === 'after') {
      if (isExistingAim) {
        await trpc.aim.connectAims.mutate({
          projectPath: projectStore.projectPath,
          parentAimId: currentAim.id,
          childAimId: aimTextOrId,
          parentIncomingIndex: 0,
          weight
        })
        newAimId = aimTextOrId

        const updatedParent = await trpc.aim.get.query({
          projectPath: projectStore.projectPath,
          aimId: currentAim.id
        })
        dataStore.replaceAim(currentAim.id, updatedParent)
      } else {
        const result = await dataStore.createSubAim(projectStore.projectPath, currentAim.id, aimAttributes, 0, weight)
        newAimId = result.id
      }

      const freshParent = dataStore.aims[currentAim.id]
      if (freshParent) {
        freshParent.selectedIncomingIndex = 0
      }
    } else if (path.aims.length > 1) {
      const parentAim = path.aims[path.aims.length - 2]
      if (parentAim) {
        let insertionIndex = parentAim.selectedIncomingIndex ?? 0
        if (modalStore.aimModalInsertPosition === 'after') {
          insertionIndex++
        }

        if (isExistingAim) {
          await trpc.aim.connectAims.mutate({
            projectPath: projectStore.projectPath,
            parentAimId: parentAim.id,
            childAimId: aimTextOrId,
            parentIncomingIndex: insertionIndex,
            weight
          })
          newAimId = aimTextOrId

          const updatedParent = await trpc.aim.get.query({
            projectPath: projectStore.projectPath,
            aimId: parentAim.id
          })
          dataStore.replaceAim(parentAim.id, updatedParent)
        } else {
          const result = await dataStore.createSubAim(projectStore.projectPath, parentAim.id, aimAttributes, insertionIndex, weight)
          newAimId = result.id
        }

        const freshParent = dataStore.aims[parentAim.id]
        if (freshParent) {
          freshParent.selectedIncomingIndex = insertionIndex
        }
      }
    } else if (path.phase) {
      let insertionIndex = 0
      const phase = dataStore.phases[path.phase.id]
      if (phase && phase.selectedAimIndex !== undefined) {
        insertionIndex = phase.selectedAimIndex + (modalStore.aimModalInsertPosition === 'after' ? 1 : 0)
      }

      if (isExistingAim) {
        await trpc.aim.commitToPhase.mutate({
          projectPath: projectStore.projectPath,
          aimId: aimTextOrId,
          phaseId: path.phase.id,
          insertionIndex
        })
        newAimId = aimTextOrId

        const updatedPhase = await trpc.phase.get.query({
          projectPath: projectStore.projectPath,
          phaseId: path.phase.id
        })
        dataStore.replacePhase(path.phase.id, updatedPhase)
      } else {
        const result = await dataStore.createCommittedAim(projectStore.projectPath, path.phase.id, aimAttributes, insertionIndex)
        newAimId = result.id
      }

      const freshPhase = dataStore.phases[path.phase.id]
      if (freshPhase) {
        freshPhase.selectedAimIndex = insertionIndex
      }
    } else if (isExistingAim) {
      if (modalStore.aimCreationCallback) {
        newAimId = aimTextOrId
      } else {
        modalStore.showAimModal = false
        return
      }
    } else {
      const result = await dataStore.createFloatingAim(projectStore.projectPath, aimAttributes)
      newAimId = result.id
    }
  }

  if (newAimId) {
    if (modalStore.aimCreationCallback) {
      modalStore.aimCreationCallback(newAimId)
      modalStore.aimCreationCallback = null
    }

    if (path.phase) {
      const aims = dataStore.getAimsForPhase(path.phase.id)
      const newAimIndex = aims.findIndex((aim: any) => aim.id === newAimId)
      if (newAimIndex !== -1) {
        const phase = dataStore.phases[path.phase.id]
        if (phase) {
          phase.selectedAimIndex = newAimIndex
        }
      }
    } else {
      const newAimIndex = dataStore.floatingAims.findIndex((aim: any) => aim.id === newAimId)
      if (newAimIndex !== -1) {
        uiStore.floatingAimIndex = newAimIndex
      }
    }
  }

  modalStore.showAimModal = false
}
