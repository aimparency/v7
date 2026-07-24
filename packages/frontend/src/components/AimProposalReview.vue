<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { flattenAimProposal, type AimProposal } from 'shared'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'
import AimProposalNodeEditor from './AimProposalNodeEditor.vue'

const props = defineProps<{
  show: boolean
  projectPath: string
  proposal: AimProposal
}>()

const emit = defineEmits<{
  close: []
  persisted: [result: { rootAimId: string, idMap: Record<string, string> }]
}>()

// AimProposal is deliberately JSON-only. Serializing also unwraps Vue's
// reactive prop proxy, which structuredClone cannot clone directly.
const cloneProposal = (proposal: AimProposal): AimProposal =>
  JSON.parse(JSON.stringify(proposal)) as AimProposal
const draft = ref(cloneProposal(props.proposal))
const reviewing = ref(false)
const persisting = ref(false)
const error = ref('')
const idempotencyKey = ref('')

watch(() => props.proposal, (proposal) => {
  draft.value = cloneProposal(proposal)
  reviewing.value = false
  error.value = ''
  idempotencyKey.value = ''
}, { deep: true })

watch(draft, () => {
  if (!persisting.value) {
    error.value = ''
    idempotencyKey.value = ''
  }
}, { deep: true })

const flattened = computed(() => flattenAimProposal(draft.value.root))
const aimCount = computed(() => flattened.value.aims.length)
const connectionCount = computed(() =>
  flattened.value.connections.length + draft.value.existingParentIds.length
)
const canReview = computed(() =>
  aimCount.value > 0 &&
  flattened.value.aims.every(aim => aim.text.trim().length > 0) &&
  flattened.value.connections.every(connection =>
    Number.isFinite(connection.weight) && connection.weight > 0
  )
)

const startReview = () => {
  if (canReview.value) reviewing.value = true
}

const approve = async () => {
  if (persisting.value || !canReview.value) return
  persisting.value = true
  error.value = ''
  idempotencyKey.value ||= `${draft.value.revision}:${crypto.randomUUID()}`
  try {
    const result = await trpc.aim.approveAimSubtree.mutate({
      projectPath: props.projectPath,
      proposal: draft.value,
      revision: draft.value.revision,
      idempotencyKey: idempotencyKey.value
    })
    if (!result.complete) {
      const detail = 'error' in result ? result.error : 'Unknown persistence error'
      error.value = `Persistence stopped after ${result.completedOperations} operation(s): ${detail}`
      return
    }
    if (!result.rootAimId) throw new Error('Persistence completed without returning a root aim ID')
    emit('persisted', { rootAimId: result.rootAimId, idMap: result.idMap })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not add the proposal to the graph'
  } finally {
    persisting.value = false
  }
}
</script>

<template>
  <FormModalShell
    :show="show"
    title="Review proposed aims"
    width="min(94vw, 58rem)"
    :close-on-overlay="!persisting"
    :close-on-escape="!persisting"
    @request-close="emit('close')"
  >
    <div class="intro">
      <p v-if="!reviewing">
        Edit the proposed decomposition before reviewing it.
      </p>
      <p v-else class="nothing-added">
        Nothing has been added to the graph yet.
      </p>
      <p class="summary">
        {{ aimCount }} aim{{ aimCount === 1 ? '' : 's' }} and
        {{ connectionCount }} connection{{ connectionCount === 1 ? '' : 's' }}
      </p>
    </div>

    <AimProposalNodeEditor
      :node="draft.root"
      :readonly="reviewing"
      root
    />

    <p v-if="draft.assumptions.length" class="context">
      <strong>Assumptions:</strong> {{ draft.assumptions.join(' · ') }}
    </p>
    <p v-if="draft.questions.length" class="context warning">
      <strong>Open questions:</strong> {{ draft.questions.join(' · ') }}
    </p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>

    <template #footer>
      <button v-if="reviewing" type="button" :disabled="persisting" @click="reviewing = false">
        Back to editing
      </button>
      <button v-else type="button" @click="emit('close')">Cancel</button>
      <button
        v-if="!reviewing"
        type="button"
        class="primary"
        :disabled="!canReview"
        @click="startReview"
      >
        Review proposal
      </button>
      <button
        v-else
        type="button"
        class="primary"
        :disabled="persisting"
        @click="approve"
      >
        {{ persisting ? 'Adding…' : `Add ${aimCount} aims and ${connectionCount} connections` }}
      </button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.intro {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.intro p {
  margin: 0;
}

.nothing-added {
  color: #ffd580;
  font-weight: 600;
}

.summary,
.context {
  color: #aaa;
}

.context {
  margin-bottom: 0;
  line-height: 1.45;
}

.warning,
.error {
  color: #ffbd80;
}

.error {
  margin-bottom: 0;
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
