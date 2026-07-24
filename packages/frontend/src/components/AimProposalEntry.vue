<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { AimProposal } from 'shared'
import FormModalShell from './FormModalShell.vue'
import AimProposalReview from './AimProposalReview.vue'

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

watch(() => props.show, async (show) => {
  if (!show) {
    sourceText.value = ''
    proposal.value = null
    return
  }
  await nextTick()
  input.value?.focus()
})

const createDraft = () => {
  const text = sourceText.value.trim()
  if (!text) return
  proposal.value = {
    revision: `manual-${Date.now()}-${crypto.randomUUID()}`,
    sourceText: text,
    existingParentIds: [],
    assumptions: [],
    questions: [],
    root: {
      proposalId: 'root',
      text,
      children: []
    }
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
    </form>

    <template #footer>
      <button type="button" @click="emit('close')">Cancel</button>
      <button type="button" class="primary" :disabled="!sourceText.trim()" @click="createDraft">
        Create editable draft
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
</style>
