<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useUIModalStore } from '../stores/ui/modal-store'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'
import TagInput from './TagInput.vue'
import NumericTextInput from './NumericTextInput.vue'
import type { PhaseSearchSelection } from '../stores/ui/phase-search-types'

const props = defineProps<{
  show: boolean
  aimId: string | null
  aimIds?: string[]
}>()

const emit = defineEmits<{
  close: []
}>()

const dataStore = useDataStore()
const projectStore = useProjectStore()
const modalStore = useUIModalStore()

const aim = computed(() => {
  if (!props.aimId) return null
  return dataStore.aims[props.aimId] || null
})
const editingAims = computed(() => {
  const ids = props.aimIds?.length ? props.aimIds : (props.aimId ? [props.aimId] : [])
  return ids.map((id) => dataStore.aims[id]).filter((entry): entry is NonNullable<typeof entry> => !!entry)
})
const isBulk = computed(() => editingAims.value.length > 1)
type BulkField = 'intrinsicValue' | 'cost' | 'loopWeight' | 'tags' |
  'status' | 'statusComment' | 'archived' | 'color' | 'reflection'
const mixedFields = ref<Set<BulkField>>(new Set())
const overriddenFields = ref<Set<BulkField>>(new Set())
const isMixed = (field: BulkField) => isBulk.value && mixedFields.value.has(field) && !overriddenFields.value.has(field)
const activateOverride = (field: BulkField) => {
  if (!isMixed(field)) return
  overriddenFields.value = new Set([...overriddenFields.value, field])
}
const mixedPlaceholder = (field: BulkField, fallback: string) =>
  isMixed(field) ? 'Multiple values - click to override all' : fallback
const sameValue = (values: unknown[]) => values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]))

const statuses = computed(() => dataStore.getStatuses)

const aimText = ref('')
const aimDescription = ref('')
const descriptionRows = ref(3)
const aimIntrinsicValue = ref(0)
const aimCost = ref(0)
const aimLoopWeight = ref(0)
const aimTags = ref<string[]>([])
const selectedStatus = ref('')
const statusComment = ref('')
const archived = ref(false)
const DEFAULT_COLOR = '#007acc'
const aimColor = ref('')
const colorInputRef = ref<HTMLInputElement>()

const activeColor = computed(() => {
  return aimColor.value || 'transparent'
})

const getStatusColor = (state: string) => {
  const status = statuses.value.find((s: any) => s.key === state)
  return status?.color || DEFAULT_COLOR
}

const colorPickerValue = computed(() => {
  return aimColor.value || getStatusColor(selectedStatus.value)
})

const triggerColorPicker = () => {
  colorInputRef.value?.click()
}

const clearCustomColor = () => {
  aimColor.value = ''
}

const headerStyle = computed((): Record<string, string> => {
  if (!aimColor.value) return {}
  return {
    background: `linear-gradient(to right, #2d2d2d, ${aimColor.value})`
  }
})

// An aim can only be archived from a "halted" (non-ongoing) status such as
// done, cancelled, failed or unclear. Ongoing statuses (open, partially,
// human-dependent) are still active work and must not be archived directly.
const canArchive = computed(() => {
  const states = isBulk.value && isMixed('status')
    ? editingAims.value.map((entry) => entry.status.state)
    : [selectedStatus.value]
  return states.length > 0 && states.every((state) => {
    const status = statuses.value.find((entry: any) => entry.key === state)
    return status ? !status.ongoing : false
  })
})

// If the status is moved back to an ongoing one, drop the archive flag so we
// never persist an archived aim that is still active.
watch(canArchive, (allowed) => {
  if (!allowed) archived.value = false
})
const reflection = ref('')
const supportedAimsList = ref<{ id: string, text: string, weight: number }[]>([])
const committedPhasesList = ref<{ id: string, name: string }[]>([])
// Repo-level cross-repo links: whole external repos that support this aim
// (black-box supporters, identified by repoId — no aimId). Staged locally like
// parents/phases and reconciled against the original set on save.
const linkedReposList = ref<{ repoId: string, name: string }[]>([])
const originalLinkedRepoIds = ref<string[]>([])
const confirmRemoveParentId = ref<string | null>(null)
const confirmRemovePhaseId = ref<string | null>(null)
const confirmRemoveRepoId = ref<string | null>(null)
const originalCommittedPhaseIds = ref<string[]>([])
type CommitEvidence = { hash: string, shortHash: string, subject: string, author: string, authoredAt: string }
const commitEvidence = ref<CommitEvidence[]>([])
const commitEvidenceLoading = ref(false)
const commitEvidenceError = ref('')

const loadCommitEvidence = async () => {
  if (!props.aimId || isBulk.value || !projectStore.projectPath) return
  commitEvidenceLoading.value = true
  commitEvidenceError.value = ''
  try {
    commitEvidence.value = await trpc.aim.commitEvidence.query({
      projectPath: projectStore.projectPath,
      aimId: props.aimId,
      limit: 20
    })
  } catch (error) {
    commitEvidence.value = []
    commitEvidenceError.value = error instanceof Error ? error.message : 'Could not read Git history'
  } finally {
    commitEvidenceLoading.value = false
  }
}

watch(() => [props.show, props.aimId] as const, ([show]) => {
  if (show) void loadCommitEvidence()
  else commitEvidence.value = []
}, { immediate: true })

// Snapshot of the form taken once it is fully populated, so we can detect
// unsaved edits when the user tries to leave (Escape / overlay click) and ask
// them to confirm rather than silently discarding their changes.
const dirtySnapshot = ref('')
const confirmingDiscard = ref(false)
const keepEditingBtn = ref<HTMLButtonElement>()
const discardBtn = ref<HTMLButtonElement>()

const serializeFormState = () => JSON.stringify({
  text: aimText.value,
  description: aimDescription.value,
  intrinsicValue: aimIntrinsicValue.value,
  cost: aimCost.value,
  loopWeight: aimLoopWeight.value,
  tags: aimTags.value,
  status: selectedStatus.value,
  statusComment: statusComment.value,
  archived: archived.value,
  color: aimColor.value,
  reflection: reflection.value,
  supportedAims: supportedAimsList.value.map((entry) => ({ id: entry.id, weight: entry.weight })),
  committedPhases: committedPhasesList.value.map((phase) => phase.id),
  linkedRepos: linkedReposList.value.map((entry) => entry.repoId),
  overrides: [...overriddenFields.value].sort()
})

const isDirty = computed(() => serializeFormState() !== dirtySnapshot.value)

const aimTextInput = ref<HTMLInputElement>()
const descriptionInput = ref<HTMLTextAreaElement>()
const statusCommentInput = ref<HTMLInputElement>()
const reflectionInput = ref<HTMLTextAreaElement>()
const loopWeightInput = ref<HTMLInputElement>()
const addParentBtn = ref<HTMLButtonElement>()
const addPhaseBtn = ref<HTMLButtonElement>()
const addRepoBtn = ref<HTMLButtonElement>()
const submitBtn = ref<HTMLButtonElement>()

const pendingFocusRestore = ref<'parent' | 'phase' | 'repo' | null>(null)
const defaultDescriptionRows = 3

const getInitialDescriptionRows = (description: string) => {
  if (!description) return defaultDescriptionRows
  return Math.max(defaultDescriptionRows, description.split(/\r\n|\r|\n/).length)
}

const openParentSearch = () => {
  pendingFocusRestore.value = 'parent'
  modalStore.openAimSearch('pick', (payload) => {
    if (payload.type !== 'aim') return
    const selectedAim = payload.data
    if (!supportedAimsList.value.some((entry) => entry.id === selectedAim.id)) {
      supportedAimsList.value.push({ id: selectedAim.id, text: selectedAim.text, weight: 1 })
    }
  }, undefined, {
    title: 'Select Supported Aim',
    placeholder: 'Search for a parent aim...'
  })
}

const openPhaseSearch = () => {
  pendingFocusRestore.value = 'phase'
  modalStore.openPhaseSearchPrompt((payload: PhaseSearchSelection) => {
    if (payload.type !== 'phase') return
    const phase = payload.data
    if (!committedPhasesList.value.some((entry) => entry.id === phase.id)) {
      committedPhasesList.value.push({ id: phase.id, name: phase.name })
    }
  }, {
    title: 'Commit In Phase',
    placeholder: 'Search for a phase...'
  })
}

const removeParent = (parentId: string) => {
  if (confirmRemoveParentId.value !== parentId) {
    confirmRemoveParentId.value = parentId
    return
  }

  supportedAimsList.value = supportedAimsList.value.filter((parent) => parent.id !== parentId)
  confirmRemoveParentId.value = null
}

const removeCommittedPhase = (phaseId: string) => {
  if (confirmRemovePhaseId.value !== phaseId) {
    confirmRemovePhaseId.value = phaseId
    return
  }

  committedPhasesList.value = committedPhasesList.value.filter((phase) => phase.id !== phaseId)
  confirmRemovePhaseId.value = null
}

// Registered linked repos not yet attached to this aim — the pickable options
// for "link a whole repo". Empty (and the add button disabled) when the project
// has no linked repos or they are all already linked.
const repoRegistry = computed(() => dataStore.meta?.linkedRepos ?? [])
const availableRepos = computed(() =>
  repoRegistry.value.filter((repo: { repoId: string }) => !linkedReposList.value.some((entry) => entry.repoId === repo.repoId))
)

const repoNameFor = (repoId: string) =>
  repoRegistry.value.find((repo: { repoId: string, name?: string }) => repo.repoId === repoId)?.name ?? `repo:${repoId.slice(0, 8)}`

const openRepoSearch = () => {
  if (availableRepos.value.length === 0) return
  pendingFocusRestore.value = 'repo'
  // Reuse the aim-search funnel but drive it entirely off additionalOptions:
  // one option per available linked repo (always visible, not aim results).
  modalStore.openAimSearch('pick', (payload) => {
    if (payload.type !== 'option') return
    const repoId = payload.data.id
    if (linkedReposList.value.some((entry) => entry.repoId === repoId)) return
    linkedReposList.value.push({ repoId, name: repoNameFor(repoId) })
  }, undefined, {
    title: 'Link a whole repo',
    placeholder: 'Pick a linked repo below…',
    additionalOptions: availableRepos.value.map((repo: { repoId: string, name: string, url?: string }) => ({
      id: repo.repoId,
      label: repo.name,
      description: repo.url || 'external repo (black box)'
    }))
  })
}

const removeLinkedRepo = (repoId: string) => {
  if (confirmRemoveRepoId.value !== repoId) {
    confirmRemoveRepoId.value = repoId
    return
  }

  linkedReposList.value = linkedReposList.value.filter((entry) => entry.repoId !== repoId)
  confirmRemoveRepoId.value = null
}

watch(() => props.show, async (show) => {
  if (show && aim.value) {
    const targets = editingAims.value
    const fieldValues: Record<BulkField, unknown[]> = {
      intrinsicValue: targets.map((entry) => entry.intrinsicValue ?? 0),
      cost: targets.map((entry) => entry.cost ?? 0),
      loopWeight: targets.map((entry) => entry.loopWeight ?? 0),
      tags: targets.map((entry) => entry.tags || []),
      status: targets.map((entry) => entry.status.state),
      statusComment: targets.map((entry) => entry.status.comment || ''),
      archived: targets.map((entry) => entry.archived ?? false),
      color: targets.map((entry) => entry.color ?? ''),
      reflection: targets.map((entry) => entry.reflection || '')
    }
    mixedFields.value = new Set(
      (Object.keys(fieldValues) as BulkField[]).filter((field) => !sameValue(fieldValues[field]))
    )
    overriddenFields.value = new Set()
    confirmRemoveParentId.value = null
    confirmRemovePhaseId.value = null
    confirmRemoveRepoId.value = null
    confirmingDiscard.value = false
    aimText.value = aim.value.text
    aimDescription.value = aim.value.description || ''
    descriptionRows.value = getInitialDescriptionRows(aimDescription.value)
    aimIntrinsicValue.value = isMixed('intrinsicValue') ? 0 : (aim.value.intrinsicValue ?? 0)
    aimCost.value = isMixed('cost') ? 0 : (aim.value.cost ?? 0)
    aimLoopWeight.value = isMixed('loopWeight') ? 0 : (aim.value.loopWeight ?? 0)
    aimTags.value = isMixed('tags') ? [] : [...(aim.value.tags || [])]
    selectedStatus.value = isMixed('status') ? '' : aim.value.status.state
    statusComment.value = isMixed('statusComment') ? '' : (aim.value.status.comment || '')
    archived.value = isMixed('archived') ? false : (aim.value.archived ?? false)
    aimColor.value = isMixed('color') ? '' : (aim.value.color ?? '')
    reflection.value = isMixed('reflection') ? '' : (aim.value.reflection || '')

    supportedAimsList.value = []
    committedPhasesList.value = []
    originalCommittedPhaseIds.value = [...(aim.value.committedIn || [])]

    // Repo links live on the aim itself (no fetch needed); resolve display
    // names from the portable registry in meta.
    linkedReposList.value = (aim.value.supportingRepos || []).map((edge) => ({
      repoId: edge.repoId,
      name: repoNameFor(edge.repoId)
    }))
    originalLinkedRepoIds.value = linkedReposList.value.map((entry) => entry.repoId)

    if (aim.value.supportedAims && aim.value.supportedAims.length > 0) {
      try {
        const parents = await trpc.aim.list.query({
          projectPath: projectStore.projectPath,
          ids: aim.value.supportedAims
        })
        supportedAimsList.value = parents.map((parent) => ({
          id: parent.id,
          text: parent.text,
          weight: 1
        }))
      } catch (error) {
        console.error('Failed to load supported aims', error)
      }
    }

    if (aim.value.committedIn && aim.value.committedIn.length > 0) {
      try {
        const phases = await Promise.all(
          aim.value.committedIn.map((phaseId) =>
            trpc.phase.get.query({
              projectPath: projectStore.projectPath,
              phaseId
            }).catch(() => null)
          )
        )

        committedPhasesList.value = phases
          .filter((phase): phase is NonNullable<typeof phase> => phase !== null)
          .map((phase) => ({
            id: phase.id,
            name: phase.name
          }))
      } catch (error) {
        console.error('Failed to load committed phases', error)
      }
    }

    dirtySnapshot.value = serializeFormState()

    await nextTick()
    aimTextInput.value?.focus()
  }
})

watch(() => modalStore.showAimSearch, async (isOpen, wasOpen) => {
  if (!isOpen && wasOpen && pendingFocusRestore.value === 'parent' && props.show) {
    await nextTick()
    addParentBtn.value?.focus()
    pendingFocusRestore.value = null
  }
})

watch(() => modalStore.showPhaseSearchPrompt, async (isOpen, wasOpen) => {
  if (!isOpen && wasOpen && pendingFocusRestore.value === 'phase' && props.show) {
    await nextTick()
    addPhaseBtn.value?.focus()
    pendingFocusRestore.value = null
  }
})

watch(() => modalStore.showAimSearch, async (isOpen, wasOpen) => {
  if (!isOpen && wasOpen && pendingFocusRestore.value === 'repo' && props.show) {
    await nextTick()
    addRepoBtn.value?.focus()
    pendingFocusRestore.value = null
  }
})

const handleModalKeydown = (event: KeyboardEvent) => {
  event.stopPropagation()

  if (event.key === 'Escape') {
    event.preventDefault()
    handleCancel()
    return
  }

  if (confirmingDiscard.value) {
    return
  }

  if (event.key === 'Enter') {
    const target = event.target as HTMLElement | null
    const tagName = target?.tagName

    if (tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) {
      return
    }

    if (tagName === 'BUTTON') {
      return
    }

    event.preventDefault()
    handleSave()
  }
}

const handleInputKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    handleSave()
  }
}

const handleTextareaKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    event.stopPropagation()
    handleSave()
  }
}

const handleStatusCommentNext = (event: KeyboardEvent) => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    reflectionInput.value?.focus()
  }
}

const handleLoopWeightNext = (event: KeyboardEvent) => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    addParentBtn.value?.focus()
  }
}

const handleTagPrev = () => {
  loopWeightInput.value?.focus()
}

const handleTagNext = () => {
  submitBtn.value?.focus()
}

const handleSave = async () => {
  if (!aim.value || !projectStore.projectPath) return

  const shouldWrite = (field: BulkField) => !isBulk.value || !mixedFields.value.has(field) || overriddenFields.value.has(field)
  for (const target of editingAims.value) {
    const updates: any = {}
    if (!isBulk.value) updates.text = aimText.value
    if (!isBulk.value) updates.description = aimDescription.value
    if (shouldWrite('intrinsicValue')) updates.intrinsicValue = aimIntrinsicValue.value
    if (shouldWrite('cost')) updates.cost = aimCost.value
    if (shouldWrite('loopWeight')) updates.loopWeight = aimLoopWeight.value
    if (shouldWrite('tags')) updates.tags = aimTags.value
    if (shouldWrite('reflection')) updates.reflection = reflection.value || undefined
    if (shouldWrite('archived')) updates.archived = archived.value
    if (shouldWrite('color')) updates.color = aimColor.value || null
    if (shouldWrite('status') || shouldWrite('statusComment')) {
      updates.status = {
        state: shouldWrite('status') ? selectedStatus.value : target.status.state,
        comment: shouldWrite('statusComment') ? statusComment.value : target.status.comment,
        date: Date.now()
      }
    }
    if (!isBulk.value) updates.supportedAims = supportedAimsList.value.map((entry) => entry.id)
    await dataStore.updateAim(projectStore.projectPath, target.id, updates)
  }

  if (isBulk.value) {
    emit('close')
    return
  }
  const currentCommittedPhaseIds = committedPhasesList.value.map((phase) => phase.id)
  const phasesToRemove = originalCommittedPhaseIds.value.filter((phaseId) => !currentCommittedPhaseIds.includes(phaseId))
  const phasesToAdd = currentCommittedPhaseIds.filter((phaseId) => !originalCommittedPhaseIds.value.includes(phaseId))

  for (const phaseId of phasesToRemove) {
    await dataStore.removeAimFromPhase(projectStore.projectPath, aim.value.id, phaseId)
  }

  for (const phaseId of phasesToAdd) {
    await dataStore.commitAimToPhase(projectStore.projectPath, aim.value.id, phaseId)
  }

  // Reconcile repo links against the original set (handleSave's updateAim above
  // doesn't touch supportingRepos, so these dedicated mutations own them).
  const currentLinkedRepoIds = linkedReposList.value.map((entry) => entry.repoId)
  const reposToRemove = originalLinkedRepoIds.value.filter((repoId) => !currentLinkedRepoIds.includes(repoId))
  const reposToAdd = currentLinkedRepoIds.filter((repoId) => !originalLinkedRepoIds.value.includes(repoId))

  for (const repoId of reposToRemove) {
    await trpc.aim.unlinkRepo.mutate({ projectPath: projectStore.projectPath, aimId: aim.value.id, repoId })
  }

  for (const repoId of reposToAdd) {
    await trpc.aim.linkRepo.mutate({ projectPath: projectStore.projectPath, aimId: aim.value.id, repoId })
  }

  if (reposToRemove.length > 0 || reposToAdd.length > 0) {
    await dataStore.loadAims(projectStore.projectPath, [aim.value.id])
  }

  emit('close')
}

const handleCancel = () => {
  // Leaving with unsaved edits is easy to do by accident (Escape out of a
  // textarea, stray overlay click), so ask for confirmation first.
  if (isDirty.value) {
    if (!confirmingDiscard.value) {
      confirmingDiscard.value = true
      nextTick(() => discardBtn.value?.focus())
      return
    } else {
      keepEditing()
      return
    }
  }
  confirmingDiscard.value = false
  emit('close')
}

const keepEditing = () => {
  confirmingDiscard.value = false
  nextTick(() => aimTextInput.value?.focus())
}

const discardChanges = () => {
  confirmingDiscard.value = false
  emit('close')
}
</script>

<template>
  <FormModalShell
    :show="show"
    :title="isBulk ? `Edit ${editingAims.length} Aims` : 'Edit Aim'"
    :entity-id="aimId"
    :header-style="headerStyle"
    @request-close="handleCancel"
  >
    <template #header-right>
      <div class="color-picker-wrapper" :class="{ 'mixed-field': isMixed('color') }">
        <button
          v-if="isMixed('color')"
          type="button"
          class="mixed-color-activate"
          title="Multiple colors - click to override all"
          @click="activateOverride('color')"
        >
          Multiple
        </button>
        <input
          ref="colorInputRef"
          type="color"
          class="hidden-color-input"
          :value="colorPickerValue"
          @input="aimColor = ($event.target as HTMLInputElement).value"
        />
        <button
          v-if="!isMixed('color')"
          type="button"
          class="color-picker-trigger"
          :style="{ backgroundColor: activeColor }"
          @click="triggerColorPicker"
          title="Select custom color"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="palette-icon">
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.03345 19.1749 5.27909 19.243 5.51409 19.1763C5.7491 19.1096 5.92728 18.9213 5.98978 18.6713C6.155 18.0105 6.75 17.5 7.5 17.5H8.5C9.32843 17.5 10 18.1716 10 19V21.5C10 21.7761 10.2239 22 10.5 22H12Z" />
            <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
            <circle cx="11.5" cy="7.5" r="1" fill="currentColor" />
            <circle cx="16.5" cy="9.5" r="1" fill="currentColor" />
            <circle cx="15.5" cy="14.5" r="1" fill="currentColor" />
          </svg>
        </button>
        <button
          v-if="aimColor"
          type="button"
          class="clear-color-btn"
          @click="clearCustomColor"
          title="Clear custom color (revert to status color)"
        >
          ×
        </button>
      </div>
    </template>

    <div class="modal-content-root" tabindex="-1" @keydown.capture="handleModalKeydown">
      <template v-if="isBulk">
        <p class="bulk-notice">
          Editing {{ editingAims.length }} aims. Mixed fields are unchanged unless you click them to override all.
        </p>
        <ul class="bulk-aim-titles">
          <li v-for="editingAim in editingAims" :key="editingAim.id">{{ editingAim.text }}</li>
        </ul>
      </template>
      <div v-if="!isBulk" class="form-section">
        <label>Title</label>
        <input
          ref="aimTextInput"
          v-model="aimText"
          type="text"
          placeholder="Aim title..."
          class="text-input"
          @keydown="handleInputKeydown"
          @keydown.shift.tab.exact.prevent="submitBtn?.focus()"
        />
      </div>

      <div v-if="!isBulk" class="form-section">
        <label>Description</label>
        <textarea
          ref="descriptionInput"
          v-model="aimDescription"
          placeholder="Optional description..."
          class="textarea-input"
          :rows="descriptionRows"
          @keydown="handleTextareaKeydown"
        />
      </div>

      <div class="form-section" :class="{ 'mixed-field': isMixed('status') }">
        <label>Status</label>
        <button
          v-if="isMixed('status')"
          type="button"
          class="mixed-activate"
          @click="activateOverride('status')"
        >
          Multiple values - click to override all
        </button>
        <select
          v-else
          v-model="selectedStatus"
          class="status-select"
          @keydown="handleInputKeydown"
        >
          <option v-for="status in statuses" :key="status.key" :value="status.key">
            {{ status.key }}
          </option>
        </select>
      </div>

      <div class="form-section" :class="{ 'mixed-field': isMixed('statusComment') }" @click="activateOverride('statusComment')">
        <label>Status Comment</label>
        <input
          ref="statusCommentInput"
          v-model="statusComment"
          type="text"
          :placeholder="mixedPlaceholder('statusComment', 'Optional comment about status...')"
          :readonly="isMixed('statusComment')"
          class="text-input"
          @keydown="handleInputKeydown"
          @keydown.tab.exact="handleStatusCommentNext"
        />
      </div>

      <div v-if="canArchive" class="form-section" :class="{ 'mixed-field': isMixed('archived') }">
        <button
          v-if="isMixed('archived')"
          type="button"
          class="mixed-activate"
          @click="activateOverride('archived')"
        >
          Multiple archive values - click to override all
        </button>
        <label class="archive-toggle">
          <input
            v-if="!isMixed('archived')"
            type="checkbox"
            v-model="archived"
            @keydown="handleInputKeydown"
          />
          <span>Archive this aim</span>
        </label>
      </div>

      <div class="form-section" :class="{ 'mixed-field': isMixed('reflection') }" @click="activateOverride('reflection')">
        <label>Reflection</label>
        <textarea
          ref="reflectionInput"
          v-model="reflection"
          :placeholder="mixedPlaceholder('reflection', 'How did this aim go? What did you learn?')"
          :readonly="isMixed('reflection')"
          class="textarea-input"
          rows="4"
          @keydown="handleTextareaKeydown"
        />
      </div>

      <div v-if="!isBulk" class="form-section">
        <label>Supports (Parents)</label>
        <div class="entry-list">
          <div v-for="parent in supportedAimsList" :key="parent.id" class="entry-row">
            <span class="entry-name">{{ parent.text }}</span>
            <label class="entry-meta">
              <span class="entry-meta-label">Weight</span>
              <NumericTextInput v-model="parent.weight" class="entry-inline-input" />
            </label>
            <button
              @click="removeParent(parent.id)"
              class="entry-action"
              :class="{ confirm: confirmRemoveParentId === parent.id }"
              type="button"
            >
              {{ confirmRemoveParentId === parent.id ? 'Confirm' : 'Remove' }}
            </button>
          </div>
          <button
            ref="addParentBtn"
            @click="openParentSearch"
            class="entry-placeholder"
            type="button"
            title="Add supported aim"
          >
            add supported aim
          </button>
        </div>
      </div>

      <div v-if="!isBulk" class="form-section">
        <label>Linked repos</label>
        <div class="entry-list">
          <div v-for="repo in linkedReposList" :key="repo.repoId" class="entry-row">
            <span class="entry-name">{{ repo.name }}</span>
            <span class="entry-meta entry-badge">Repo</span>
            <button
              @click="removeLinkedRepo(repo.repoId)"
              class="entry-action"
              :class="{ confirm: confirmRemoveRepoId === repo.repoId }"
              type="button"
            >
              {{ confirmRemoveRepoId === repo.repoId ? 'Confirm' : 'Remove' }}
            </button>
          </div>
          <button
            ref="addRepoBtn"
            @click="openRepoSearch"
            class="entry-placeholder"
            type="button"
            title="Link a whole repo"
            :disabled="availableRepos.length === 0"
          >
            {{ repoRegistry.length === 0 ? 'no linked repos in this project' : 'link a whole repo' }}
          </button>
        </div>
      </div>

      <div v-if="!isBulk" class="form-section">
        <label>Committed In</label>
        <div class="entry-list">
          <div v-for="phase in committedPhasesList" :key="phase.id" class="entry-row">
            <span class="entry-name">{{ phase.name }}</span>
            <span class="entry-meta entry-badge">Phase</span>
            <button
              @click="removeCommittedPhase(phase.id)"
              class="entry-action"
              :class="{ confirm: confirmRemovePhaseId === phase.id }"
              type="button"
            >
              {{ confirmRemovePhaseId === phase.id ? 'Confirm' : 'Remove' }}
            </button>
          </div>
          <button
            ref="addPhaseBtn"
            @click="openPhaseSearch"
            class="entry-placeholder"
            type="button"
            title="Commit in phase"
          >
            commit in phase
          </button>
        </div>
      </div>

      <div v-if="!isBulk" class="form-section">
        <label>Implementation evidence</label>
        <div class="entry-list">
          <span v-if="commitEvidenceLoading" class="entry-placeholder">reading Git history…</span>
          <span v-else-if="commitEvidenceError" class="entry-placeholder">{{ commitEvidenceError }}</span>
          <span v-else-if="commitEvidence.length === 0" class="entry-placeholder">no commits reference this aim yet</span>
          <div v-for="commit in commitEvidence" v-else :key="commit.hash" class="entry-row">
            <span class="entry-name">{{ commit.subject }}</span>
            <span class="entry-meta entry-badge" :title="`${commit.author} · ${commit.authoredAt}`">{{ commit.shortHash }}</span>
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group" :class="{ 'mixed-field': isMixed('intrinsicValue') }" @click="activateOverride('intrinsicValue')">
          <label>Intrinsic Value</label>
          <input
            v-model.number="aimIntrinsicValue"
            type="text"
            class="text-input"
            :placeholder="mixedPlaceholder('intrinsicValue', '0')"
            :readonly="isMixed('intrinsicValue')"
            @keydown="handleInputKeydown"
          />
        </div>

        <div class="form-group" :class="{ 'mixed-field': isMixed('cost') }" @click="activateOverride('cost')">
          <label>Cost</label>
          <input
            v-model.number="aimCost"
            type="text"
            class="text-input"
            :placeholder="mixedPlaceholder('cost', '0')"
            :readonly="isMixed('cost')"
            @keydown="handleInputKeydown"
          />
        </div>

        <div class="form-group" :class="{ 'mixed-field': isMixed('loopWeight') }" @click="activateOverride('loopWeight')">
          <label>Loop Weight</label>
          <input
            ref="loopWeightInput"
            v-model.number="aimLoopWeight"
            type="text"
            class="text-input"
            :placeholder="mixedPlaceholder('loopWeight', '0')"
            :readonly="isMixed('loopWeight')"
            @keydown="handleInputKeydown"
            @keydown.tab.exact="handleLoopWeightNext"
          />
        </div>
      </div>

      <div class="form-section" :class="{ 'mixed-field': isMixed('tags') }" @click="activateOverride('tags')">
        <button v-if="isMixed('tags')" type="button" class="mixed-activate">
          Multiple tag values - click to override all
        </button>
        <TagInput
          v-else
          v-model="aimTags"
          label="Tags"
          @next-field="handleTagNext"
          @prev-field="handleTagPrev"
        />
      </div>
    </div>

    <div v-if="confirmingDiscard" class="discard-overlay">
      <div class="discard-prompt">
        <p class="discard-title">Discard unsaved changes?</p>
        <p class="discard-hint">You have edits that haven't been saved.</p>
        <div class="discard-actions">
          <button ref="keepEditingBtn" type="button" class="btn-cancel" @click="keepEditing">Keep editing</button>
          <button ref="discardBtn" type="button" class="btn-discard" @click="discardChanges">Discard</button>
        </div>
      </div>
    </div>

    <template #footer>
      <button @click="handleCancel" class="btn-cancel">Cancel</button>
      <button
        ref="submitBtn"
        @click="handleSave"
        class="btn-save"
        @keydown.tab.exact.prevent="aimTextInput?.focus()"
      >
        Save
      </button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.form-section {
  margin-bottom: 0.75rem;
}

.bulk-notice {
  margin: 0 0 0.75rem;
  padding: 0.625rem;
  border-left: 3px solid #d29b35;
  background: #292316;
  color: #e8d4aa;
  font-size: 0.85rem;
}

.bulk-aim-titles {
  max-height: 130px;
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.5rem 0.5rem 1.75rem;
  overflow-y: auto;
  border: 1px solid #444;
  color: #ccc;
}

.mixed-field {
  cursor: pointer;
}

.mixed-field :is(input, textarea, select, button) {
  cursor: pointer;
  border-color: #8b6a2d;
}

.mixed-activate {
  width: 100%;
  padding: 0.5rem;
  border: 1px dashed #8b6a2d;
  background: #211d15;
  color: #d8c18e;
  text-align: left;
}

.mixed-color-activate {
  min-width: 5rem;
  height: 1.75rem;
  padding: 0 0.5rem;
  border: 1px dashed #8b6a2d;
  background: #211d15;
  color: #d8c18e;
}

label {
  display: block;
  margin-bottom: 0.375rem;
  color: #ccc;
  font-size: 0.9rem;
  font-weight: 700;

  &.archive-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0;
    cursor: pointer;
  }
}

.color-picker-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hidden-color-input {
  opacity: 0;
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}

.color-picker-trigger {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  border: 1px solid #555;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}

.color-picker-trigger:hover {
  transform: scale(1.1);
  box-shadow: 0 3px 6px rgba(0,0,0,0.3);
}

.palette-icon {
  filter: drop-shadow(0px 1px 1px rgba(0, 0, 0, 0.8));
}

.clear-color-btn {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #ccc;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}

.clear-color-btn:hover {
  background: rgba(255, 0, 0, 0.3);
  color: #fff;
}

.status-select,
.text-input,
.textarea-input {
  width: 100%;
  padding: 0.5rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  color: #e0e0e0;
  font-size: 0.9rem;
}

.status-select:focus,
.text-input:focus,
.textarea-input:focus {
  outline: none;
  border-color: #007acc;
}

.textarea-input {
  font-family: inherit;
  resize: vertical;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.entry-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.65rem;
}

.entry-name {
  min-width: 0;
  display: block;
  padding: 0.45rem 0.6rem;
  background: #252525;
  border: 1px solid #444;
  border-radius: 0.1875rem;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0;
  color: #bbb;
  white-space: nowrap;
}

.entry-meta-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #888;
}

.entry-inline-input {
  width: 4.5rem;
  padding: 0.3rem 0.4rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  color: #e0e0e0;
  font-size: 0.85rem;
}

.entry-badge {
  justify-self: start;
  padding: 0.2rem 0.45rem;
  background: #252525;
  border: 1px solid #444;
  border-radius: 999px;
  font-size: 0.78rem;
  color: #bbb;
}

.entry-action,
.entry-placeholder {
  appearance: none;
  display: block;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  font-size: 0.85rem;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.entry-action {
  padding: 0.4rem 0.65rem;
  background: #444;
  color: #e0e0e0;
}

.entry-action:hover {
  background: #555;
}

.entry-action.confirm {
  background: #6a3a3a;
  border-color: #8a4a4a;
  color: #fff;
}

.entry-action.confirm:hover {
  background: #7a4545;
}

.entry-placeholder {
  width: 100%;
  padding: 0.55rem 0.7rem;
  background: transparent;
  color: #aaa;
  text-align: left;
}

.entry-placeholder:hover,
.entry-placeholder:focus {
  background: #333;
  border-color: #666;
  color: #fff;
  outline: none;
}

.modal-actions {
  display: flex;
  gap: 0.375rem;
  justify-content: flex-end;
}

.btn-cancel,
.btn-save {
  appearance: none;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.1875rem;
  font-size: 0.9rem;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
}

.btn-cancel {
  background: #444;
  color: #e0e0e0;
}

.btn-cancel:hover {
  background: #555;
}

.btn-save {
  background: #007acc;
  color: white;
}

.btn-save:hover {
  background: #005a99;
}

.discard-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
}

.discard-prompt {
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 0.3125rem;
  padding: 1.25rem;
  max-width: min(90vw, 24rem);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.discard-title {
  margin: 0 0 0.5rem;
  color: #e0e0e0;
  font-size: 1.05rem;
  font-weight: 700;
}

.discard-hint {
  margin: 0 0 1rem;
  color: #aaa;
  font-size: 0.9rem;
}

.discard-actions {
  display: flex;
  gap: 0.375rem;
  justify-content: flex-end;
}

.btn-discard {
  appearance: none;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.1875rem;
  font-size: 0.9rem;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  background: #6a3a3a;
  color: #fff;
}

.btn-discard:hover {
  background: #7a4545;
}

.form-row {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.form-group {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.form-group label {
  margin-bottom: 0.375rem;
}
</style>
