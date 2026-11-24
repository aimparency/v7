<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { useProjectLoadStore } from '../stores/project-load'
import { trpc } from '../trpc'
import { useToastStore } from '../stores/toast'
import { DEFAULT_IDEA_COST, INITIAL_STATES, defaultIdeaCost, fetchSpaceAtHost } from 'shared'
import type { AgentType } from '../stores/watchdog'
import { Check, X } from 'lucide-vue-next'
import { hasAccounts } from '../utils/runtime-config'
import { useViewerStore } from '../stores/viewer'
import { useModalEscape } from '../composables/useModalEscape'

const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()
const name = ref('')
const color = ref('#007acc')
const initialInstructions = ref('')
const supervisorGuidancePrefix = ref('')
const costUnit = ref('')
const defaultCost = ref(DEFAULT_IDEA_COST)
const costSettingsError = ref('')
const statuses = ref<Array<{ key: string, color: string, promptsReflection?: boolean }>>([])
const loading = ref(false)
const isUpdatingInstructions = ref(false)
const updateResults = ref<string[]>([])
const issueRepository = ref('')
const isImportingIssues = ref(false)
const issueImportResult = ref('')
const autonomyMode = ref<'manual' | 'supervised' | 'autonomous'>('supervised')
const preferredAgentType = ref<AgentType | ''>('')
const sessionLeaseMinutes = ref(60)
const autoConnectToExistingSession = ref(true)
const restoreSupervisorStateOnSessionRestart = ref(true)
const requireCommitBeforeCompact = ref(true)
const askForHumanOnText = ref('destructive-git, network, api-keys')

// Linked repos (portable cross-repo links). Registering a sibling project here
// is what populates meta.linkedRepos, which the idea-edit modal's 'link a whole
// repo' picker then reads. Register/unregister are applied immediately (their
// own mutations); the modal's Save merges name/color/statuses and preserves
// linkedRepos, so there's no clobber.
type LinkedRepoRow = { repoId: string, name: string, host?: string, url?: string, localPath?: string, access?: string, resolved: boolean }
const linkedRepos = ref<LinkedRepoRow[]>([])
const discoveredProjects = ref<Array<{ path: string, bowmanPath: string, sourceRoot: string }>>([])
const selectedTargetPath = ref('')
const repoBusy = ref(false)
const confirmUnlinkRepoId = ref<string | null>(null)

// Discovered projects that aren't this project and aren't already linked —
// matched on the target's .bowman path (register stores it as localPath).
const availableRepoTargets = computed(() => {
  const linkedPaths = new Set(linkedRepos.value.map((r) => r.localPath).filter(Boolean))
  const selfBowman = projectStore.projectPath.replace(/\/+$/, '')
  return discoveredProjects.value.filter(
    (p) => p.bowmanPath !== selfBowman && !linkedPaths.has(p.bowmanPath)
  )
})

const projectLabel = (p: { path: string }) => p.path.split('/').filter(Boolean).pop() || p.path

async function loadLinkedRepos() {
  if (!projectStore.projectPath) return
  linkedRepos.value = await trpc.linkedRepo.list.query({ space: projectStore.projectPath })
}

// With accounts other people use this server: no directories of the machine,
// no agents, so the sections about them are left out.
const accounts = hasAccounts()

// Who may use this space. Its owner names the accounts that may also change it,
// and who else reads it: everyone, every account, or the accounts named.
const spaceAccess = ref<Awaited<ReturnType<typeof trpc.spaces.getAccess.query>>>(null)
// owner: everything; manage: who else writes and reads, invitations too; the
// owner alone chooses the managers, who reads at all, the address and the key.
const isOwner = computed(() => dataStore.access.role === 'owner')
const mayManageAccess = computed(() => dataStore.access.role === 'owner' || dataStore.access.role === 'manage')

async function loadSpaceAccess() {
  if (accounts) spaceAccess.value = await trpc.spaces.getAccess.query({ space: projectStore.projectPath })
  slug.value = spaceAccess.value?.slug ?? ''
}

type AccessChange = Omit<Parameters<typeof trpc.spaces.setAccess.mutate>[0], 'space'>
async function setAccess(change: AccessChange) {
  try {
    await trpc.spaces.setAccess.mutate({ space: projectStore.projectPath, ...change })
    newPerson.value = newNoteWriter.value = ''
    await loadSpaceAccess()
  } catch (e) {
    useToastStore().error('Could not change who may use this space', e)
  }
}
const newNoteWriter = ref('')

// The people of the space, each with their highest role: one list of managers,
// writers and readers. Readers count where only named accounts read it.
type Role = 'manage' | 'write' | 'read'
const ROLE_LABELS: Record<Role, string> = { manage: 'manages', write: 'writes', read: 'reads' }
const ROLE_LISTS = { manage: 'managers', write: 'writers', read: 'readers' } as const
const people = computed(() => {
  const access = spaceAccess.value
  if (!access) return []
  const roles = new Map<string, Role>()
  for (const name of access.readers) roles.set(name, 'read')
  for (const name of access.writers) roles.set(name, 'write')
  for (const name of access.managers) roles.set(name, 'manage')
  return [...roles].map(([name, role]) => ({ name, role }))
})
const newPerson = ref('')
const newPersonRole = ref<Role>('write')
// A manager changes the roles of those who write and read; the owner everyone's.
const mayChangeRole = (role: Role) => mayManageAccess.value && (isOwner.value || role !== 'manage')
// Out of the space; the invitation it came by, if any, goes with it.
async function removePerson(name: string, invitationId?: string) {
  if (!window.confirm(`Take ${name} out of this space?`)) return
  setRole(name, null)
  if (invitationId) await removeSpaceInvitation(invitationId)
}

// The owner hands the space over to someone of it, and stays in it as a manager.
const newOwner = ref('')
async function handOver() {
  const access = spaceAccess.value
  if (!access || !newOwner.value) return
  if (!window.confirm(`Hand this space over to ${newOwner.value}? They decide everything about it from then on; you stay in it as a manager.`)) return
  const next = newOwner.value
  const without = (list: string[]) => list.filter(name => name !== next)
  await setAccess({
    owner: next,
    managers: [...without(access.managers), ...(access.owner && access.owner !== next ? [access.owner] : [])],
    writers: without(access.writers),
    readers: without(access.readers)
  })
  newOwner.value = ''
  await dataStore.refreshAccess(projectStore.projectPath)
}

// Out of every list, then into the one of the role (null: out of the space).
function setRole(name: string, role: Role | null) {
  const access = spaceAccess.value
  if (!access || !name.trim()) return
  const change: AccessChange = {}
  for (const [listRole, list] of Object.entries(ROLE_LISTS) as [Role, typeof ROLE_LISTS[Role]][]) {
    const before = access[list]
    const after = [...before.filter(other => other !== name), ...(listRole === role ? [name.trim()] : [])]
    if (after.length !== before.length || after.some((other, index) => other !== before[index])) change[list] = after
  }
  if (Object.keys(change).length > 0) void setAccess(change)
}

// Inviting someone to this space: a link for one person, who takes it with a
// new account or the one they have.
const spaceInvitations = ref<Awaited<ReturnType<typeof trpc.spaces.invitations.query>>>([])
const inviteRight = ref<Role>('write')
const inviteLink = ref('')
const inviteCopied = ref(false)
async function loadSpaceInvitations() {
  if (!accounts || !mayManageAccess.value) return
  spaceInvitations.value = await trpc.spaces.invitations.query({ space: projectStore.projectPath }).catch(() => [])
}
async function inviteSomeone() {
  try {
    const { code } = await trpc.spaces.invite.mutate({ space: projectStore.projectPath, right: inviteRight.value })
    inviteLink.value = `${useViewerStore().publicUrl ?? window.location.origin}/?invitation=${code}`
    inviteCopied.value = await navigator.clipboard.writeText(inviteLink.value).then(() => true, () => false)
    await loadSpaceInvitations()
  } catch (e) {
    useToastStore().error('Could not make an invitation', e)
  }
}
async function removeSpaceInvitation(id: string) {
  try {
    await trpc.spaces.removeInvitation.mutate({ space: projectStore.projectPath, id })
    await loadSpaceInvitations()
  } catch (e) {
    useToastStore().error('Could not take the invitation back', e)
  }
}
const INVITATION_LABELS: Record<Role, string> = { manage: 'to manage it', write: 'to work on it', read: 'to read it' }
const describeSpaceInvitation = (invitation: (typeof spaceInvitations.value)[number]) => [
  INVITATION_LABELS[invitation.right],
  invitation.redeemedBy ? `taken by ${invitation.redeemedBy}`
    : invitation.expiresAt && Date.parse(invitation.expiresAt) < Date.now() ? 'expired'
    : invitation.expiresAt ? `open until ${new Date(invitation.expiresAt).toLocaleDateString()}` : 'open'
].join(' · ')
const READ_SENTENCES = {
  everyone: 'Everyone may read this space, also without logging in.',
  accounts: 'Every logged-in account may read this space.',
  selected: 'Only the people below read this space.'
} as const

// A space from a remote URL is pushed back with one of its owner's SSH keys.
// The server makes the key and shows only its public half, to add on the remote.
const myKeys = ref<Awaited<ReturnType<typeof trpc.keys.list.query>>>([])
const selectedKey = computed(() => myKeys.value.find(key => key.id === spaceAccess.value?.remote?.key))

async function loadKeys() {
  if (spaceAccess.value?.remote && isOwner.value) myKeys.value = await trpc.keys.list.query()
}

async function selectKey(id: string | null) {
  try {
    await trpc.spaces.setRemoteKey.mutate({ space: projectStore.projectPath, key: id })
    await loadSpaceAccess()
    await dataStore.refreshAccess(projectStore.projectPath)
  } catch (e) {
    useToastStore().error('Could not select the key', e)
  }
}

async function createKey() {
  try {
    const key = await trpc.keys.create.mutate({ label: `${name.value} on ${window.location.host}` })
    await loadKeys()
    await selectKey(key.id)
  } catch (e) {
    useToastStore().error('Could not make a key', e)
  }
}

// The space's address on this server (/spaces/<slug>); the old one keeps leading here.
const slug = ref('')
const slugBusy = ref(false)
async function changeSlug() {
  const next = slug.value.trim()
  if (!spaceAccess.value || next === spaceAccess.value.slug) return
  slugBusy.value = true
  try {
    const result = await trpc.spaces.setSlug.mutate({ space: projectStore.projectPath, slug: next })
    modalStore.closeSettingsModal()
    await useProjectLoadStore().open(result.slug)
  } catch (e) {
    useToastStore().error('Could not change the address', e)
  } finally {
    slugBusy.value = false
  }
}

async function removeSpaceEntry() {
  // What goes for good depends on where the space came from (backend spaces/registry.ts removeFiles).
  const access = spaceAccess.value
  const afterwards = access?.kind === 'checkout' ? 'then it leaves this server\'s list; its repository stays where it is.'
    : access?.kind === 'remote' ? `then this server's copy is deleted; the repository${access.remote ? ` at ${access.remote.url}` : ''} stays.`
    : access?.kind === 'created' ? 'then it is deleted with its history.'
    : 'then a space created on this server is deleted with its history; a repository added to it stays.'
  if (!window.confirm(`Delete the space "${name.value}"? For 30 days its owner can restore it from the start page; ${afterwards}`)) return
  try {
    await trpc.spaces.remove.mutate({ space: projectStore.projectPath })
    modalStore.closeSettingsModal()
    projectStore.setProjectPath('')
  } catch (e) {
    useToastStore().error('Could not delete the space', e)
  }
}

async function loadDiscoveredProjects() {
  if (accounts) return
  try {
    const result = await trpc.project.discoverLocalProjects.query()
    discoveredProjects.value = result.projects
  } catch (e) {
    console.error('Failed to discover local projects for linking', e)
    discoveredProjects.value = []
  }
}

async function addLinkedRepo() {
  if (!selectedTargetPath.value || repoBusy.value) return
  repoBusy.value = true
  try {
    await trpc.linkedRepo.register.mutate({ space: projectStore.projectPath, targetPath: selectedTargetPath.value })
    selectedTargetPath.value = ''
    await loadLinkedRepos()
    // Refresh the store's meta so the idea-edit 'link a whole repo' picker sees it.
    await dataStore.ensureProjectMeta(projectStore.projectPath, { force: true })
  } catch (e) {
    console.error('Failed to register linked repo', e)
  } finally {
    repoBusy.value = false
  }
}

// Link a space by its address on its server. The browser asks that server
// itself; this space's server never fetches foreign spaces.
const hostAddress = ref('')
const hostLabel = (host: string) => host.replace(/^https?:\/\//, '')
const hostError = ref('')
async function linkByHost() {
  if (!hostAddress.value.trim() || repoBusy.value) return
  repoBusy.value = true
  hostError.value = ''
  try {
    const target = await fetchSpaceAtHost(hostAddress.value)
    await trpc.linkedRepo.linkHost.mutate({ space: projectStore.projectPath, ...target })
    hostAddress.value = ''
    await loadLinkedRepos()
    await dataStore.ensureProjectMeta(projectStore.projectPath, { force: true })
  } catch (e) {
    hostError.value = e instanceof Error ? e.message : String(e)
  } finally {
    repoBusy.value = false
  }
}

async function removeLinkedRepo(repoId: string) {
  if (confirmUnlinkRepoId.value !== repoId) {
    confirmUnlinkRepoId.value = repoId
    return
  }
  confirmUnlinkRepoId.value = null
  repoBusy.value = true
  try {
    await trpc.linkedRepo.unregister.mutate({ space: projectStore.projectPath, repoId })
    await loadLinkedRepos()
    await dataStore.ensureProjectMeta(projectStore.projectPath, { force: true })
  } catch (e) {
    console.error('Failed to unregister linked repo', e)
  } finally {
    repoBusy.value = false
  }
}

type RuntimeAgentState = {
  enabled: boolean
  emergencyStopped: boolean
  stopReason: string | null
  updatedAt: number
}

type WatchdogRuntimeState = {
  updatedAt: number
  preferredAgentType?: AgentType | null
  agents: Partial<Record<AgentType, RuntimeAgentState>>
}

const runtimeState = ref<WatchdogRuntimeState | null>(null)

const autonomyRuntimePath = computed(() => {
  if (!projectStore.projectPath) return ''
  const normalized = projectStore.projectPath.replace(/\/+$/, '')
  if (normalized.endsWith('/.bowman')) return `${normalized}/runtime`
  return `${normalized}/.bowman/runtime`
})

const runtimeAgents = computed(() => ([
  { key: 'claude' as AgentType, label: 'Claude' },
  { key: 'gemini' as AgentType, label: 'Gemini' },
  { key: 'codex' as AgentType, label: 'Codex' },
  { key: 'agy' as AgentType, label: 'Agy' },
  { key: 'grok' as AgentType, label: 'Grok' }
]))

const formatRuntimeTimestamp = (timestamp?: number) => {
  if (!timestamp) return 'never'
  return new Date(timestamp).toLocaleString()
}

const describeAgentRuntimeState = (agentType: AgentType) => {
  const state = runtimeState.value?.agents?.[agentType]
  if (!state) return 'No runtime state'
  if (state.emergencyStopped) return state.stopReason || 'Emergency stopped'
  if (state.enabled) return 'Supervisor enabled'
  if (state.stopReason) return `Stopped: ${state.stopReason}`
  return 'Idle'
}

async function loadAutonomyState() {
  if (!projectStore.projectPath || accounts) return

  const [watchdogRuntime, policy] = await Promise.all([
    trpc.watchdog.getRuntimeState.query({ space: projectStore.projectPath }) as Promise<WatchdogRuntimeState>,
    trpc.watchdog.getAutonomyPolicy.query({ space: projectStore.projectPath }) as Promise<{
      autonomyMode: 'manual' | 'supervised' | 'autonomous'
      preferredAgentType: AgentType | null
      sessionLeaseMinutes: number
      autoConnectToExistingSession: boolean
      restoreSupervisorStateOnSessionRestart: boolean
      requireCommitBeforeCompact: boolean
      askForHumanOn: string[]
    }>
  ])

  runtimeState.value = watchdogRuntime
  autonomyMode.value = policy.autonomyMode
  preferredAgentType.value = policy.preferredAgentType || ''
  sessionLeaseMinutes.value = policy.sessionLeaseMinutes
  autoConnectToExistingSession.value = policy.autoConnectToExistingSession
  restoreSupervisorStateOnSessionRestart.value = policy.restoreSupervisorStateOnSessionRestart
  requireCommitBeforeCompact.value = policy.requireCommitBeforeCompact
  askForHumanOnText.value = policy.askForHumanOn.join(', ')
}

onMounted(async () => {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }

  // Load data
  loading.value = true
  try {
    const meta = dataStore.meta || await trpc.project.getMeta.query({ space: projectStore.projectPath })
    if (meta) {
        name.value = meta.name
        color.value = meta.color
        initialInstructions.value = meta.initialInstructions || ''
        supervisorGuidancePrefix.value = meta.supervisorGuidancePrefix || ''
        costUnit.value = meta.costUnit || ''
        defaultCost.value = defaultIdeaCost(meta)
        statuses.value = JSON.parse(JSON.stringify(meta.statuses || INITIAL_STATES))
    }
    await loadAutonomyState()
    await loadLinkedRepos()
    await loadDiscoveredProjects()
    await loadSpaceAccess()
    await loadKeys()
    await loadSpaceInvitations()
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
})

// The app's shortcuts stand down while a modal is open (isModalOpen).
const { armed: escapeArmed } = useModalEscape(() => modalStore.closeSettingsModal())

const addStatus = () => {
  statuses.value.push({ key: 'new-status', color: '#888888' })
}

const removeStatus = (index: number) => {
  statuses.value.splice(index, 1)
}

const updateInstructions = async () => {
    isUpdatingInstructions.value = true
    updateResults.value = []
    try {
        const res = await trpc.project.injectAgentInstructions.mutate({ space: projectStore.projectPath })
        updateResults.value = res.results
    } catch (e: any) {
        updateResults.value = [`Error: ${e.message}`]
    } finally {
        isUpdatingInstructions.value = false
    }
}

const importIssues = async () => {
    isImportingIssues.value = true
    issueImportResult.value = ''
    try {
        const { imported, alreadyImported } = await trpc.idea.importGithubIssues.mutate({ space: projectStore.projectPath, repository: issueRepository.value })
        issueImportResult.value = `Imported ${imported} issue${imported === 1 ? '' : 's'}${alreadyImported ? `, ${alreadyImported} already there` : ''}.`
    } catch (error) {
        useToastStore().error('Issue import failed', error)
    } finally {
        isImportingIssues.value = false
    }
}

const save = async () => {
    if (!Number.isFinite(defaultCost.value) || defaultCost.value <= 0) {
        costSettingsError.value = 'Default cost must be greater than 0: everything costs something.'
        return
    }
    costSettingsError.value = ''
    try {
        await dataStore.updateProjectMeta(projectStore.projectPath, {
          name: name.value,
          color: color.value,
          initialInstructions: initialInstructions.value,
          supervisorGuidancePrefix: supervisorGuidancePrefix.value,
          costUnit: costUnit.value.trim(),
          defaultCost: defaultCost.value,
          // Explicit booleans: an absent flag would let the v4 migration re-apply its defaults.
          statuses: statuses.value.map((status) => ({ ...status, promptsReflection: !!status.promptsReflection }))
        })
        if (!accounts) await trpc.watchdog.updateAutonomyPolicy.mutate({
          space: projectStore.projectPath,
          policy: {
            autonomyMode: autonomyMode.value,
            preferredAgentType: preferredAgentType.value || null,
            sessionLeaseMinutes: sessionLeaseMinutes.value,
            autoConnectToExistingSession: autoConnectToExistingSession.value,
            restoreSupervisorStateOnSessionRestart: restoreSupervisorStateOnSessionRestart.value,
            requireCommitBeforeCompact: requireCommitBeforeCompact.value,
            askForHumanOn: askForHumanOnText.value
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          }
        })
        await dataStore.resyncProject(projectStore.projectPath)
        modalStore.closeSettingsModal()
    } catch (e) {
        console.error(e)
    }
}
</script>

<template>
  <div v-if="modalStore.showSettingsModal" class="modal-overlay" aria-modal="true">
    <div class="modal">
      <div class="modal-header">
        <h3>Space settings</h3>
        <span v-if="escapeArmed" class="hint-text">Esc again closes</span>
        <button type="button" class="icon-btn" title="Close (Esc)" @click="modalStore.closeSettingsModal()"><X /></button>
      </div>
      
      <div class="modal-body">
        <fieldset class="settings-section">
          <legend>Space</legend>
          <div class="form-group">
            <label>Name</label>
            <input 
              v-model="name" 
              type="text" 
              placeholder="Name of this space"
            />
          </div>
          <div class="form-group">
            <label>Color</label>
            <div class="color-picker-row">
              <input 
                  v-model="color" 
                  type="color" 
                  class="color-input"
              />
              <input 
                  v-model="color" 
                  type="text" 
                  placeholder="#RRGGBB"
                  @keydown.enter="save"
              />
            </div>
          </div>
        </fieldset>

        <fieldset class="settings-section">
          <legend>Ideas</legend>
          <div class="form-group">
            <label>Idea Statuses</label>
            <div class="status-list">
              <div v-for="(status, index) in statuses" :key="index" class="status-row">
                <input 
                  v-model="status.color" 
                  type="color" 
                  class="status-color-input"
                />
                <input 
                  v-model="status.key" 
                  type="text" 
                  placeholder="key"
                  class="status-key-input"
                  @input="status.key = status.key.toLowerCase().replace(/\s+/g, '-')"
                />
                <label class="status-flag" title="Entering this status asks to reflect on the idea's parent connections">
                  <input v-model="status.promptsReflection" type="checkbox" />
                  reflect
                </label>
                <button @click="removeStatus(index)" class="delete-btn" title="Remove Status"><X /></button>
              </div>
            </div>
            <button @click="addStatus" class="add-btn">+ Add Status</button>
          </div>
          <div class="form-group">
            <label>Cost Unit</label>
            <p class="hint-text">What one unit of idea cost means in this space, e.g. "hours" or "€". Shown next to cost fields and told to agents. Leave empty for abstract units.</p>
            <input v-model="costUnit" type="text" placeholder="abstract units" />
          </div>
          <div class="form-group">
            <label>Default Cost</label>
            <p class="hint-text">Cost of new ideas until someone estimates them.</p>
            <input v-model.number="defaultCost" type="number" min="0" step="any" />
            <p v-if="costSettingsError" class="validation-error" role="alert">{{ costSettingsError }}</p>
          </div>
        </fieldset>

        <template v-if="spaceAccess">
          <fieldset class="settings-section">
            <legend>Access</legend>
            <div v-if="isOwner" class="field-row">
              <span class="row-label">Address</span>
              <span class="address-prefix">/spaces/</span>
              <input v-model="slug" type="text" spellcheck="false" placeholder="address" @keydown.enter="changeSlug" />
              <button class="action-btn add-repo-btn" :disabled="slugBusy || !slug.trim() || slug.trim() === spaceAccess.slug" @click="changeSlug">Change</button>
            </div>
            <p v-if="isOwner" class="hint-text">Lower-case letters, digits and hyphens. Links to the old address keep working.</p>
            <div v-if="isOwner" class="field-row">
              <span class="row-label">Who reads it</span>
              <select :value="spaceAccess.read" @change="setAccess({ read: ($event.target as HTMLSelectElement).value as typeof spaceAccess.read })">
                <option value="everyone">everyone, without logging in</option>
                <option value="accounts">every logged-in account</option>
                <option value="selected">only the people of this space</option>
              </select>
            </div>
            <p class="hint-text">{{ READ_SENTENCES[spaceAccess.read] }}</p>

            <fieldset class="settings-subsection">
              <legend>People</legend>
              <div class="status-list">
                <div class="linked-repo-row">
                  <span class="linked-repo-name">{{ spaceAccess.owner ?? 'The server admins' }}</span>
                  <span class="role-text">owns it</span>
                </div>
                <div v-for="person in people" :key="person.name" class="linked-repo-row">
                  <span class="linked-repo-name">{{ person.name }}</span>
                  <select
                    v-if="mayChangeRole(person.role)"
                    class="role-select"
                    :value="person.role"
                    @change="setRole(person.name, ($event.target as HTMLSelectElement).value as Role)"
                  >
                    <option v-if="isOwner" value="manage">manages</option>
                    <option value="write">writes</option>
                    <option value="read">reads</option>
                  </select>
                  <span v-else class="role-text">{{ ROLE_LABELS[person.role] }}</span>
                  <button
                    v-if="mayChangeRole(person.role)"
                    class="delete-btn"
                    :title="`Take ${person.name} out of this space`"
                    @click="removePerson(person.name)"
                  ><X /></button>
                </div>
              </div>
              <p v-if="people.length === 0" class="hint-text">Nobody else is in this space yet.</p>
              <p v-if="people.some(person => person.role === 'read') && spaceAccess.read !== 'selected'" class="hint-text">Who reads only matters while only the people of this space read it.</p>
              <div v-if="mayManageAccess" class="field-row">
                <input v-model="newPerson" type="text" placeholder="Account name" @keydown.enter="setRole(newPerson, newPersonRole)" />
                <select v-model="newPersonRole" class="role-select">
                  <option v-if="isOwner" value="manage">manages</option>
                  <option value="write">writes</option>
                  <option value="read">reads</option>
                </select>
                <button class="action-btn add-repo-btn" :disabled="!newPerson.trim()" @click="setRole(newPerson, newPersonRole)">Add</button>
              </div>
              <p class="hint-text">Managers write and choose who else writes and reads. The owner alone chooses the managers, who reads it at all, its address and its key.</p>
            </fieldset>

            <fieldset v-if="mayManageAccess" class="settings-subsection">
              <legend>Invitations</legend>
              <div class="field-row">
                <select v-model="inviteRight">
                  <option v-if="isOwner" value="manage">to manage it</option>
                  <option value="write">to work on it</option>
                  <option value="read">to read it</option>
                </select>
                <button class="action-btn add-repo-btn" @click="inviteSomeone">Make invitation link</button>
              </div>
              <div v-if="inviteLink" class="field-row">
                <input :value="inviteLink" type="text" readonly @focus="($event.target as HTMLInputElement).select()" />
              </div>
              <p v-if="inviteLink" class="hint-text">{{ inviteCopied ? 'Copied. ' : '' }}For one person, valid 14 days: they open it, create an account (or log in with theirs) and land in this space.</p>
              <div v-if="spaceInvitations.length > 0" class="status-list">
                <div v-for="invitation in spaceInvitations" :key="invitation.id" class="linked-repo-row">
                  <span class="linked-repo-name">{{ describeSpaceInvitation(invitation) }}</span>
                  <button
                    v-if="!invitation.redeemedBy"
                    class="delete-btn"
                    title="Take the invitation back"
                    @click="removeSpaceInvitation(invitation.id)"
                  ><X /></button>
                  <button
                    v-else-if="people.some(person => person.name === invitation.redeemedBy && mayChangeRole(person.role))"
                    class="delete-btn"
                    :title="`Take ${invitation.redeemedBy} out of this space`"
                    @click="removePerson(invitation.redeemedBy, invitation.id)"
                  ><X /></button>
                </div>
              </div>
            </fieldset>

            <fieldset v-if="isOwner" class="settings-subsection">
              <legend>Notes from visitors</legend>
              <div class="field-row">
                <select :value="spaceAccess.notes" @change="setAccess({ notes: ($event.target as HTMLSelectElement).value as typeof spaceAccess.notes })">
                  <option value="everyone">every account may leave notes</option>
                  <option value="selected">only the accounts named here</option>
                  <option value="nobody">nobody</option>
                </select>
              </div>
              <div v-if="spaceAccess.notes === 'selected'" class="field-row">
                <span class="linked-repo-name">{{ spaceAccess.noteWriters.join(', ') || 'Nobody named yet' }}</span>
                <input v-model="newNoteWriter" type="text" placeholder="Account name" @keydown.enter="setAccess({ noteWriters: [...spaceAccess.noteWriters, newNoteWriter.trim()] })" />
                <button class="action-btn add-repo-btn" :disabled="!newNoteWriter.trim()" @click="setAccess({ noteWriters: [...spaceAccess.noteWriters, newNoteWriter.trim()] })">Add</button>
                <button class="action-btn add-repo-btn" :disabled="spaceAccess.noteWriters.length === 0" @click="setAccess({ noteWriters: [] })">Clear</button>
              </div>
            </fieldset>
          </fieldset>

          <fieldset v-if="spaceAccess.remote" class="settings-section">
            <legend>Repository</legend>
              <p class="hint-text">
                Follows <code>{{ spaceAccess.remote!.url }}</code>.
                {{ spaceAccess.remote!.key ? `Edited here and pushed back with a key of ${spaceAccess.remote!.keyOwner ?? 'a removed account'}.` : 'Read-only here until its owner selects a key to push with.' }}
              </p>
              <div v-if="isOwner" class="add-repo-row">
                <select :value="selectedKey?.id ?? ''" @change="selectKey(($event.target as HTMLSelectElement).value || null)">
                  <option value="">No key: read-only here</option>
                  <option v-for="key in myKeys" :key="key.id" :value="key.id">{{ key.label }}</option>
                </select>
                <button class="action-btn add-repo-btn" @click="createKey">New key</button>
              </div>
              <p v-if="selectedKey" class="hint-text">
                Add this public key on the remote with write access (on GitHub: the repository's Settings, Deploy keys):
                <code class="public-key">{{ selectedKey.publicKey }}</code>
              </p>
          </fieldset>
        </template>

        <fieldset class="settings-section">
          <legend>Linked spaces</legend>
          <div class="form-group">
            <p class="hint-text">Whole other spaces this one can link to as supporters: by their address on the server hosting them, or as a folder checked out here. A space linked here is pickable from an idea's "link a whole repo".</p>

            <div v-if="linkedRepos.length > 0" class="status-list">
              <div v-for="repo in linkedRepos" :key="repo.repoId" class="linked-repo-row">
                <span class="linked-repo-name">{{ repo.name }}</span>
                <a v-if="repo.host" class="linked-repo-chip" :href="repo.host" target="_blank" rel="noopener">{{ hostLabel(repo.host) }}</a>
                <span v-else class="linked-repo-chip" :class="{ unresolved: !repo.resolved }">
                  {{ repo.resolved ? 'checked out' : 'not here' }}
                </span>
                <button
                  @click="removeLinkedRepo(repo.repoId)"
                  class="delete-btn"
                  :class="{ confirm: confirmUnlinkRepoId === repo.repoId }"
                  :title="confirmUnlinkRepoId === repo.repoId ? 'Confirm unlink' : 'Unlink repo'"
                ><Check v-if="confirmUnlinkRepoId === repo.repoId" /><X v-else /></button>
              </div>
            </div>
            <p v-else class="hint-text">No linked repos yet.</p>

            <div class="add-repo-row">
              <input v-model="hostAddress" placeholder="https://server/spaces/space" :disabled="repoBusy" @keydown.enter="linkByHost" />
              <button @click="linkByHost" class="action-btn add-repo-btn" :disabled="!hostAddress.trim() || repoBusy">Link</button>
            </div>
            <p v-if="hostError" class="hint-text">{{ hostError }}</p>
            <div v-if="!accounts" class="add-repo-row">
              <select v-model="selectedTargetPath" :disabled="availableRepoTargets.length === 0 || repoBusy">
                <option value="">
                  {{ availableRepoTargets.length === 0 ? 'No other local spaces found' : 'Select a space to link…' }}
                </option>
                <option v-for="p in availableRepoTargets" :key="p.bowmanPath" :value="p.path">{{ projectLabel(p) }}</option>
              </select>
              <button @click="addLinkedRepo" class="action-btn add-repo-btn" :disabled="!selectedTargetPath || repoBusy">Link</button>
            </div>
          </div>
        </fieldset>

        <fieldset class="settings-section">
          <legend>Import</legend>
          <div class="form-group">
            <label>GitHub Issues</label>
            <p class="hint-text">Imports the open issues of a repository as ideas under one parent idea; importing again only adds new ones.</p>
            <div class="add-repo-row">
              <input v-model="issueRepository" type="text" placeholder="owner/repo or github.com URL" @keydown.enter="importIssues" />
              <button @click="importIssues" class="action-btn add-repo-btn" :disabled="!issueRepository.trim() || isImportingIssues">
                {{ isImportingIssues ? 'Importing…' : 'Import' }}
              </button>
            </div>
            <p v-if="issueImportResult" class="hint-text">{{ issueImportResult }}</p>
          </div>
        </fieldset>

        <fieldset class="settings-section">
          <legend>Agents</legend>
          <div class="form-group">
            <label>Initial Instructions</label>
            <p class="hint-text">Posted to the agent at the start of each conversation (e.g. "work directly on main, no PRs"). Stored in meta.json.</p>
            <textarea
              v-model="initialInstructions"
              class="instructions-input"
              rows="4"
              placeholder="Instructions for the coding agent, for this whole space…"
            ></textarea>
          </div>
          <div class="form-group">
            <label>Supervisor Guidance Prefix</label>
            <p class="hint-text">Optional reminder prefixed to each natural-language supervisor message. Leave empty for ordinary spaces.</p>
            <textarea
              v-model="supervisorGuidancePrefix"
              class="supervisor-guidance-input"
              rows="2"
              placeholder="Reminder for the coding agent, for this space…"
            ></textarea>
          </div>
          <div v-if="!accounts" class="form-group">
            <label>Agent Integration</label>
            <p class="hint-text">Injects Aimparency MCP instructions into .gemini/GEMINI.md, CLAUDE.md, etc.</p>
            <button @click="updateInstructions" class="action-btn" :disabled="isUpdatingInstructions">
              {{ isUpdatingInstructions ? 'Updating...' : 'Update Agent Instructions' }}
            </button>
            <div v-if="updateResults.length > 0" class="update-results">
              <div v-for="(res, i) in updateResults" :key="i" class="result-line">{{ res }}</div>
            </div>
          </div>
          <div v-if="!accounts" class="form-group">
            <label>Autonomy Policy</label>
            <p class="hint-text">Stored in <code>{{ autonomyRuntimePath }}/autonomy-policy.json</code>.</p>

            <div class="stacked-fields">
              <div>
                <label class="sub-label">Autonomy Mode</label>
                <select v-model="autonomyMode">
                  <option value="manual">Manual</option>
                  <option value="supervised">Supervised</option>
                  <option value="autonomous">Autonomous</option>
                </select>
              </div>

              <div>
                <label class="sub-label">Preferred Agent</label>
                <select v-model="preferredAgentType">
                  <option value="">Follow UI selection</option>
                  <option value="claude">Claude</option>
                  <option value="gemini">Gemini</option>
                  <option value="codex">Codex</option>
                  <option value="agy">Agy</option>
                  <option value="grok">Grok</option>
                </select>
              </div>

              <div>
                <label class="sub-label">Session Lease Minutes</label>
                <input v-model.number="sessionLeaseMinutes" type="number" min="1" step="1" />
              </div>

              <label class="checkbox-row">
                <input v-model="autoConnectToExistingSession" type="checkbox" />
                <span>Auto-connect to an existing session on reload</span>
              </label>

              <label class="checkbox-row">
                <input v-model="restoreSupervisorStateOnSessionRestart" type="checkbox" />
                <span>Restore supervisor state when a session restarts</span>
              </label>

              <label class="checkbox-row">
                <input v-model="requireCommitBeforeCompact" type="checkbox" />
                <span>Require commit before compact / wrap-up</span>
              </label>

              <div>
                <label class="sub-label">Ask For Human On</label>
                <input
                  v-model="askForHumanOnText"
                  type="text"
                  placeholder="destructive-git, network, api-keys"
                />
              </div>
            </div>
          </div>
          <div v-if="!accounts" class="form-group">
            <label>Runtime Ownership</label>
            <p class="hint-text">Current runtime state observed from <code>{{ autonomyRuntimePath }}</code>.</p>

            <div class="runtime-box">
              <div class="runtime-line">
                <span class="runtime-key">Folder</span>
                <code>{{ projectStore.projectPath.replace(/\/\.bowman$/, '') }}</code>
              </div>
              <div class="runtime-line">
                <span class="runtime-key">.bowman Runtime</span>
                <code>{{ autonomyRuntimePath }}</code>
              </div>
              <div class="runtime-line">
                <span class="runtime-key">Runtime Updated</span>
                <span>{{ formatRuntimeTimestamp(runtimeState?.updatedAt) }}</span>
              </div>
            </div>

            <div class="runtime-agent-list">
              <div v-for="agent in runtimeAgents" :key="agent.key" class="runtime-agent-card">
                <div class="runtime-agent-header">
                  <strong>{{ agent.label }}</strong>
                  <span class="runtime-status-chip">{{ describeAgentRuntimeState(agent.key) }}</span>
                </div>
                <div class="runtime-agent-meta">
                  <span>Updated: {{ formatRuntimeTimestamp(runtimeState?.agents?.[agent.key]?.updatedAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </fieldset>


        <fieldset v-if="spaceAccess && isOwner" class="settings-section danger">
          <legend>Danger zone</legend>
          <div v-if="people.length > 0" class="field-row">
            <span class="row-label">Hand over ownership to</span>
            <select v-model="newOwner">
              <option value="" disabled>someone of this space…</option>
              <option v-for="person in people" :key="person.name" :value="person.name">{{ person.name }}</option>
            </select>
            <button class="action-btn add-repo-btn" :disabled="!newOwner" @click="handOver">Hand over</button>
          </div>
          <p v-if="people.length > 0" class="hint-text">You stay in the space as a manager.</p>
          <div class="field-row">
            <button class="action-btn danger-btn" @click="removeSpaceEntry">Delete this space</button>
          </div>
        </fieldset>
      </div>
      
      <div class="modal-footer">
        <button @click="modalStore.closeSettingsModal" class="btn-secondary">
          Cancel
        </button>
        <button @click="save" class="btn-primary">
          Save
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 5px;
  width: 40rem;
  max-width: 92vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;

  .modal-header {
    padding: 1rem;
    border-bottom: 1px solid #555;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    h3 { margin: 0; flex: 1; }
  }

  .modal-body {
    padding: 1rem;
    flex: 1;
    overflow-y: auto;

    /* Framed groups of settings; Access holds framed subgroups. */
    .settings-section {
      min-width: 0;
      margin: 0 0 1rem;
      padding: 0.5rem 1rem 0.75rem;
      border: 1px solid #484848;
      border-radius: 6px;

      > legend {
        padding: 0 0.4rem;
        font-weight: 600;
        color: #e8e8e8;
      }
      .form-group:last-child { margin-bottom: 0.25rem; }

      input[type="text"], input[type="number"], select {
        padding: 0.5rem;
        background: #1a1a1a;
        border: 1px solid #555;
        border-radius: 3px;
        color: #e0e0e0;
        &:focus { outline: none; border-color: #007acc; }
      }

      &.danger {
        border-color: rgba(255, 85, 85, 0.55);
        > legend { color: #ff5555; }
      }
    }
    .settings-subsection {
      min-width: 0;
      margin: 0.75rem 0 0;
      padding: 0.4rem 0.75rem 0.6rem;
      border: 1px solid #3a3a3a;
      border-radius: 5px;

      > legend {
        padding: 0 0.3rem;
        font-size: 0.85rem;
        color: #bbb;
      }
    }
    .action-btn.danger-btn {
      color: #ff5555;
      border-color: rgba(255, 85, 85, 0.55);
    }
    /* A hint under a row of fields: below it, not pulled up into it. */
    .field-row + .hint-text { margin-top: 0.3rem; }
    .settings-section .linked-repo-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 2.2rem;

      .linked-repo-name { flex: 1; min-width: 0; }
      .role-select { flex: 0 0 8rem; width: 8rem; min-width: 0; padding: 0.3rem 0.4rem; }
      .delete-btn {
        background: transparent;
        border: none;
        color: #ff6666;
        cursor: pointer;
        padding: 0 0.25rem;
        line-height: 1;
        &:hover { color: #ff4444; }
      }
    }
    
    .form-group {
      margin-bottom: 1rem;
      
      label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: bold;
        color: #ccc;
      }
      
      input[type="text"] {
        width: 100%;
        padding: 0.5rem;
        background: #1a1a1a;
        border: 1px solid #555;
        border-radius: 3px;
        color: #e0e0e0;
        
        &:focus {
          outline: none;
          border-color: #007acc;
        }
      }

      input[type="number"],
      select {
        width: 100%;
        padding: 0.5rem;
        background: #1a1a1a;
        border: 1px solid #555;
        border-radius: 3px;
        color: #e0e0e0;

        &:focus {
          outline: none;
          border-color: #007acc;
        }
      }
      
      .color-picker-row {
        display: flex;
        gap: 0.5rem;
        
        .color-input {
            width: 3rem;
            height: 2.5rem;
            padding: 0;
            border: none;
            cursor: pointer;
            background: none;
        }
      }
    }

    .status-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      max-height: 12rem;
      overflow-y: auto;
      padding-right: 0.25rem;
    }

    .status-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;

      .status-color-input {
        width: 2.5rem;
        height: 2rem;
        padding: 0;
        border: none;
        cursor: pointer;
        background: none;
        flex-shrink: 0;
      }

      .status-key-input {
        flex: 1;
      }

      .status-flag {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        color: #bbb;
        white-space: nowrap;
      }

      .delete-btn {
        background: transparent;
        border: none;
        color: #ff6666;
        font-size: 1.5rem;
        cursor: pointer;
        line-height: 1;
        padding: 0 0.25rem;
        
        &:hover {
          color: #ff4444;
        }
      }
    }

    .add-btn {
      width: 100%;
      padding: 0.4rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px dashed #555;
      color: #888;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.85rem;

      &:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ccc;
        border-color: #777;
      }
    }

    .hint-text {
      font-size: 0.8rem;
      color: #888;
      margin-bottom: 0.5rem;
      margin-top: -0.25rem;

      .public-key {
        display: block;
        user-select: all;
        word-break: break-all;
      }
    }

    .instructions-input {
      width: 100%;
      padding: 0.5rem;
      background: #1a1a1a;
      border: 1px solid #555;
      border-radius: 3px;
      color: #e0e0e0;
      font-family: inherit;
      resize: vertical;

      &:focus {
        outline: none;
        border-color: #007acc;
      }
    }

    .linked-repo-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;

      .linked-repo-name {
        flex: 1;
        color: #e0e0e0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .linked-repo-chip {
        font-size: 0.72rem;
        padding: 0.15rem 0.45rem;
        border-radius: 999px;
        background: rgba(63, 185, 80, 0.18);
        color: #7ee787;
        border: 1px solid rgba(63, 185, 80, 0.35);
        white-space: nowrap;

        &.unresolved {
          background: rgba(158, 158, 158, 0.18);
          color: #bbb;
          border-color: rgba(158, 158, 158, 0.35);
        }
      }

      .delete-btn.confirm {
        color: #7ee787;
      }
    }

    .add-repo-row, .field-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: stretch;
      margin-top: 0.5rem;

      select, input { flex: 1; min-width: 10rem; }
      .row-label { align-self: center; color: #e0e0e0; white-space: nowrap; }
      .address-prefix { align-self: center; color: var(--text-muted); }

      .add-repo-btn {
        width: auto;
        flex-shrink: 0;
        padding: 0.5rem 1rem;
      }
    }

    .linked-repo-row {
      .role-text { color: var(--text-muted); white-space: nowrap; }
      .role-select { flex: 0 0 auto; min-width: 7rem; }
    }

    .sub-label {
      font-size: 0.8rem;
      color: #aaa;
      margin-bottom: 0.35rem;
    }

    .stacked-fields {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #ddd;
      font-size: 0.9rem;

      input[type="checkbox"] {
        width: auto;
      }
    }

    .action-btn {
      width: 100%;
      padding: 0.5rem;
      background: #333;
      border: 1px solid #555;
      color: #e0e0e0;
      border-radius: 3px;
      cursor: pointer;
      &:hover { background: #444; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    .update-results {
      margin-top: 0.5rem;
      font-size: 0.8rem;
      color: #88ff88;
      background: rgba(0,0,0,0.2);
      padding: 0.5rem;
      border-radius: 3px;
    }
    
    .result-line { margin-bottom: 0.2rem; }

    .runtime-box,
    .runtime-agent-card {
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid #444;
      border-radius: 4px;
      padding: 0.75rem;
    }

    .runtime-box {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }

    .runtime-line {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      font-size: 0.85rem;
    }

    .runtime-key {
      color: #8f8f8f;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 0.72rem;
    }

    .runtime-agent-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .runtime-agent-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.35rem;
    }

    .runtime-status-chip {
      background: rgba(0, 122, 204, 0.18);
      color: #9dd7ff;
      border: 1px solid rgba(0, 122, 204, 0.35);
      border-radius: 999px;
      padding: 0.2rem 0.5rem;
      font-size: 0.72rem;
      white-space: nowrap;
    }

    .runtime-agent-meta {
      color: #9b9b9b;
      font-size: 0.8rem;
    }
  }
  
  .modal-footer {
    padding: 1rem;
    border-top: 1px solid #555;
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    flex-shrink: 0;
    
    button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      
      &.btn-primary {
        background: #007acc;
        color: white;
        &:hover { background: #005a99; }
      }
      
      &.btn-secondary {
        background: #444;
        color: #e0e0e0;
        &:hover { background: #555; }
      }
    }
  }
}
</style>
