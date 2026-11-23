<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useUIStore, type IdeaPath } from './stores/ui'
import { useUIModalStore } from './stores/ui/modal-store'
import { useGraphUIStore } from './stores/ui/graph-store'
import { getRepoUrlParam, useProjectStore } from './stores/project-store'
import { useProjectLoadStore } from './stores/project-load'
import { useWatchdogStore } from './stores/watchdog'
import { useDataStore, type Idea } from './stores/data'
import { useMapStore } from './stores/map'
import { useHistoryStore } from './stores/history'
import { captureSelectionAnchor } from './stores/ui/selection-anchor'
import { trpc } from './trpc'
import LoginControl from './components/LoginControl.vue'
import McpOffer from './components/McpOffer.vue'
import NotesInbox from './components/NotesInbox.vue'
import McpAuthorizeModal from './components/McpAuthorizeModal.vue'
import type { IdeaSearchAdditionalOption, IdeaSearchPickPayload } from './stores/ui/idea-search-types'
import type { PhaseSearchSelection } from './stores/ui/phase-search-types'
import PhaseCreationModal from './components/PhaseCreationModal.vue'
import IdeaCreationModal from './components/IdeaCreationModal.vue'
import ConnectionDetailsModal from './components/ConnectionDetailsModal.vue'
import ProposeSpaceModal from './components/ProposeSpaceModal.vue'
import ConnectServerModal from './components/ConnectServerModal.vue'
import ConnectSiteModal from './components/ConnectSiteModal.vue'
import IdeaRemovalDialog from './components/IdeaRemovalDialog.vue'
import IdeaEditModal from './components/IdeaEditModal.vue'
import IdeaSearchModal from './components/IdeaSearchModal.vue'
import PhaseSearchModal from './components/PhaseSearchModal.vue'
import ColumnsView from './views/ColumnsView.vue'
import GraphViewWrapper from './views/GraphViewWrapper.vue'
import ProjectSelectionView from './views/ProjectSelectionView.vue'
import VoiceView from './views/VoiceView.vue'
import WatchdogPanel from './components/WatchdogPanel.vue'
import LoopPanel from './components/LoopPanel.vue'
import LoopActionsOverlay from './components/LoopActionsOverlay.vue'
import ConsistencyModal from './components/ConsistencyModal.vue'
import ReviewInboxModal from './components/ReviewInboxModal.vue'
import CommitModal from './components/CommitModal.vue'
import { needsCommit, type WorkingTreeChange } from './utils/git-status'
import { formatRelativeTime } from './utils/relative-time'
import ToastStack from './components/ToastStack.vue'
import ProjectLoadScreen from './components/ProjectLoadScreen.vue'
import { useToastStore } from './stores/toast'
import { gitRepositoryLocation } from 'shared'
import { rankIdeasAwaitingHuman } from './utils/review-inbox'
import ProjectSettingsModal from './components/ProjectSettingsModal.vue'
import LocalMcpModal from './components/LocalMcpModal.vue'
import HookControl from './components/HookControl.vue'
import { getRuntimeConfig, hasAccounts } from './utils/runtime-config'
import { useViewerStore } from './stores/viewer'
import { isModalOpen } from './stores/ui/modal-helpers'
import { hasQueryFlag, installPerfLoggingControls, perfLog } from './utils/perf-log'
import { Check, ChevronUp, EllipsisVertical, GitCommitHorizontal, Hourglass, Maximize2, Menu, Minimize2, Minus, Plug, Plus, RefreshCw, Search, Settings, X } from 'lucide-vue-next'

const uiStore = useUIStore()
const modalStore = useUIModalStore()
const graphUIStore = useGraphUIStore()
const projectStore = useProjectStore()
const projectLoad = useProjectLoadStore()
const watchdogStore = useWatchdogStore()
const dataStore = useDataStore()
const mapStore = useMapStore()
const historyStore = useHistoryStore()
historyStore.install()
const voiceEnabled = getRuntimeConfig().voiceEnabled

const normalizedProjectRoot = computed(() => projectStore.projectPath.replace(/\/+$/, ''))
const activeBowmanRoot = computed(() => normalizedProjectRoot.value ? `${normalizedProjectRoot.value}/.bowman` : '')
const activeProjectName = computed(() => {
  const projectRoot = normalizedProjectRoot.value
  if (!projectRoot) return ''
  // On a server with accounts the address is the graph's slug: show its name.
  if (accounts) return dataStore.meta?.name || projectRoot

  const segments = projectRoot.split('/').filter(Boolean)
  return segments[segments.length - 1] || projectRoot
})

const handleIdeaSearchSelect = (payload: { type: 'idea' | 'path', data: Idea | IdeaPath, keepOpen?: boolean } | { type: 'option', data: IdeaSearchAdditionalOption, keepOpen?: boolean }) => {
  if (modalStore.ideaSearchMode === 'pick') {
    if (modalStore.ideaSearchCallback && payload.type !== 'path') {
      modalStore.ideaSearchCallback(payload as IdeaSearchPickPayload)
    }
  } else {
    if (projectStore.currentView === 'graph' && payload.type === 'idea') {
      const idea = payload.data as Idea
      const node = mapStore.getNode(idea.id)
      graphUIStore.setGraphSelection(idea.id)
      graphUIStore.deselectLink()
      if (node) {
        mapStore.centerOnNode(node)
      }
    } else if (payload.type === 'path') {
      uiStore.executeNavigation(payload.data as IdeaPath)
    }
  }
  if (!payload.keepOpen) {
    modalStore.closeIdeaSearch()
  }
}

const handlePhaseSearchSelect = (payload: PhaseSearchSelection) => {
  if (modalStore.phaseSearchPromptCallback) {
    modalStore.phaseSearchPromptCallback(payload)
  }
  if (!payload.keepOpen) {
    modalStore.closePhaseSearchPrompt()
  }
}

// Local UI state
const watchdogHeight = ref(parseInt(localStorage.getItem('aimparency-watchdog-height') || '300'))
const loopHeight = ref(parseInt(localStorage.getItem('aimparency-loop-height') || '300'))
const watchdogRef = ref<InstanceType<typeof WatchdogPanel>>()
const loopRef = ref<InstanceType<typeof LoopPanel>>()
const showConsistencyModal = ref(false)
const showLocalMcp = ref(false)
const showReviewInbox = ref(false)
const handleProposalPersisted = async (result: { rootIdeaId: string }) => {
  await dataStore.loadAllIdeas(projectStore.projectPath)
  uiStore.setView('graph')
  graphUIStore.setGraphSelection(result.rootIdeaId)
}
const awaitingHumanCount = computed(() => rankIdeasAwaitingHuman(dataStore.ideas, dataStore.calculatedPriorities).length)
// With accounts other people use this server: no loops, and wrapped agents (a
// shell on the server) only for server admins, when the operator turned them on.
const accounts = hasAccounts()
// The viewer's role in the open space, shown next to its name.
const ROLE_LABELS = { owner: 'own', manage: 'manage', write: 'write', read: 'read' } as const
const ROLE_TITLES = {
  owner: 'You own this space: everything is yours to decide.',
  manage: 'You manage this space: you write it and choose who else writes and reads it.',
  write: 'You may change this space.',
  read: 'You may read this space.'
} as const
const viewerStore = useViewerStore()
const agentsAllowed = computed(() => !accounts || (getRuntimeConfig().agents && viewerStore.name !== null && viewerStore.serverAdmin))
// Narrow screens: the bar's further controls fold out below it.
const headerOpen = ref(false)
// Uncommitted work of the project's repository; the header prompts a commit when it piles up.
const workingTree = ref<{ changes: WorkingTreeChange[]; lastCommitAt: number | null; ahead: number | null } | null>(null)
const showCommitDialog = ref(false)
const refreshWorkingTree = async () => {
  const projectPath = projectStore.projectPath
  let status = null
  try {
    if (projectPath) status = await trpc.git.status.query({ graph: projectPath })
  } catch {
    // treated as no repository
  }
  if (projectPath === projectStore.projectPath) workingTree.value = status?.isRepository ? status : null
}
const commitPrompt = computed(() => workingTree.value !== null && needsCommit(workingTree.value.changes, workingTree.value.lastCommitAt))
const workingTreeTitle = computed(() => {
  if (!workingTree.value) return ''
  const { changes, lastCommitAt, ahead } = workingTree.value
  const unpushed = ahead ? `, ${ahead} unpushed ${ahead === 1 ? 'commit' : 'commits'}` : ''
  return `${changes.length} uncommitted ${changes.length === 1 ? 'change' : 'changes'}${unpushed}, last commit ${lastCommitAt ? formatRelativeTime(lastCommitAt) : 'never'}. Click to commit or push.`
})
watch(() => projectStore.projectPath, refreshWorkingTree, { immediate: true })
const workingTreeTimer = setInterval(refreshWorkingTree, 30_000)
onUnmounted(() => clearInterval(workingTreeTimer))
const isResizingWatchdog = ref(false)
const discoveredProjects = ref<Array<{ path: string, bowmanPath: string, sourceRoot: string }>>([])
const discoveredProjectRoots = ref<string[]>([])
const isRefreshingDiscoveredProjects = ref(false)
const projectSelectionReturnPath = ref('')

// Persist watchdog visibility and handle focus
// Watchdog and loop share the bottom area: opening one closes the other.
watch(() => projectStore.showWatchdog, (val) => {
  localStorage.setItem('aimparency-show-watchdog', String(val))
  if (val) {
    projectStore.showLoop = false
    nextTick(() => {
      watchdogRef.value?.focusWorker()
    })
  }
})

watch(() => projectStore.showLoop, (val) => {
  localStorage.setItem('aimparency-show-loop', String(val))
  if (val) projectStore.showWatchdog = false
})

// Always disconnect/reconnect on project switch — even when the watchdog panel is hidden.
watch(
  () => projectStore.projectPath,
  (newPath, oldPath) => {
    void watchdogStore.handleProjectSwitch(newPath, oldPath)
  }
)

// Persist terminal fullscreen so a reload restores it.
watch(() => projectStore.terminalFullscreen, (val) => {
  localStorage.setItem('aimparency-terminal-fullscreen', String(val))
})

watch(() => projectStore.isInProjectSelection && !projectLoad.isActive, (selecting) => {
  if (selecting) {
    void refreshDiscoveredProjects()
  }
})

const startResizeWatchdog = (e: MouseEvent) => {
  e.preventDefault()
  isResizingWatchdog.value = true
  window.addEventListener('mousemove', resizeWatchdog)
  window.addEventListener('mouseup', stopResizeWatchdog)
}

const resizeWatchdog = (e: MouseEvent) => {
  if (!isResizingWatchdog.value) return
  const newHeight = window.innerHeight - e.clientY
  const nextHeight = Math.max(100, Math.min(newHeight, window.innerHeight - 100))
  if (projectStore.showLoop) {
    loopHeight.value = nextHeight
  } else {
    watchdogHeight.value = nextHeight
  }
}

const stopResizeWatchdog = () => {
  isResizingWatchdog.value = false
  localStorage.setItem('aimparency-watchdog-height', String(watchdogHeight.value))
  localStorage.setItem('aimparency-loop-height', String(loopHeight.value))
  window.removeEventListener('mousemove', resizeWatchdog)
  window.removeEventListener('mouseup', stopResizeWatchdog)
}

// Template refs
const projectPathInput = ref('')

const handleSelectProject = () => {
  const target = projectPathInput.value.trim()
  // A bare name would resolve against the backend's working directory.
  if (!gitRepositoryLocation(target) && !/^(\/|[A-Za-z]:[\\/])/.test(target)) {
    useToastStore().error('Type a full path, starting with /, or pick a space from the list')
    return
  }
  projectSelectionReturnPath.value = ''
  void projectLoad.open(target)
}

// Directories of this machine: only where the person at the machine is the user.
const refreshDiscoveredProjects = async () => {
  if (!projectStore.isInProjectSelection || accounts) return

  isRefreshingDiscoveredProjects.value = true
  try {
    const result = await trpc.project.discoverLocalProjects.query()
    discoveredProjects.value = result.projects
    discoveredProjectRoots.value = result.rootsScanned
  } catch (error) {
    console.error('Failed to discover local projects', error)
    discoveredProjects.value = []
    discoveredProjectRoots.value = []
  } finally {
    isRefreshingDiscoveredProjects.value = false
  }
}

const openProjectFromHistory = (path: string) => {
  projectSelectionReturnPath.value = ''
  projectPathInput.value = path
  void projectLoad.open(path)
}

const openGraph = (slug: string) => {
  projectSelectionReturnPath.value = ''
  void projectLoad.open(slug)
}

// ?mcp-authorize=<request>: an MCP client sent the person here to approve its login.
const mcpRequest = ref(new URLSearchParams(window.location.search).get('mcp-authorize') ?? '')
const closeMcpRequest = () => {
  mcpRequest.value = ''
  const url = new URL(window.location.href)
  url.searchParams.delete('mcp-authorize')
  window.history.replaceState({}, '', url)
}

// ?connect-site=<origin>&connect-state=<nonce>: a page of another Aimparency
// website asks to act as the person here, for a space of this server open there.
const connectRequest = ref((() => {
  const params = new URLSearchParams(window.location.search)
  const site = params.get('connect-site')
  const state = params.get('connect-state')
  return site && state ? { site, state } : null
})())
const closeConnectRequest = () => {
  connectRequest.value = null
  const url = new URL(window.location.href)
  url.searchParams.delete('connect-site')
  url.searchParams.delete('connect-state')
  window.history.replaceState({}, '', url)
}

// A note from the header's list: its graph, then its idea.
const openNote = async (slug: string, ideaId: string) => {
  if (projectStore.projectPath !== slug) await projectLoad.open(slug)
  await uiStore.navigateToIdea(ideaId)
}

const openDiscoveredProject = (path: string) => {
  projectPathInput.value = path
  handleSelectProject()
}

const removeFromHistory = (path: string) => {
  projectStore.removeProjectFromHistory(path)
}

const closeProject = () => {
  openProjectSelection()
}

const openProjectSelection = () => {
  flushPersistedUIState()
  projectSelectionReturnPath.value = projectStore.projectPath
  projectStore.setProjectPath('')
  projectPathInput.value = '' // the input filters the lists, so start with all of them
}

const cancelProjectSelection = () => {
  if (!projectSelectionReturnPath.value) return

  projectStore.setProjectPath(projectSelectionReturnPath.value)
  projectSelectionReturnPath.value = ''
}

const flushPersistedUIState = () => {
  if (projectStore.projectPath) {
    void uiStore.flushProjectUIStatePersist()
  }
}

type LoopPanelAction = 'create-loop' | 'create-instance' | 'duplicate-loop' | 'start-instance' | 'stop-instance' | 'restart-instance'

const handleLoopAction = (action: LoopPanelAction) => {
  const panel = loopRef.value
  if (!panel) return

  const handlers: Record<LoopPanelAction, () => void | Promise<void>> = {
    'create-loop': panel.createLoop,
    'create-instance': panel.createInstance,
    'duplicate-loop': panel.duplicateLoop,
    'start-instance': panel.startInstance,
    'stop-instance': panel.stopInstance,
    'restart-instance': panel.restartInstance
  }
  void handlers[action]()
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    flushPersistedUIState()
  }
}


// Opened here, not on mount: the first render already has the loading screen,
// and no view mounts before the project is there.
const startupTarget = getRepoUrlParam() || projectStore.projectPath
projectPathInput.value = getRepoUrlParam()
const startupLoad = startupTarget ? projectLoad.open(startupTarget) : null

// Global keydown handler
const handleGlobalKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

  if (projectStore.isInProjectSelection) {
    if (event.key === 'Escape' && projectSelectionReturnPath.value) {
      event.preventDefault()
      cancelProjectSelection()
    }
    return
  }

  // Ignore if user is typing in an input or a modal is open; modals handle their own keys
  if (isInput || isModalOpen()) return

  if (event.key === 'p' && !uiStore.navigatingIdeas && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    openProjectSelection()
    return
  }

  // Watchdog toggle (a is local-only; with accounts w is for server admins with agents on)
  if (agentsAllowed.value && event.key === 'w' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    projectStore.showWatchdog = !projectStore.showWatchdog
    return
  }

  // Loop (agent loop area) toggle
  if (!accounts && event.key === 'a' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    projectStore.showLoop = !projectStore.showLoop
    return
  }

  // Ctrl+Space for context menu (watchdog handled in its panel via capture; loop below)
  if (event.ctrlKey && event.code === 'Space') {
    if (projectStore.showLoop) {
      event.preventDefault()
      event.stopPropagation()
      projectStore.showLoopActionsOverlay = !projectStore.showLoopActionsOverlay
      return
    }
  }

  // Voice view toggle
  if (voiceEnabled && event.key === 'v' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    uiStore.setView(projectStore.currentView === 'voice' ? 'columns' : 'voice')
    return
  }

  void Promise.resolve(uiStore.handleGlobalKeydown(event, dataStore)).catch((error: unknown) => {
    if (hasQueryFlag('phaseNavDebug')) {
      console.error('[PhaseNav] handleGlobalKeydown:error', {
        key: event.key,
        error
      })
    }
  })
}

// The loop is local only; agents are for whoever may run them (see the key handler).
const agentHints = () => [
  ...(accounts ? [] : [{ key: 'a', action: 'toggle loop panel' }]),
  ...(agentsAllowed.value ? [{ key: 'w', action: 'toggle watchdog' }] : [])
]

// Update keyboard hints based on navigation state and selected column
watch(() => [uiStore.navigatingIdeas, uiStore.activeColumn, agentsAllowed.value] as const, ([navigatingIdeas, activeColumn]) => {
  if (!navigatingIdeas) {
    const hints = [
      { key: '/', action: 'search' },
      { key: 'h/l', action: 'switch columns' },
      { key: 'j/k', action: 'navigate phases/ideas' },
      { key: 'i', action: 'enter edit mode' },
      { key: 'o', action: 'create phase/idea' },
      { key: 'u/r', action: 'undo/redo' },
      ...agentHints()
    ]

    if (voiceEnabled) {
      hints.push({ key: 'v', action: 'voice mode' })
    }

    if (activeColumn === 0) {
      // Root ideas column
      hints.push({ key: 'd', action: 'delete idea' })
    } else {
      // Phase columns
      hints.push({ key: 'e', action: 'edit phase' })
    }

    projectStore.setKeyboardHints(hints)
  } else {
    projectStore.setKeyboardHints([
      { key: '/', action: 'search' },
      { key: 'j/k', action: 'navigate ideas' },
      { key: 'h/l', action: 'collapse/expand' },
      { key: 'e', action: 'edit idea' },
      { key: 'd', action: 'delete idea' },
      { key: 'o/O', action: 'create idea below/above' },
      { key: 'u/r', action: 'undo/redo' },
      { key: 'Esc', action: 'exit edit mode' },
      ...agentHints()
    ])
  }
}, { immediate: true })

watch(() => projectStore.currentView, (currentView) => {
  if (!voiceEnabled && currentView === 'voice') {
    uiStore.setView('columns')
  }
}, { immediate: true })

// Watch for modal close
watch(() => [modalStore.showPhaseModal, modalStore.showIdeaModal], async () => {
  // When both modals are closed, we don't need to manually restore focus 
  // because we use window listener now.
})

watch(() => [
  uiStore.activeColumn,
  uiStore.maxColumn,
  uiStore.selectedEntryKeyByColumn,
  uiStore.floatingIdeaId,
  uiStore.selectedIdeaIdByPhaseId,
  uiStore.windowStart,
  uiStore.windowSize,
  uiStore.lastSelectedSubPhaseIndexByPhase,
  uiStore.navigatingIdeas,
  // Idea-level selection and expansion live in phases and the idea UI trees.
  captureSelectionAnchor(uiStore),
  uiStore.phaseIdeaUIStatesByPhaseId,
  uiStore.floatingIdeaUIStates,
  projectStore.currentView,
  graphUIStore.graphSelectedIdeaId,
  graphUIStore.selectedLink,
  graphUIStore.graphColorMode,
  graphUIStore.graphPanelWidth,
  graphUIStore.graphShowLabels
], () => {
  if (projectStore.projectPath) {
    uiStore.scheduleProjectUIStatePersist()
  }
}, { deep: true })

onMounted(async () => {
  installPerfLoggingControls()
  perfLog('app.mounted')
  // Register global keydown listener
  window.addEventListener('keydown', handleGlobalKeydown)
  void viewerStore.load()
  window.addEventListener('pagehide', flushPersistedUIState)
  window.addEventListener('beforeunload', flushPersistedUIState)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  if (startupLoad) {
    await startupLoad
    if (projectStore.showWatchdog) {
      // Reload path: panel may reconnect async — retry focus after restore settles.
      nextTick(() => watchdogRef.value?.focusWorker())
      setTimeout(() => watchdogRef.value?.focusWorker(), 600)
      setTimeout(() => watchdogRef.value?.focusWorker(), 1400)
    }
  } else {
    // Set initial focus to the first phase column
    uiStore.setActiveColumn(0);
    await refreshDiscoveredProjects()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('pagehide', flushPersistedUIState)
  window.removeEventListener('beforeunload', flushPersistedUIState)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

</script>

<template>
  <div class="app">
    <!-- Header -->
    <header v-if="!projectStore.isInProjectSelection" v-show="!projectStore.terminalFullscreen" class="header" :class="{ open: headerOpen }">
      <div v-if="projectStore.projectPath" class="project-location" :title="accounts ? `/spaces/${normalizedProjectRoot}` : `${normalizedProjectRoot}\n${activeBowmanRoot}`">
        <span
          class="connection-dot"
          :class="projectStore.connectionStatus"
          :title="`aimparency server: ${projectStore.connectionStatus}`"
        ></span>
        <span class="project-chip-value">{{ activeProjectName }}</span>
        <span
          v-if="accounts"
          class="role-badge"
          :class="dataStore.access.role"
          :title="dataStore.access.reason ?? ROLE_TITLES[dataStore.access.role]"
        >{{ ROLE_LABELS[dataStore.access.role] }}</span>
        <template v-if="!accounts">
          <code class="project-path">{{ normalizedProjectRoot }}</code>
        </template>
      </div>

      <div class="view-controls">
        <button
          @click="uiStore.setView('columns')"
          :class="{ active: projectStore.currentView === 'columns' }"
          class="view-btn"
        >Columns</button>
        <button
          @click="uiStore.setView('graph')"
          :class="{ active: projectStore.currentView === 'graph' }"
          class="view-btn"
        >Graph</button>
        <button
          v-if="voiceEnabled"
          @click="uiStore.setView('voice')"
          :class="{ active: projectStore.currentView === 'voice' }"
          class="view-btn"
        >Voice</button>
      </div>

      <button
        class="icon-btn"
        @click="modalStore.openIdeaSearch()"
        title="Search ideas (/)"
      ><Search /></button>

      <div class="header-more">
        <div class="column-controls group" v-if="projectStore.currentView === 'columns'">
          <button @click="uiStore.setWindowSize(uiStore.windowSize - 1)" class="icon-btn" title="Decrease columns"><Minus /></button>
          <span>{{ uiStore.windowSize }} columns</span>
          <button @click="uiStore.setWindowSize(uiStore.windowSize + 1)" class="icon-btn" title="Increase columns"><Plus /></button>
        </div>

        <span class="spacer"></span>

        <HookControl v-if="agentsAllowed" />

        <div v-if="agentsAllowed" class="watchdog-controls group">
          <button
            @click="projectStore.showWatchdog = !projectStore.showWatchdog"
            class="icon-btn text"
            :class="{ on: projectStore.showWatchdog }"
            title="Toggle Watchdog Panel"
          >Watchdog</button>

          <button
            v-if="!accounts"
            @click="projectStore.showLoop = !projectStore.showLoop"
            class="icon-btn text loop-btn"
            :class="{ on: projectStore.showLoop }"
            title="Toggle Loop Panel"
          >
            Loop
            <span v-if="projectStore.loopHasHumanRequests" class="loop-notify-dot"></span>
          </button>

          <button
            v-if="projectStore.showWatchdog"
            @click="watchdogStore.showActionsOverlay = !watchdogStore.showActionsOverlay"
            class="icon-btn"
            :class="{ on: watchdogStore.showActionsOverlay }"
            title="Watchdog actions menu (Ctrl+Space)"
          ><Menu /></button>

          <button
            v-if="projectStore.showWatchdog"
            @click="projectStore.watchdogMaximized = !projectStore.watchdogMaximized"
            class="icon-btn"
            :class="{ on: projectStore.watchdogMaximized }"
            :title="projectStore.watchdogMaximized ? 'Exit fullscreen' : 'Maximize watchdog panel'"
          ><Minimize2 v-if="projectStore.watchdogMaximized" /><Maximize2 v-else /></button>

          <button
            v-if="projectStore.showLoop"
            @click="projectStore.showLoopActionsOverlay = !projectStore.showLoopActionsOverlay"
            class="icon-btn"
            :class="{ on: projectStore.showLoopActionsOverlay }"
            title="Loop actions menu (Ctrl+Space)"
          ><Menu /></button>

          <button
            v-if="projectStore.showLoop"
            @click="projectStore.loopMaximized = !projectStore.loopMaximized"
            class="icon-btn"
            :class="{ on: projectStore.loopMaximized }"
            :title="projectStore.loopMaximized ? 'Exit fullscreen' : 'Maximize loop panel'"
          ><Minimize2 v-if="projectStore.loopMaximized" /><Maximize2 v-else /></button>
        </div>

        <div class="project-info group">
          <button
            v-if="workingTree && dataStore.access.writable"
            class="icon-btn commit-btn"
            :class="{ prompt: commitPrompt }"
            :title="workingTreeTitle"
            :disabled="workingTree.changes.length === 0 && !workingTree.ahead"
            @click="showCommitDialog = true"
            @mouseenter="refreshWorkingTree"
          >
            <GitCommitHorizontal /> {{ workingTree.changes.length }}{{ workingTree.ahead ? ` ↑${workingTree.ahead}` : '' }}{{ commitPrompt ? ' · commit' : '' }}
          </button>

          <button
            v-if="projectStore.projectPath && dataStore.access.writable"
            class="icon-btn inbox-btn"
            title="Ideas awaiting your review or decision, by priority"
            @click="showReviewInbox = true"
          >
            <Hourglass /> {{ awaitingHumanCount }}
          </button>

          <NotesInbox v-if="accounts" @open="openNote" />

          <button v-if="dataStore.access.writable" @click="modalStore.openSettingsModal()" class="icon-btn" title="Space settings">
            <Settings />
          </button>

          <button
            v-if="projectStore.projectPath && dataStore.access.writable"
            class="consistency-btn"
            :class="{ 'has-errors': dataStore.consistencyErrors.length > 0 }"
            @click="showConsistencyModal = true"
            :title="dataStore.consistencyErrors.length > 0 ? 'Data Inconsistencies Found' : 'Data is Consistent'"
          >
            <X v-if="dataStore.consistencyErrors.length > 0" /><Check v-else />
          </button>

          <button
            v-if="projectStore.projectPath && dataStore.access.writable"
            class="icon-btn"
            title="Refresh Consistency Check"
            @click="dataStore.checkConsistency(projectStore.projectPath)"
          >
            <RefreshCw />
          </button>
        </div>

        <button class="icon-btn text close-project" @click="closeProject">Spaces</button>
      </div>

      <button
        class="icon-btn menu-toggle"
        :aria-expanded="headerOpen"
        :title="headerOpen ? 'Fewer controls' : 'More controls'"
        @click="headerOpen = !headerOpen"
      ><ChevronUp v-if="headerOpen" /><EllipsisVertical v-else /></button>

      <LoginControl v-if="accounts" />
      <button v-else class="icon-btn" title="Connect an agent (MCP)" @click="showLocalMcp = true"><Plug /></button>
    </header>

    <ProjectSelectionView
      v-if="projectStore.isInProjectSelection"
      v-model="projectPathInput"
      :project-history="projectStore.projectHistory"
      :discovered-projects="discoveredProjects"
      :scanned-roots="discoveredProjectRoots"
      :is-refreshing-discovered-projects="isRefreshingDiscoveredProjects"
      @select-project="handleSelectProject"
      @open-project-from-history="openProjectFromHistory"
      @remove-from-history="removeFromHistory"
      @refresh-discovered-projects="refreshDiscoveredProjects"
      @open-discovered-project="openDiscoveredProject"
      @open-graph="openGraph"
    />

    <!-- Main Interface -->
    <div v-else class="main-split">
      <main class="content-area" v-show="!projectStore.terminalFullscreen && !(projectStore.showWatchdog && projectStore.watchdogMaximized) && !(projectStore.showLoop && projectStore.loopMaximized)">
        <div v-if="uiStore.multiSelectMode" class="bulk-selection-bar">
          <span>{{ uiStore.multiSelectCount }} selected</span>
          <button
            type="button"
            class="bulk-delete-button"
            :class="{ confirming: uiStore.pendingBulkDelete }"
            @click="uiStore.requestBulkDelete()"
          >
            {{ uiStore.pendingBulkDelete ? `Confirm delete ${uiStore.multiSelectCount}` : 'Delete' }}
          </button>
          <button type="button" @click="uiStore.clearMultiSelect()">Clear</button>
        </div>
        <template v-if="projectLoad.viewsMayMount">
          <!-- Columns View -->
          <ColumnsView v-if="projectStore.currentView === 'columns'" />

          <!-- Graph View -->
          <GraphViewWrapper v-else-if="projectStore.currentView === 'graph'" />

          <!-- Voice View -->
          <VoiceView
            v-else-if="voiceEnabled && projectStore.currentView === 'voice'"
            @proposal-persisted="handleProposalPersisted"
          />
        </template>
      </main>

      <!-- Watchdog Panel -->
      <div
        v-if="projectStore.showWatchdog"
        class="watchdog-container"
        :style="{ height: (projectStore.watchdogMaximized || projectStore.terminalFullscreen) ? '100%' : watchdogHeight + 'px' }"
      >
        <div class="resize-handle" v-if="!projectStore.watchdogMaximized && !projectStore.terminalFullscreen" @mousedown="startResizeWatchdog"></div>
        <WatchdogPanel ref="watchdogRef" />
      </div>

      <div
        v-if="projectStore.showLoop"
        class="watchdog-container"
        :style="{ height: projectStore.loopMaximized ? '100%' : loopHeight + 'px' }"
      >
        <div class="resize-handle" v-if="!projectStore.loopMaximized" @mousedown="startResizeWatchdog"></div>
        <LoopPanel ref="loopRef" />
      </div>
    </div>

    <ProjectLoadScreen />

    <!-- Phase Creation Modal -->
    <PhaseCreationModal />
    
    <!-- Connection Details Modal (contribution %, hypothesis, reflection) -->
    <!-- Keyed by connection so a chain of reflection prompts remounts (and refocuses) per connection. -->
    <ConnectionDetailsModal
      v-if="modalStore.showConnectionDetailsModal"
      :key="`${modalStore.connectionDetailsParentId}>${modalStore.connectionDetailsChildId}`"
    />

    <IdeaRemovalDialog v-if="modalStore.ideaRemoval" :request="modalStore.ideaRemoval" />

    <McpAuthorizeModal v-if="accounts && mcpRequest" :request-id="mcpRequest" @close="closeMcpRequest" />
    <ConnectSiteModal v-if="accounts && connectRequest" :site="connectRequest.site" :state="connectRequest.state" @close="closeConnectRequest" />
    <ConnectServerModal
      v-if="modalStore.connectServer"
      :host="modalStore.connectServer.host"
      :space-name="modalStore.connectServer.spaceName"
      @close="modalStore.connectServer = null"
    />
    <!-- Before the idea editor, so an idea opened from the inbox stacks on top -->
    <ReviewInboxModal v-if="showReviewInbox" @close="showReviewInbox = false" />
    <CommitModal
      v-if="showCommitDialog && workingTree"
      :changes="workingTree.changes"
      :last-commit-at="workingTree.lastCommitAt"
      :ahead="workingTree.ahead"
      @close="showCommitDialog = false"
      @committed="showCommitDialog = false; refreshWorkingTree()"
    />

    <!-- Idea Edit Modal -->
    <IdeaEditModal
      :show="modalStore.showIdeaEditModal"
      :idea-id="modalStore.ideaEditModalIdeaId"
      :idea-ids="modalStore.ideaEditModalIdeaIds"
      @close="modalStore.closeIdeaEditModal()"
    />

    <!-- Idea Creation Modal: after the editor, so a supported idea drafted from it stacks on top -->
    <IdeaCreationModal v-if="modalStore.showIdeaModal" />

    <!-- After the idea editor: its notes offer a space too -->
    <ProposeSpaceModal
      v-if="modalStore.proposeForIdeaId"
      :idea-id="modalStore.proposeForIdeaId"
      :relative-position="modalStore.proposeRelativePosition"
      @close="modalStore.proposeForIdeaId = null"
    />

    <!-- Idea Search Modal -->
    <IdeaSearchModal
      v-if="modalStore.showIdeaSearch"
      @select="handleIdeaSearchSelect"
      @close="modalStore.dismissIdeaSearch()"
    />
    <PhaseSearchModal
      v-if="modalStore.showPhaseSearchPrompt"
      :title="modalStore.phaseSearchPromptTitle"
      :placeholder="modalStore.phaseSearchPromptPlaceholder"
      :additional-options="modalStore.phaseSearchPromptAdditionalOptions"
      @select="handlePhaseSearchSelect"
      @close="modalStore.closePhaseSearchPrompt()"
    />

    <!-- Consistency Modal -->
    <LocalMcpModal v-if="showLocalMcp" @close="showLocalMcp = false" />
    <ConsistencyModal 
        v-if="showConsistencyModal" 
        @close="showConsistencyModal = false" 
    />

    <ProjectSettingsModal v-if="modalStore.showSettingsModal" />
    <LoopActionsOverlay
      v-if="projectStore.showLoopActionsOverlay"
      @action="handleLoopAction"
    />

    <!-- Help Text -->
    <footer v-if="!projectStore.isInProjectSelection" v-show="!projectStore.terminalFullscreen" class="help">
      <div class="help-keys">
        <div v-for="hint in projectStore.keyboardHints" :key="`${hint.key}-${hint.action}`" class="hint">
          <span class="key">{{ hint.key }}</span>
          <span class="action">{{ hint.action }}</span>
        </div>
      </div>
      <div v-if="historyStore.message" class="history-message">{{ historyStore.message }}</div>
    </footer>
    <ToastStack />
    <McpOffer v-if="accounts" />
  </div>
</template>

<style scoped>
.app {
  height: 100vh; /* fallback for browsers without dynamic viewport units */
  height: 100dvh;
  display: flex;
  flex-direction: column;
  color: #e0e0e0;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--gap-s);
  padding: 0.3rem 0.6rem;
  background: var(--bg-bar);
  border-bottom: 1px solid var(--line);
  font-size: var(--font-size-label);

  .project-location {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    height: var(--control-h);
    padding: 0 0.6rem;
    border-radius: var(--radius);
    background: #00000033;
  }

  .connection-dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--text-muted);

    &.connected { background: #6c6; }
    &.connecting { background: #ffa566; }
    &.no-connection { background: #f66; }
  }

  .project-chip-value {
    color: #f0f0f0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The viewer's role in the space, each its own colour. */
  .role-badge {
    --role-color: var(--status-unclear);
    flex-shrink: 0;
    padding: 0 0.35rem;
    border: 1px solid var(--role-color);
    border-radius: var(--radius);
    color: var(--role-color);
    font-size: var(--font-size-tiny);

    &.owner { --role-color: #7ee8a5; }
    &.manage { --role-color: #8cc4ff; }
    &.write { --role-color: #e3a6ff; }
    &.read { --role-color: var(--status-unclear); }
  }

  .project-path {
    color: #b6d7ff;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-small);
  }

  .view-controls {
    display: flex;
    height: var(--control-h);
    background: var(--bg-field);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
    flex-shrink: 0;

    .view-btn.active { outline: none; }
  }

  /* Everything after the main controls; folds out below the bar on narrow screens. */
  .header-more {
    flex: 1;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--gap-s);
    min-width: 0;

    .spacer { flex: 1; }
  }

  /* A cluster of controls: one control tall, a faint pill. */
  .group {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    height: var(--control-h);
    padding: 0 0.3rem;
    border-radius: var(--radius);
    background: var(--toolbar-group-bg);

    /* Everything inside hidden (only v-if comments left): no empty pill. */
    &:empty { display: none; }
  }

  .column-controls { color: var(--text-muted); }

  .loop-btn { position: relative; }

  .loop-notify-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: #ffd166;
    box-shadow: 0 0 0 2px rgba(255, 209, 102, 0.18);
  }

  .consistency-btn {
    width: var(--control-h);
    height: var(--control-h);
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius);
    background: var(--accent);
    color: white;
    cursor: pointer;

    &:hover { background: var(--accent-hover); }
    &.has-errors { background: #ff4444; }
    &.has-errors:hover { background: #ff6666; }
  }

  .close-project { color: var(--text-muted); }

  .menu-toggle { display: none; }

  /* Narrow screens: one row with the main controls; the rest folds out below. */
  @media (max-width: 760px) {
    flex-wrap: wrap;

    .project-location {
      flex: 1;
      .project-path { display: none; }
    }

    .menu-toggle { display: flex; }

    .header-more {
      display: none;
      order: 10;
      flex-basis: 100%;
      padding: var(--gap-s) 0 0.2rem;
      border-top: 1px solid var(--line);

      .spacer { display: none; }
    }

    &.open .header-more { display: flex; }
  }
}

.main-split {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.watchdog-container {
  flex-shrink: 0;
  border-top: 1px solid #444;
  position: relative;
  display: flex;
  flex-direction: column;
}

.resize-handle {
  position: absolute;
  top: -5px;
  left: 0;
  right: 0;
  height: 10px;
  cursor: ns-resize;
  z-index: 10;
  background: transparent;
}

.resize-handle:hover {
  background: rgba(255, 255, 255, 0.1);
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.bulk-selection-bar {
  min-height: 36px;
  padding: 5px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #242424;
  border-bottom: 1px solid #484848;
  color: #ddd;
  font-size: 0.85rem;
}

.bulk-selection-bar span {
  margin-right: auto;
}

.bulk-selection-bar button {
  border: 1px solid #5a5a5a;
  background: #333;
  color: #eee;
  padding: 4px 9px;
  cursor: pointer;
}

.bulk-selection-bar .bulk-delete-button.confirming {
  border-color: #d35b5b;
  background: #8b2f2f;
}

.help {
  background: #2d2d2d;
  padding: 0.25rem 1rem;
  border-top: 1px solid #444;
  font-size: 0.8rem;

  & .history-message {
    color: #fff;
  }
}

.help-keys {
  display: block;
  color: #888;
}

.hint {
  display: inline-block;
  margin-right: 2rem;
  margin-bottom: 0.25rem;
}

.key {
  color: #fff;
  font-weight: bold;
  margin-right: 0.5rem;
}

.action {
  color: #888;
}
</style>
