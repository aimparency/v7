<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { useGraphUIStore } from '../stores/ui/graph-store'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'

const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()
const graphUIStore = useGraphUIStore()

const pathInput = ref('')
const pathInputEl = ref<HTMLInputElement>()
const removeFromSource = ref(true)
const candidates = ref<string[]>([])
const bowmanExists = ref(false)
const applying = ref(false)
const errorMessage = ref('')

const rootIds = computed(() => graphUIStore.spinOffPreviewRootIds)

// Slugify an aim title into a filesystem-friendly directory name.
const slugify = (text: string): string =>
  text.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'spin-off'

// Suggest a sibling directory next to the current project, named after the first root aim.
const defaultTargetPath = (): string => {
  const projectPath = projectStore.projectPath
  const projectRoot = projectPath.replace(/\/\.bowman\/?$/, '')
  const parent = projectRoot.replace(/\/[^/]*\/?$/, '') || '~'
  const firstRoot = rootIds.value[0]
  const slug = firstRoot ? slugify(dataStore.aims[firstRoot]?.text ?? 'spin-off') : 'spin-off'
  return `${parent}/${slug}`
}

let checkTimer: ReturnType<typeof setTimeout> | undefined

// Debounced lookup that keeps the .bowman-exists warning and candidate list current.
const refreshPathState = () => {
  clearTimeout(checkTimer)
  checkTimer = setTimeout(async () => {
    try {
      const result = await trpc.spinOff.completePath.query({ partial: pathInput.value })
      bowmanExists.value = result.bowmanExists
      candidates.value = result.matches
    } catch {
      bowmanExists.value = false
      candidates.value = []
    }
  }, 200)
}

// Longest common prefix of the candidate paths, for tab-to-complete.
const commonPrefix = (paths: string[]): string => {
  if (paths.length === 0) return ''
  let prefix = paths[0]!
  for (const candidatePath of paths) {
    while (!candidatePath.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  return prefix
}

const onTab = async (event: KeyboardEvent) => {
  event.preventDefault()
  try {
    const result = await trpc.spinOff.completePath.query({ partial: pathInput.value })
    bowmanExists.value = result.bowmanExists
    candidates.value = result.matches
    if (result.matches.length === 1) {
      pathInput.value = result.matches[0]! + '/'
    } else if (result.matches.length > 1) {
      const prefix = commonPrefix(result.matches)
      if (prefix.length > pathInput.value.length) pathInput.value = prefix
    }
  } catch {
    // ignore completion failures
  }
}

const canApply = computed(() =>
  !applying.value &&
  rootIds.value.length > 0 &&
  pathInput.value.trim().length > 0 &&
  !bowmanExists.value
)

const apply = async () => {
  if (!canApply.value) return
  applying.value = true
  errorMessage.value = ''
  try {
    await trpc.spinOff.execute.mutate({
      projectPath: projectStore.projectPath,
      rootIds: rootIds.value,
      targetPath: pathInput.value.trim(),
      removeFromSource: removeFromSource.value
    })
    modalStore.closeSpinOffApplyModal()
    graphUIStore.clearSpinOffPreview()
    await dataStore.loadAllAims(projectStore.projectPath)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    applying.value = false
  }
}

const close = () => {
  modalStore.closeSpinOffApplyModal()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    apply()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

const pickCandidate = (candidatePath: string) => {
  pathInput.value = candidatePath + '/'
  refreshPathState()
  pathInputEl.value?.focus()
}

watch(() => modalStore.showSpinOffApplyModal, async (show) => {
  if (show) {
    pathInput.value = defaultTargetPath()
    removeFromSource.value = true
    candidates.value = []
    errorMessage.value = ''
    refreshPathState()
    await nextTick()
    pathInputEl.value?.focus()
    pathInputEl.value?.select()
  }
})
</script>

<template>
  <FormModalShell
    :show="modalStore.showSpinOffApplyModal"
    title="Apply Spin-off"
    @request-close="close"
  >
    <div class="form-group">
      <label>Target directory</label>
      <input
        ref="pathInputEl"
        v-model="pathInput"
        type="text"
        placeholder="~/projects/my-spin-off"
        spellcheck="false"
        @input="refreshPathState"
        @keydown.tab.exact="onTab"
        @keydown.enter="onKeydown"
        @keydown.esc="onKeydown"
      />
      <p class="hint">Press Tab to autocomplete. Supports <code>~/</code> and absolute paths.</p>

      <ul v-if="candidates.length > 1" class="candidates">
        <li v-for="candidatePath in candidates" :key="candidatePath" @click="pickCandidate(candidatePath)">
          {{ candidatePath }}
        </li>
      </ul>

      <p v-if="bowmanExists" class="feedback warn">
        A <code>.bowman</code> graph already exists here. Integrating into an existing graph is not supported yet — choose an empty target.
      </p>
    </div>

    <label class="checkbox-row">
      <input type="checkbox" v-model="removeFromSource" />
      <span>Remove spun-off aims from source graph (keeps shared aims)</span>
    </label>

    <p class="summary">
      Spinning off {{ rootIds.length }} root aim{{ rootIds.length === 1 ? '' : 's' }} and their exclusive supporters.
    </p>

    <p v-if="errorMessage" class="feedback error">{{ errorMessage }}</p>

    <template #footer>
      <button class="btn-secondary" @click="close">Cancel</button>
      <button class="btn-primary" :disabled="!canApply" @click="apply">
        {{ applying ? 'Applying…' : 'Apply' }}
      </button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.form-group {
  margin-bottom: 0.75rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.375rem;
  font-weight: bold;
  color: #ccc;
}

.form-group input[type='text'] {
  width: 100%;
  padding: 0.5rem;
  background: #1a1a1a;
  border: 1px solid #555;
  border-radius: 0.1875rem;
  color: #e0e0e0;
  font-family: monospace;
}

.form-group input[type='text']:focus {
  outline: none;
  border-color: #007acc;
}

.hint {
  margin: 0.375rem 0 0;
  font-size: 0.8rem;
  color: #888;
}

.hint code,
.feedback code {
  background: #1a1a1a;
  padding: 0 0.25rem;
  border-radius: 0.125rem;
}

.candidates {
  list-style: none;
  margin: 0.375rem 0 0;
  padding: 0.25rem;
  max-height: 9rem;
  overflow-y: auto;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 0.1875rem;
  font-family: monospace;
  font-size: 0.85rem;
}

.candidates li {
  padding: 0.25rem 0.375rem;
  color: #ccc;
  cursor: pointer;
  border-radius: 0.125rem;
}

.candidates li:hover {
  background: #333;
  color: #fff;
}

.feedback {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  padding: 0.5rem;
  border-radius: 0.1875rem;
}

.feedback.warn {
  color: #ffcc80;
  background: rgba(255, 204, 128, 0.1);
  border: 1px solid rgba(255, 204, 128, 0.3);
}

.feedback.error {
  color: #ff8080;
  background: rgba(255, 128, 128, 0.1);
  border: 1px solid rgba(255, 128, 128, 0.3);
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #ccc;
  cursor: pointer;
  margin-bottom: 0.75rem;
}

.checkbox-row input {
  cursor: pointer;
}

.summary {
  margin: 0;
  font-size: 0.85rem;
  color: #999;
}

.btn-primary,
.btn-secondary {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

.btn-primary {
  background: #007acc;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #005a99;
}

.btn-primary:disabled {
  background: #444;
  color: #666;
  cursor: not-allowed;
}

.btn-secondary {
  background: #444;
  color: #e0e0e0;
}

.btn-secondary:hover {
  background: #555;
}
</style>
