<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FormModalShell from './FormModalShell.vue'
import { useDataStore } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useToastStore, errorMessage } from '../stores/toast'
import { trpc } from '../trpc'
import { changeKind, describeChange, type WorkingTreeChange } from '../utils/git-status'
import { formatRelativeTime } from '../utils/relative-time'

const props = defineProps<{ changes: WorkingTreeChange[]; lastCommitAt: number | null; ahead: number | null }>()
const emit = defineEmits<{ close: []; committed: [] }>()

const dataStore = useDataStore()
const projectStore = useProjectStore()

// Code first, then the graph files that go with it.
const rows = computed(() => props.changes
  .map(change => ({ ...change, ...describeChange(change.path, dataStore.ideas, dataStore.phases), kind: changeKind(change.code) }))
  .sort((left, right) => Number(left.isGraph) - Number(right.isGraph) || left.label.localeCompare(right.label)))
const chosen = ref(new Set(props.changes.map(change => change.path)))
const message = ref('')
// Opened with nothing to commit, it only pushes what is already committed.
const pushOnly = props.changes.length === 0
// Pushing needs an upstream branch; ahead is null without one.
const canPush = props.ahead !== null
const push = ref(canPush)
const committing = ref(false)
const error = ref('')
const messageInput = ref<HTMLInputElement | null>(null)

const toggle = (path: string) => {
  const next = new Set(chosen.value)
  if (!next.delete(path)) next.add(path)
  chosen.value = next
}
const toggleAll = () => {
  chosen.value = chosen.value.size === rows.value.length ? new Set() : new Set(rows.value.map(row => row.path))
}

const ready = computed(() => pushOnly || (message.value.trim() !== '' && chosen.value.size > 0))
const submitLabel = computed(() => {
  if (pushOnly) return `Push ${props.ahead} ${props.ahead === 1 ? 'commit' : 'commits'}`
  const files = `${chosen.value.size} ${chosen.value.size === 1 ? 'file' : 'files'}`
  return push.value ? `Commit ${files} & push` : `Commit ${files}`
})

const commit = async () => {
  if (committing.value || !ready.value) return
  committing.value = true
  error.value = ''
  const projectPath = projectStore.projectPath
  let committed = pushOnly
  try {
    if (!pushOnly) {
      const { commit } = await trpc.git.commit.mutate({ projectPath, paths: [...chosen.value], message: message.value })
      committed = true
      useToastStore().info(`Committed ${commit}`)
    }
    if (pushOnly || push.value) {
      const { pushed } = await trpc.git.push.mutate({ projectPath })
      useToastStore().info(`Pushed ${pushed} ${pushed === 1 ? 'commit' : 'commits'}`)
    }
    emit('committed')
  } catch (failure) {
    // A failed push after a commit leaves the commit in place: report it and close.
    if (committed && !pushOnly) {
      useToastStore().error('Committed, but the push failed', failure)
      emit('committed')
    } else {
      error.value = errorMessage(failure)
    }
  } finally {
    committing.value = false
  }
}

// Keys stay inside the dialog: the app's shortcuts must not fire while typing or picking files.
const handleKeydown = (event: KeyboardEvent) => {
  event.stopPropagation()
  if (event.key === 'Escape') emit('close')
}

onMounted(() => messageInput.value?.focus())
</script>

<template>
  <FormModalShell :show="true" :title="pushOnly ? 'Push' : 'Commit'" width="min(90vw, 48rem)" :close-on-escape="false" @request-close="emit('close')">
    <form id="commit-dialog" @submit.prevent="commit" @keydown="handleKeydown">
      <p v-if="pushOnly" class="summary">
        {{ props.ahead }} unpushed {{ props.ahead === 1 ? 'commit' : 'commits' }} on this branch · last commit {{ props.lastCommitAt ? formatRelativeTime(props.lastCommitAt) : 'never' }}
      </p>
      <p v-else class="summary">
        {{ rows.length }} changed files · last commit {{ props.lastCommitAt ? formatRelativeTime(props.lastCommitAt) : 'never' }}
        <button type="button" class="link" @click="toggleAll">{{ chosen.size === rows.length ? 'none' : 'all' }}</button>
      </p>
      <ul v-if="!pushOnly">
        <li v-for="row in rows" :key="row.path" :title="row.path">
          <label>
            <input type="checkbox" :checked="chosen.has(row.path)" @change="toggle(row.path)" />
            <span class="kind" :class="row.kind">{{ row.kind }}</span>
            <span class="label">{{ row.label }}</span>
          </label>
        </li>
      </ul>
      <input v-if="!pushOnly" ref="messageInput" v-model="message" placeholder="Commit message" />
      <p v-if="error" class="error">{{ error }}</p>
      <div class="actions">
        <label v-if="canPush && !pushOnly" class="push" :title="props.ahead ? `Also pushes ${props.ahead} earlier unpushed ${props.ahead === 1 ? 'commit' : 'commits'}` : ''">
          <input v-model="push" type="checkbox" /> and push{{ props.ahead ? ` (+${props.ahead} earlier)` : '' }}
        </label>
        <button type="button" class="btn-secondary" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn-primary" :disabled="committing || !ready">{{ submitLabel }}</button>
      </div>
    </form>
  </FormModalShell>
</template>

<style scoped>
#commit-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  & .summary { margin: 0; color: #aaa; display: flex; gap: 1rem; }
  & .link { background: none; border: none; color: #4a9eff; cursor: pointer; padding: 0; }

  & ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 50vh;
    overflow-y: auto;

    & label {
      display: grid;
      grid-template-columns: auto 5rem 1fr;
      gap: 0.5rem;
      align-items: center;
      padding: 0.15rem 0;
      cursor: pointer;
    }

    & input { width: auto; }
    & .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    & .kind { color: #aaa; font-size: var(--font-size-small); }
    & .kind.new { color: var(--status-implemented); }
    & .kind.deleted { color: var(--status-failed); }
  }

  & .error { margin: 0; color: #e57373; }
  & .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;

    & .push { margin-right: auto; display: flex; align-items: center; gap: 0.35rem; color: #aaa; cursor: pointer; }
    & .push input { width: auto; }
  }
}
</style>
