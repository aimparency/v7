<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { AimProposal } from 'shared'
import FormModalShell from './FormModalShell.vue'
import AimProposalReview from './AimProposalReview.vue'
import { createManualAimProposal } from '../utils/aim-proposal'
import { trpc } from '../trpc'

const props = defineProps<{
  show: boolean
  projectPath: string
}>()

const emit = defineEmits<{
  close: []
  persisted: [result: { rootAimId: string, idMap: Record<string, string> }]
}>()

const sourceText = ref('')
const proposal = ref<AimProposal | null>(null)
const input = ref<HTMLTextAreaElement>()
const generating = ref(false)
const error = ref('')

watch(() => props.show, async (show) => {
  if (!show) {
    sourceText.value = ''
    proposal.value = null
    generating.value = false
    error.value = ''
    return
  }
  await nextTick()
  input.value?.focus()
})

const createDraft = () => {
  const text = sourceText.value.trim()
  if (!text) return
  proposal.value = createManualAimProposal(text)
}

const generateDraft = async () => {
  const text = sourceText.value.trim()
  if (!text || generating.value) return
  generating.value = true
  error.value = ''
  try {
    proposal.value = await trpc.aim.proposeAimSubtree.mutate({
      projectPath: props.projectPath,
      transcript: text,
      existingParentIds: []
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not generate a proposal'
  } finally {
    generating.value = false
  }
}

const closeReview = () => {
  proposal.value = null
}
</script>

<template>
  <AimProposalReview
    v-if="proposal"
    :show="show"
    :project-path="projectPath"
    :proposal="proposal"
    @close="closeReview"
    @persisted="emit('persisted', $event)"
  />
  <FormModalShell
    v-else
    :show="show"
    title="Turn a goal into aims"
    width="min(92vw, 38rem)"
    @request-close="emit('close')"
  >
    <form class="entry-form" @submit.prevent="createDraft">
      <label for="aim-proposal-source">What do you want to achieve?</label>
      <textarea
        id="aim-proposal-source"
        ref="input"
        v-model="sourceText"
        rows="5"
        maxlength="10000"
        placeholder="Describe the outcome in ordinary language…"
      />
      <p>
        This starts as a private draft. You can decompose and review it before
        anything is added to the graph.
      </p>
      <p v-if="error" role="alert" class="error">
        {{ error }} You can still start manually.
      </p>
    </form>

    <template #footer>
      <button type="button" @click="emit('close')">Cancel</button>
      <button type="button" :disabled="!sourceText.trim() || generating" @click="createDraft">
        Start manually
      </button>
      <button type="button" class="primary" :disabled="!sourceText.trim() || generating" @click="generateDraft">
        {{ generating ? 'Generating…' : 'Propose with model' }}
      </button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.entry-form {
  display: grid;
  gap: 0.65rem;
}

label {
  color: #ddd;
  font-weight: 600;
}

textarea {
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
  border: 1px solid #555;
  border-radius: 0.3rem;
  padding: 0.65rem;
  color: #eee;
  background: #222;
  font: inherit;
}

p {
  margin: 0;
  color: #aaa;
  line-height: 1.45;
}

button {
  border: 1px solid #666;
  border-radius: 0.25rem;
  padding: 0.45rem 0.75rem;
  color: #eee;
  background: #383838;
  cursor: pointer;
}

button:disabled {
  cursor: default;
  opacity: 0.5;
}

.primary {
  border-color: #4f87b8;
  background: #35658f;
}

.error {
  color: #ff9f9f;
}
</style>
