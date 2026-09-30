<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { trpc } from '../trpc'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import FormModalShell from './FormModalShell.vue'

type StatusChange = Awaited<ReturnType<typeof trpc.aim.statusHistory.query>>[number]
type FileDiff = Awaited<ReturnType<typeof trpc.aim.commitDiff.query>>[number]

const props = defineProps<{ show: boolean; aimId: string | null }>()
const emit = defineEmits<{ close: [] }>()

const projectStore = useProjectStore()
const dataStore = useDataStore()
const shell = ref<InstanceType<typeof FormModalShell>>()

const history = ref<StatusChange[]>([])
const loadingHistory = ref(false)
const error = ref('')
const selectedHash = ref<string | null>(null)
const files = ref<FileDiff[]>([])
const loadingDiff = ref(false)
const selectedPath = ref<string | null>(null)

const selectedChange = computed(() => history.value.find((change) => change.commit.hash === selectedHash.value))
const selectedFile = computed(() => files.value.find((file) => file.path === selectedPath.value))

// Directory rows are emitted when a path enters a directory the previous path
// wasn't in, which turns the sorted path list into an indented tree.
const treeRows = computed(() => {
  const rows: Array<{ kind: 'dir' | 'file'; name: string; depth: number; path: string }> = []
  let previous: string[] = []
  for (const filePath of files.value.map((file) => file.path).sort()) {
    const segments = filePath.split('/')
    const dirs = segments.slice(0, -1)
    let shared = 0
    while (shared < dirs.length && dirs[shared] === previous[shared]) shared++
    for (let depth = shared; depth < dirs.length; depth++) {
      rows.push({ kind: 'dir', name: dirs[depth]!, depth, path: dirs.slice(0, depth + 1).join('/') })
    }
    rows.push({ kind: 'file', name: segments[segments.length - 1]!, depth: dirs.length, path: filePath })
    previous = dirs
  }
  return rows
})

const diffLines = computed(() => (selectedFile.value?.patch ?? '').split('\n').map((text) => ({
  text,
  kind: text.startsWith('@@') ? 'hunk' : text.startsWith('+') ? 'add' : text.startsWith('-') ? 'del' : ''
})))

// Same colors as the status select (project-defined statuses).
const statusColor = (state: string) =>
  dataStore.getStatuses.find((status: { key: string; color?: string }) => status.key === state)?.color ?? '#888'

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
})

const selectCommit = async (hash: string) => {
  selectedHash.value = hash
  loadingDiff.value = true
  error.value = ''
  try {
    const diff = await trpc.aim.commitDiff.query({ projectPath: projectStore.projectPath, hash })
    if (selectedHash.value !== hash) return
    files.value = diff
    // Start on the code the status change came with, not the aim's own JSON.
    selectedPath.value = (diff.find((file) => !file.path.includes('.bowman/')) ?? diff[0])?.path ?? null
  } catch (e) {
    error.value = `Could not load the commit diff: ${e instanceof Error ? e.message : e}`
  } finally {
    loadingDiff.value = false
  }
}

watch(() => [props.show, props.aimId] as const, async ([show, aimId]) => {
  if (!show || !aimId) return
  history.value = []
  files.value = []
  selectedHash.value = null
  selectedPath.value = null
  error.value = ''
  loadingHistory.value = true
  await nextTick()
  shell.value?.$el?.focus?.()
  try {
    history.value = await trpc.aim.statusHistory.query({ projectPath: projectStore.projectPath, aimId })
    const latest = history.value[history.value.length - 1]
    if (history.value.length > 1 && latest) await selectCommit(latest.commit.hash)
  } catch (e) {
    error.value = `Could not read the git history: ${e instanceof Error ? e.message : e}`
  } finally {
    loadingHistory.value = false
  }
}, { immediate: true })
</script>

<template>
  <FormModalShell
    ref="shell"
    :show="show"
    title="Status history"
    width="min(95vw, 80rem)"
    @request-close="emit('close')"
  >
    <div id="aim-history">
      <div v-if="loadingHistory" class="hint">Reading git history…</div>
      <div v-else-if="history.length === 0 && !error" class="hint">
        This aim's file has not been committed yet.
      </div>

      <div v-else class="status-row">
        <template v-for="(change, index) in history" :key="change.commit.hash">
          <button
            v-if="index > 0"
            type="button"
            class="commit-date"
            :class="{ selected: change.commit.hash === selectedHash }"
            :title="`${change.commit.shortHash} ${change.commit.subject}`"
            @click="selectCommit(change.commit.hash)"
          >
            {{ formatDate(change.commit.authoredAt) }}
          </button>
          <span class="status-chip" :style="{ '--chip-color': statusColor(change.state) }">
            {{ change.state }}
          </span>
        </template>
      </div>

      <div v-if="error" class="hint error">{{ error }}</div>

      <div v-if="selectedChange" class="commit-subject">
        {{ selectedChange.commit.shortHash }} · {{ selectedChange.commit.subject }}
      </div>

      <div v-if="selectedHash" class="diff-area">
        <div class="file-tree">
          <div v-if="loadingDiff" class="hint">Loading…</div>
          <template v-else>
            <div
              v-for="row in treeRows"
              :key="`${row.kind}:${row.path}`"
              class="tree-row"
              :class="[row.kind, { selected: row.path === selectedPath }]"
              :style="{ paddingLeft: `${row.depth * 0.75 + 0.25}rem` }"
              :title="row.path"
              @click="row.kind === 'file' && (selectedPath = row.path)"
            >
              {{ row.kind === 'dir' ? `${row.name}/` : row.name }}
            </div>
          </template>
        </div>
        <pre class="diff"><template v-if="selectedFile"><span
          v-for="(line, index) in diffLines"
          :key="index"
          :class="line.kind"
        >{{ line.text }}
</span></template><span v-else-if="!loadingDiff" class="hint">No textual changes.</span></pre>
      </div>
    </div>
  </FormModalShell>
</template>

<style scoped>
#aim-history {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;

  .hint {
    color: #999;
    &.error { color: var(--status-failed); }
  }

  .status-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .status-chip {
    border: 1px solid var(--chip-color);
    color: var(--chip-color);
    border-radius: 0.25rem;
    padding: 0.1rem 0.4rem;
  }

  .commit-date {
    background: none;
    border: 1px solid #555;
    border-radius: 0.25rem;
    color: #ccc;
    cursor: pointer;
    font-size: var(--font-size-small);
    &:hover, &.selected { border-color: #aaa; color: #fff; }
    &.selected { background: #ffffff14; }
  }

  .commit-subject {
    color: #ccc;
    font-size: var(--font-size-small);
  }

  .diff-area {
    display: flex;
    gap: 0.6rem;
    min-height: 0;
    /* Fill the panel (max 90vh) below the header and status rows without an outer scrollbar. */
    height: calc(90vh - 13rem);
  }

  .file-tree {
    width: 18rem;
    flex-shrink: 0;
    overflow: auto;
    border: 1px solid #444;
    font-size: var(--font-size-small);

    .tree-row {
      white-space: nowrap;
      padding: 0.1rem 0.25rem;
      &.dir { color: #888; }
      &.file { color: #ddd; cursor: pointer; }
      &.file:hover { background: #ffffff0d; }
      &.selected { background: #ffffff1f; }
    }
  }

  .diff {
    flex: 1;
    margin: 0;
    overflow: auto;
    border: 1px solid #444;
    padding: 0.4rem;
    font-size: var(--font-size-small);
    color: #ccc;

    .add { color: #7ee787; background: #2ea04326; }
    .del { color: #ffa198; background: #f8514926; }
    .hunk { color: #79c0ff; }
  }
}
</style>
