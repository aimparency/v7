<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ProjectHistoryEntry } from '../stores/ui/project-helpers'
import { trpc } from '../trpc'
import { loadProjectThumbnails } from '../utils/db'
import { formatRelativeTime } from '../utils/relative-time'
import { gitRepositoryLocation } from 'shared'
import { Pencil, X } from 'lucide-vue-next'
import LoginControl from '../components/LoginControl.vue'
import { useToastStore } from '../stores/toast'
import { useViewerStore } from '../stores/viewer'
import { hasAccounts } from '../utils/runtime-config'

// The start page: one box and one list, alike on a server with accounts and on
// this machine alone. The box filters the list and opens or adds what is typed;
// the list holds the recent spaces, the server's spaces and, without accounts,
// the .bowman folders nearby. Recent: what this browser opened before, first. Keys: Tab or ↓ into the list, j/k (arrows, Tab)
// to move, Enter to open, e to copy an entry into the box, d d to forget a recent one.

type DiscoveredProject = {
  path: string
  bowmanPath: string
  sourceRoot: string
}

const props = defineProps<{
  modelValue: string
  projectHistory: ProjectHistoryEntry[]
  discoveredProjects: DiscoveredProject[]
  scannedRoots: string[]
  isRefreshingDiscoveredProjects: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'select-project'): void
  (event: 'open-project-from-history', path: string): void
  (event: 'remove-from-history', path: string): void
  (event: 'refresh-discovered-projects'): void
  (event: 'open-discovered-project', path: string): void
  (event: 'open-graph', slug: string): void
}>()

// With accounts the server's spaces are all there is to open: the directories
// of the machine are the operator's business.
const accounts = hasAccounts()
const viewer = useViewerStore()
const toast = useToastStore()
const spaces = ref<Awaited<ReturnType<typeof trpc.graphs.list.query>>>([])
const loadSpaces = async () => {
  spaces.value = await trpc.graphs.list.query()
}
onMounted(() => loadSpaces().catch(error => toast.error('Could not list the spaces of this server', error)))

const typed = computed(() => props.modelValue.trim())
const busy = ref(false)
const act = async (failure: string, action: () => Promise<{ slug: string }>, needsAccount = true) => {
  // Where the server gives accounts automatically, the visitor gets theirs now.
  if (needsAccount && !await viewer.ensureAccount()) return
  busy.value = true
  try {
    const { slug } = await action()
    emit('update:modelValue', '')
    emit('open-graph', slug)
  } catch (error) {
    toast.error(failure, error)
  } finally {
    busy.value = false
  }
}
const createSpace = () => act('Could not create the space', () => trpc.graphs.create.mutate({ name: typed.value }))
// A space that lives in a repository elsewhere: the server clones its .bowman.
const addRemote = () => act('Could not add the repository', () => trpc.graphs.addRemote.mutate({ url: typed.value }))
// A repository already on this machine, by its path: server admins only.
const addCheckout = () => act('Could not add the repository', () => trpc.graphs.addCheckout.mutate({ path: typed.value }), false)

const mayCreate = computed(() => viewer.canCreateGraphs || viewer.getsAccountAutomatically)
const mayAddRemote = computed(() => !!viewer.name || viewer.getsAccountAutomatically)

// Without accounts: what the typed folder is (has a .bowman or not), and the
// common start of the folders it may continue to (Tab completes).
const inspectedPath = ref('')
const bowmanExists = ref<boolean | null>(null)
const completionValue = ref('')
let inspectionTimer: ReturnType<typeof setTimeout> | undefined
let inspectionRevision = 0

watch(() => props.modelValue, (value) => {
  clearTimeout(inspectionTimer)
  const path = value.trim()
  const revision = ++inspectionRevision
  inspectedPath.value = ''
  bowmanExists.value = null
  completionValue.value = ''
  if (accounts || !path || gitRepositoryLocation(path)) return
  inspectionTimer = setTimeout(async () => {
    try {
      const result = await trpc.project.inspectPath.query({ graph: path })
      if (revision !== inspectionRevision) return
      inspectedPath.value = path
      bowmanExists.value = result.bowmanExists
      const matches = result.matches ?? []
      if (matches.length > 0) {
        let prefix = matches[0]!
        for (const candidate of matches.slice(1)) {
          while (prefix && !candidate.startsWith(prefix)) prefix = prefix.slice(0, -1)
        }
        if (prefix.startsWith(path) && prefix.length > path.length) completionValue.value = prefix
      }
    } catch {
      if (revision !== inspectionRevision) return
      inspectedPath.value = path
      bowmanExists.value = null
    }
  }, 200)
}, { immediate: true })

onUnmounted(() => clearTimeout(inspectionTimer))

const completionSuffix = computed(() => completionValue.value.slice(typed.value.length))

const onInput = (event: Event) => {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

// One list of entries, in sections; the selection is an index into all of them.
type Entry = {
  key: string
  title: string
  /** Under the title, smaller (where a nearby folder keeps its .bowman). */
  sub?: string
  /** Right of the title: owner and address, or when it was opened. */
  detail: string
  /** What the box filters by and a perfect match is, lower case. */
  searchable: string[]
  thumbnail: string
  color?: string | null
  failed?: boolean
  /** A recent entry: d d (or ×) forgets it. */
  recent?: boolean
  /** What e (or the pencil) copies into the box. */
  edit: string
  open: () => void
}
type Section = { id: string, title: string, empty?: string, entries: Entry[] }

const query = computed(() => typed.value.replace(/\/+$/, '').toLowerCase())
const matchesQuery = (entry: Entry) => !query.value || entry.searchable.some(text => text.includes(query.value))

type Space = (typeof spaces.value)[number]
const spaceEntry = (space: Space): Entry => ({
  key: `space:${space.slug}`,
  title: space.name,
  detail: `${space.owner ?? 'server'} · /g/${space.slug}`,
  searchable: [space.name.toLowerCase(), space.slug],
  thumbnail: space.slug,
  color: space.color,
  edit: space.slug,
  open: () => emit('open-graph', space.slug)
})
const pathSearchable = (path: string) => [path.toLowerCase(), path.toLowerCase().split('/').pop() ?? '']
// A recent space of the server looks like its entry below, with when it was opened.
// With accounts only the server's spaces count: a folder path opens nothing there.
const recentEntries = computed<Entry[]>(() => props.projectHistory.flatMap(project => {
  const opened = formatRelativeTime(project.lastOpened)
  const space = spaces.value.find(candidate => candidate.slug === project.path)
  if (space) return [{ ...spaceEntry(space), key: `recent:${project.path}`, detail: `${space.owner ?? 'server'} · ${opened}`, recent: true }]
  if (accounts) return []
  return [{
    key: `recent:${project.path}`,
    title: project.path,
    detail: opened,
    searchable: pathSearchable(project.path),
    thumbnail: project.path,
    failed: project.failedToLoad,
    recent: true,
    edit: project.path,
    open: () => emit('open-project-from-history', project.path)
  }]
}))
const recentPaths = computed(() => new Set(props.projectHistory.map(project => project.path)))
const spaceEntries = computed<Entry[]>(() => spaces.value.filter(space => !recentPaths.value.has(space.slug)).map(spaceEntry))
const nearbyEntries = computed<Entry[]>(() => {
  return props.discoveredProjects.filter(project => !recentPaths.value.has(project.path)).map(project => ({
    key: `nearby:${project.path}`,
    title: project.path,
    sub: project.bowmanPath,
    detail: `from ${project.sourceRoot}`,
    searchable: pathSearchable(project.path),
    thumbnail: project.path,
    edit: project.path,
    open: () => emit('open-discovered-project', project.path)
  }))
})

const sections = computed<Section[]>(() => {
  const all: Section[] = []
  const recent = recentEntries.value.filter(matchesQuery)
  if (recent.length > 0) all.push({ id: 'recent', title: 'Recent spaces', entries: recent })
  if (accounts || spaceEntries.value.length > 0) {
    const others = spaceEntries.value.filter(matchesQuery)
    // Every space of the server is among the recent ones: no empty section for the rest.
    if (others.length > 0 || recentEntries.value.length === 0 || query.value) {
      all.push({ id: 'spaces', title: accounts ? 'Spaces on this server' : 'Spaces of the local server', empty: query.value ? 'No other matching space.' : 'No spaces yet.', entries: others })
    }
  }
  if (!accounts) {
    all.push({ id: 'nearby', title: 'Nearby spaces (.bowman folders)', empty: query.value ? 'No other matching spaces.' : 'No nearby spaces found yet.', entries: nearbyEntries.value.filter(matchesQuery) })
  }
  return all
})
const entries = computed(() => sections.value.flatMap(section => section.entries))
const indexOf = (entry: Entry) => entries.value.indexOf(entry)

// One entry whose name (or folder) is exactly what was typed: highlighted, and Enter opens it.
const perfectMatchIndex = computed(() => {
  if (!query.value) return -1
  const matches = entries.value.flatMap((entry, index) => entry.searchable.includes(query.value) ? [index] : [])
  return matches.length === 1 ? matches[0]! : -1
})

// What the box's button does with what was typed.
const primary = computed<{ label: string, run: () => unknown, disabled?: boolean } | null>(() => {
  const text = typed.value
  if (perfectMatchIndex.value >= 0) return { label: 'Open', run: () => entries.value[perfectMatchIndex.value]!.open() }
  if (!accounts) {
    const label = gitRepositoryLocation(text) ? 'Open read-only'
      : text && inspectedPath.value === text && bowmanExists.value === false ? 'New space' : 'Open space'
    return { label, run: () => emit('select-project') }
  }
  if (!text) return null
  if (gitRepositoryLocation(text)) return mayAddRemote.value ? { label: busy.value ? 'Cloning…' : 'Add from Git', run: addRemote } : null
  if (text.startsWith('/') && viewer.serverAdmin) return { label: 'Add from server', run: addCheckout }
  return mayCreate.value ? { label: 'New space', run: createSpace } : null
})
const runPrimary = () => {
  if (primary.value && !busy.value) void primary.value.run()
}
// Why the box adds nothing here.
const addHint = computed(() => {
  if (!accounts || mayCreate.value) return ''
  return viewer.name ? 'Creating spaces here is for selected accounts.' : 'Log in to create a space.'
})
const placeholder = computed(() => {
  if (!accounts) return 'Find a space, or a folder path or Git URL to open'
  const adds = [mayCreate.value && 'name a new one', mayAddRemote.value && 'paste a Git URL', viewer.serverAdmin && 'a path on this server'].filter(Boolean)
  return adds.length ? `Find a space, ${adds.join(', ')}` : 'Find a space'
})

const listRef = ref<HTMLElement>()
const inputRef = ref<HTMLInputElement>()
onMounted(() => inputRef.value?.focus())
const selectedIndex = ref(-1)
watch(perfectMatchIndex, (index) => { selectedIndex.value = index }, { immediate: true })

const focusResult = (index: number) => {
  if (entries.value.length === 0) return
  selectedIndex.value = Math.max(0, Math.min(index, entries.value.length - 1))
  nextTick(() => {
    listRef.value?.querySelectorAll<HTMLElement>('.history-open-button')[selectedIndex.value]?.focus()
  })
}

const focusInput = () => {
  selectedIndex.value = perfectMatchIndex.value
  inputRef.value?.focus()
}

const onInputTab = (event: KeyboardEvent) => {
  if (event.shiftKey) return
  if (completionValue.value) {
    event.preventDefault()
    emit('update:modelValue', completionValue.value)
    return
  }
  if (entries.value.length === 0) return
  event.preventDefault()
  focusResult(Math.max(selectedIndex.value, 0))
}

const onInputDown = (event: KeyboardEvent) => {
  if (entries.value.length === 0) return
  event.preventDefault()
  focusResult(Math.max(selectedIndex.value, 0))
}

// d marks the selected recent space for forgetting (red), a second d forgets it.
const pendingRemoval = ref('')
watch(selectedIndex, () => { pendingRemoval.value = '' })

const copyIntoBox = (entry: Entry) => {
  emit('update:modelValue', entry.edit)
  focusInput()
}

const onListKeydown = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const key = event.key
  const confirmingRemoval = pendingRemoval.value
  pendingRemoval.value = ''
  const entry = entries.value[selectedIndex.value]
  if (key === 'd') {
    if (!entry?.recent) return
    if (confirmingRemoval !== entry.key) pendingRemoval.value = entry.key
    else {
      emit('remove-from-history', entry.key.slice('recent:'.length))
      focusResult(selectedIndex.value)
    }
  } else if (key === 'j' || key === 'ArrowDown' || (key === 'Tab' && !event.shiftKey)) focusResult(selectedIndex.value + 1)
  else if ((key === 'Tab' && event.shiftKey && selectedIndex.value === 0) || key === 'Escape' || (key === 'ArrowUp' && selectedIndex.value === 0)) {
    event.stopPropagation()
    focusInput()
  } else if (key === 'k' || key === 'ArrowUp' || key === 'Tab') focusResult(selectedIndex.value - 1)
  else if (key === 'e') {
    if (entry) copyIntoBox(entry)
    else focusInput()
  } else return
  event.preventDefault()
}

// Screenshots of each space's graph, taken by the graph view (utils/db).
const thumbnails = ref(new Map<string, string>())
const revokeThumbnails = () => thumbnails.value.forEach(url => URL.revokeObjectURL(url))
watch(() => [...spaceEntries.value, ...recentEntries.value, ...nearbyEntries.value].map(entry => entry.thumbnail), async (keys) => {
  const blobs = await loadProjectThumbnails(keys).catch(() => new Map<string, Blob>())
  revokeThumbnails()
  thumbnails.value = new Map([...blobs].map(([key, blob]) => [key, URL.createObjectURL(blob)]))
}, { immediate: true })
onUnmounted(revokeThumbnails)
</script>

<template>
  <div class="project-selection">
    <h1>Aimparency</h1>
    <LoginControl v-if="accounts" />

    <div class="project-input-container">
      <div class="project-input-shell">
        <div v-if="completionSuffix" class="path-completion" aria-hidden="true">
          <span class="typed-path">{{ props.modelValue }}</span><span>{{ completionSuffix }}</span>
        </div>
        <input
          ref="inputRef"
          :value="props.modelValue"
          type="text"
          :placeholder="placeholder"
          class="project-input"
          @input="onInput"
          @keydown.tab="onInputTab"
          @keydown.down="onInputDown"
          @keydown.enter.prevent="runPrimary"
        />
      </div>
      <button class="select-project" :disabled="!primary || busy" @click="runPrimary">{{ primary?.label ?? 'Open' }}</button>
    </div>
    <p v-if="addHint" class="empty-state">{{ addHint }}</p>

    <div ref="listRef" class="project-lists" @keydown="onListKeydown">
      <section v-for="section in sections" :key="section.id" class="project-history">
        <div class="section-header">
          <h3>{{ section.title }}</h3>
          <button
            v-if="section.id === 'nearby'"
            class="refresh-button"
            :disabled="props.isRefreshingDiscoveredProjects"
            @click="emit('refresh-discovered-projects')"
          >
            {{ props.isRefreshingDiscoveredProjects ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
        <p v-if="section.id === 'nearby' && props.scannedRoots.length > 0" class="discovery-hint">
          Scanned {{ props.scannedRoots.join(', ') }}
        </p>

        <div v-if="section.entries.length > 0" class="history-list">
          <div
            v-for="entry in section.entries"
            :key="entry.key"
            class="history-item"
            :class="{ failed: entry.failed, selected: indexOf(entry) === selectedIndex, removing: entry.key === pendingRemoval, 'discovered-item': section.id === 'nearby' }"
          >
            <button
              type="button"
              class="history-open-button"
              @click="entry.open()"
              @focus="selectedIndex = indexOf(entry)"
            >
              <img v-if="thumbnails.get(entry.thumbnail)" class="thumbnail" :src="thumbnails.get(entry.thumbnail)" alt="" />
              <span v-else class="thumbnail" :style="{ background: entry.color ?? undefined }"></span>
              <span class="history-item-content">
                <span class="history-primary">
                  <span class="history-path">{{ entry.title }}</span>
                  <span v-if="entry.sub" class="history-bowman">{{ entry.sub }}</span>
                </span>
                <span class="history-time">{{ entry.detail }}</span>
              </span>
            </button>
            <button
              type="button"
              class="edit-button"
              tabindex="-1"
              title="Into the box, to change before opening (e)"
              aria-label="Into the box, to change before opening"
              @click.stop="copyIntoBox(entry)"
            ><Pencil /></button>
            <button
              v-if="entry.recent"
              type="button"
              class="remove-button"
              tabindex="-1"
              title="Forget (d d)"
              aria-label="Forget"
              @click.stop="emit('remove-from-history', entry.key.slice('recent:'.length))"
            ><X /></button>
          </div>
        </div>
        <p v-else class="empty-state">{{ section.empty }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.project-selection {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 2rem;
  max-width: 90rem;
  width: 100%;
  min-height: 0;
  margin: 0 auto;
}

.project-input-container {
  display: flex;
  gap: 0.5rem;
  width: 100%;
}

.project-input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.3125rem;
  color: #e0e0e0;
  font-size: 1rem;
}

.project-input-shell {
  position: relative;
  flex: 1;
}

.path-completion {
  position: absolute;
  inset: 0;
  padding: 0.75rem 1rem;
  color: #666;
  font-family: monospace;
  white-space: pre;
  pointer-events: none;
}

.typed-path {
  visibility: hidden;
}

.project-input {
  position: relative;
  background: transparent;
  font-family: monospace;
}

.project-input:focus {
  outline: none;
  border-color: #007acc;
}

.project-input::placeholder {
  color: #666;
}

.select-project {
  background: #007acc;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 0.3125rem;
  cursor: pointer;
  font-size: 1rem;
  white-space: nowrap;
}

.select-project:hover:not(:disabled) {
  background: #005a99;
}

.select-project:disabled {
  background: #444;
  color: #888;
  cursor: default;
}

.project-history {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.project-lists {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding-right: 0.25rem;
  scrollbar-width: thin;
  scrollbar-color: #555 #1a1a1a;
}

.project-discovery {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.project-history h3,
.section-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #ccc;
}

.refresh-button {
  background: transparent;
  color: #ccc;
  border: 1px solid #555;
  border-radius: 0.3125rem;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}

.refresh-button:hover:not(:disabled) {
  background: #2d2d2d;
}

.refresh-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.discovery-hint,
.empty-state {
  margin: 0;
  color: #888;
  font-size: 0.85rem;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.project-lists::-webkit-scrollbar {
  width: 0.375rem;
}

.project-lists::-webkit-scrollbar-track {
  background: #1a1a1a;
}

.project-lists::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 0.1875rem;
}

.project-lists::-webkit-scrollbar-thumb:hover {
  background: #666;
}

.history-item {
  width: 100%;
  display: flex;
  align-items: center;
  background: #2d2d2d;
  border: 1px solid #444;
  border-radius: 0.3125rem;
  transition: background 0.2s;
  overflow: hidden;
}

.discovered-item {
  border-color: #3b5269;
}

.history-item:hover {
  background: #333;
}

.history-item {
  /* Same as the selected row of the list view: blue outline, brighter bg. */
  &.selected {
    outline: 0.15rem solid #007acc;
    outline-offset: -0.15rem;
    background-image: linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1));
  }

  &.removing {
    border-color: #ff6666;
    background: #4a2020;
  }

  & .thumbnail {
    flex: 0 0 8rem;
    height: 5rem;
    object-fit: cover;
    border-radius: 0.1875rem;
    background: #1a1a1a;
  }
}

.history-item.failed {
  border-color: #ff666644;
}

.history-item.failed .history-path {
  color: #ff6666;
}


.history-open-button {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  /* The whole row opens the space, screenshot included. */
  padding: 0.5rem 1rem 0.5rem 0.5rem;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;

  /* The row's selection outline already shows focus. */
  &:focus-visible {
    outline: none;
  }
}

.history-item-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-width: 0;
}

/* Narrow screens: name over address, a smaller screenshot. */
@media (max-width: 600px) {
  .project-selection { padding: 1rem; }

  .history-item .thumbnail {
    flex-basis: 4.5rem;
    height: 3rem;
  }

  .history-item-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
  }

  .history-time {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.history-path {
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-primary {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.history-bowman {
  color: #7ea8d6;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  font-size: 0.8rem;
  color: #888;
  white-space: nowrap;
}

.edit-button {
  flex: 0 0 auto;
  align-self: stretch;
  width: 2.5rem;
  background: transparent;
  border: none;
  border-left: 1px solid #3b3b3b;
  color: #8ea9c4;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.edit-button:hover {
  background: #253140;
  color: #d6e6f7;
}

.remove-button {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  color: #888;
  font-size: 1.5rem;
  cursor: pointer;
  align-self: stretch;
  padding: 0 0.75rem;
  line-height: 1;
  transition: color 0.2s;
}

.remove-button:hover {
  color: #ff6666;
}
</style>
