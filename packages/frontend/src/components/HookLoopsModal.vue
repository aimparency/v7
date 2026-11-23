<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import FormModalShell from './FormModalShell.vue'
import DiscardPrompt from './DiscardPrompt.vue'
import { useProjectStore } from '../stores/project-store'
import { errorMessage } from '../stores/toast'
import { trpc } from '../trpc'
import { DEFAULT_LOOP, type HookLoop, type HookState } from '../utils/hook-loops'

// The hook's loops: the default (editable, saved only as a new loop) and the
// graph's saved ones in .bowman/hook-loops/, versioned with it.

const props = defineProps<{ state: HookState }>()
const emit = defineEmits<{ update: [state: HookState]; close: [] }>()

const projectStore = useProjectStore()
const defaultLoop = computed(() => props.state.loops.find(loop => loop.slug === DEFAULT_LOOP))

const slug = ref(props.state.loop ?? DEFAULT_LOOP)
const draft = ref<Omit<HookLoop, 'slug'>>({ title: '', work: '', human: '' })
const error = ref('')
const busy = ref(false)

const isDefault = computed(() => slug.value === DEFAULT_LOOP)
const original = computed(() => props.state.loops.find(loop => loop.slug === slug.value))
const dirty = computed(() => !original.value
  || (['title', 'work', 'human'] as const).some(key => draft.value[key] !== original.value![key]))

const open = (next: string, loops = props.state.loops) => {
  const loop = loops.find(candidate => candidate.slug === next)
  slug.value = next
  draft.value = loop ? { title: loop.title, work: loop.work, human: loop.human } : { title: '', work: '', human: '' }
  error.value = ''
}
open(slug.value)

const resetToDefault = () => {
  const fallback = defaultLoop.value
  if (fallback) draft.value = { ...draft.value, work: fallback.work, human: fallback.human }
}

const run = async (action: () => Promise<HookState & { saved?: string }>) => {
  busy.value = true
  error.value = ''
  try {
    const next = await action()
    emit('update', next)
    open(next.saved ?? (next.loops.some(loop => loop.slug === slug.value) ? slug.value : DEFAULT_LOOP), next.loops)
  } catch (failure) {
    error.value = errorMessage(failure)
  } finally {
    busy.value = false
  }
}

const graph = () => projectStore.projectPath
const saveDraft = (asNew: boolean) => trpc.continueHook.saveLoop.mutate({
  graph: graph(),
  slug: asNew || isDefault.value ? undefined : slug.value,
  ...draft.value,
  title: asNew && draft.value.title === original.value?.title ? `${draft.value.title} (copy)` : draft.value.title
})
const save = (asNew: boolean) => run(() => saveDraft(asNew))

// Activate runs the open loop from the agent's next stop; unsaved edits are
// saved first (the default's as a new loop). Installing stays in the Hook menu.
const running = computed(() => props.state.enabled && (props.state.loop ?? DEFAULT_LOOP) === slug.value)
const canActivate = computed(() => !running.value || (dirty.value && isDefault.value))
const activate = () => run(async () => {
  let loop = slug.value
  if (dirty.value) {
    const saved = await saveDraft(isDefault.value)
    emit('update', saved) // kept even if activating fails
    loop = saved.saved
  }
  return { ...await trpc.continueHook.select.mutate({ graph: graph(), loop }), saved: loop }
})
const remove = () => run(() => trpc.continueHook.deleteLoop.mutate({ graph: graph(), slug: slug.value }))

// Escape out of a textarea is a vim habit, so leaving with unsaved edits asks
// first (as the idea editor does); Escape on that prompt keeps editing.
const confirmingDiscard = ref(false)
const requestClose = () => {
  if (confirmingDiscard.value) confirmingDiscard.value = false
  else if (dirty.value) confirmingDiscard.value = true
  else emit('close')
}

// Capture phase: the dialog owns the keyboard wherever focus is, so the app's
// shortcuts never fire while it is open.
const handleKeydown = (event: KeyboardEvent) => {
  event.stopPropagation()
  if (event.key !== 'Escape') return
  event.preventDefault()
  requestClose()
}
onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))
</script>

<template>
  <FormModalShell :show="true" title="Hook loops" width="min(94vw, 64rem)" :close-on-escape="false" @request-close="requestClose">
    <div class="hook-loops">
      <nav class="loop-list">
        <button
          v-for="loop in state.loops"
          :key="loop.slug"
          type="button"
          :class="{ selected: loop.slug === slug }"
          @click="open(loop.slug)"
        >
          {{ loop.title }}
          <span v-if="state.enabled && (state.loop ?? DEFAULT_LOOP) === loop.slug" class="hint">running</span>
          <span v-else-if="loop.slug === DEFAULT_LOOP" class="hint">built in</span>
        </button>
      </nav>

      <form class="editor stack" @submit.prevent="save(isDefault)">
        <p v-if="isDefault" class="hint">The built-in loop. Change it freely and save it as a new loop; the original stays as it is.</p>
        <p v-else class="hint">Saved in <code>.bowman/hook-loops/{{ slug }}.md</code>, versioned with the space.</p>
        <label class="stack">
          <span class="section-title">Title</span>
          <input v-model="draft.title" />
        </label>
        <label class="stack">
          <span class="section-title">When the agent tries to stop</span>
          <textarea v-model="draft.work" rows="12"></textarea>
        </label>
        <label class="stack">
          <span class="section-title">When the agent asks for the human (empty: the default's)</span>
          <textarea v-model="draft.human" rows="6"></textarea>
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="row actions">
          <button v-if="!isDefault" type="button" class="btn-danger" :disabled="busy" @click="remove">Delete</button>
          <button type="button" class="btn-secondary" :disabled="busy" @click="resetToDefault">Reset to default</button>
          <span class="grow"></span>
          <button v-if="!isDefault" type="button" class="btn-secondary" :disabled="busy" @click="save(true)">Save as new</button>
          <button type="submit" class="btn-primary" :disabled="busy || (!isDefault && !dirty)">{{ isDefault ? 'Save as new loop' : 'Save' }}</button>
          <button
            v-if="canActivate"
            type="button"
            class="btn-primary"
            :disabled="busy || !state.installed"
            :title="state.installed ? 'Run this loop from the agent\'s next stop' : 'Install the hook from the Hook menu first'"
            @click="activate"
          >{{ dirty ? 'Save & activate' : 'Activate' }}</button>
        </div>
        <p v-if="!state.installed" class="hint">The hook is not installed in this repository yet: install it from the Hook menu to activate a loop.</p>
      </form>
    </div>
    <DiscardPrompt v-if="confirmingDiscard" @keep="confirmingDiscard = false" @discard="emit('close')" />
  </FormModalShell>
</template>

<style scoped>
.hook-loops {
  display: flex;
  gap: var(--gap-m);
  min-height: 0;

  .loop-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 14rem;
    flex-shrink: 0;

    button {
      display: flex;
      justify-content: space-between;
      gap: var(--gap-s);
      padding: 0.5rem 0.6rem;
      background: none;
      border: none;
      border-radius: var(--radius);
      color: var(--text);
      text-align: left;
      cursor: pointer;

      &:hover { background: var(--line); }
      &.selected { background: var(--toolbar-group-bg); outline: 1px solid var(--accent); }
    }
  }

  .editor {
    flex: 1;
    min-width: 0;

    textarea { resize: vertical; }
  }

  @media (max-width: 760px) {
    flex-direction: column;

    .loop-list { width: auto; }
  }
}
</style>
