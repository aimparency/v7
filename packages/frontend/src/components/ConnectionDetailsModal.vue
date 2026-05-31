<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FormModalShell from './FormModalShell.vue'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useProjectStore } from '../stores/project-store'
import { useDataStore } from '../stores/data'
import { trpc } from '../trpc'
import {
  weightToShare,
  shareToWeight,
  clampShare,
  isSoleContributor,
  MAX_SHARE
} from 'shared/src/connection-weight'

const modalStore = useUIModalStore()
const projectStore = useProjectStore()
const dataStore = useDataStore()

// parent = supported aim, child = supporting aim. Connection already exists at a default weight.
const parent = computed(() =>
  modalStore.connectionDetailsParentId ? dataStore.aims[modalStore.connectionDetailsParentId] : undefined
)
const childId = computed(() => modalStore.connectionDetailsChildId)
const child = computed(() => (childId.value ? dataStore.aims[childId.value] : undefined))

const thisConn = computed(() =>
  parent.value?.supportingConnections?.find((c: any) => c.aimId === childId.value)
)
const siblings = computed(() =>
  (parent.value?.supportingConnections ?? []).filter((c: any) => c.aimId !== childId.value)
)
// S = sum of sibling weights, L = parent's loop weight. share = w / (S + L + w).
const siblingWeightSum = computed(() => siblings.value.reduce((s: number, c: any) => s + (c.weight ?? 1), 0))
const loopWeight = computed(() => parent.value?.loopWeight ?? 0)
const sole = computed(() => isSoleContributor(siblingWeightSum.value, loopWeight.value))

const sharePct = ref(0)
const explanation = ref('')
const capHintVisible = ref(false)

const maxPct = Math.round(MAX_SHARE * 100)

// (Re)initialise inputs whenever the target connection resolves.
watch(
  thisConn,
  (conn) => {
    if (!conn) return
    explanation.value = conn.explanation ?? ''
    sharePct.value = sole.value
      ? 100
      : Math.round(weightToShare(conn.weight ?? 1, siblingWeightSum.value, loopWeight.value) * 100)
    capHintVisible.value = false
  },
  { immediate: true }
)

const onPctInput = (event: Event) => {
  const raw = Number((event.target as HTMLInputElement).value)
  capHintVisible.value = !Number.isNaN(raw) && raw >= maxPct
  sharePct.value = Math.round(clampShare((Number.isNaN(raw) ? 0 : raw) / 100) * 100)
}

const resolvedWeight = computed(() =>
  sole.value ? 1 : shareToWeight(sharePct.value / 100, siblingWeightSum.value, loopWeight.value)
)

const pct = (x: number) => `${Math.round(x * 100)}%`

// Top-3 other contributors to the parent, with their share AFTER this change, for
// orientation. Shares are the parent's outflow slice: weight / (S + L + thisWeight).
const otherContributors = computed(() => {
  const total = siblingWeightSum.value + loopWeight.value + resolvedWeight.value
  if (total <= 0) return []
  const entries = siblings.value.map((c: any) => ({
    id: c.aimId,
    label: dataStore.aims[c.aimId]?.text ?? c.aimId.slice(0, 8),
    share: (c.weight ?? 1) / total,
    isLoop: false
  }))
  if (loopWeight.value > 0) {
    entries.push({ id: '__loop__', label: 'self-retention (loop)', share: loopWeight.value / total, isLoop: true })
  }
  entries.sort((a, b) => b.share - a.share)
  return entries.slice(0, 3)
})

const confirm = async () => {
  const p = parent.value
  const cid = childId.value
  if (!p || !cid) {
    modalStore.closeConnectionDetailsModal()
    return
  }
  const updatedConnections = p.supportingConnections.map((c: any) =>
    c.aimId === cid ? { ...c, weight: resolvedWeight.value, explanation: explanation.value } : c
  )
  // Optimistic local update + value recompute, then persist.
  dataStore.replaceAim(p.id, { ...p, supportingConnections: updatedConnections })
  dataStore.recalculateValues()
  modalStore.closeConnectionDetailsModal()
  try {
    await trpc.aim.update.mutate({
      projectPath: projectStore.projectPath,
      aimId: p.id,
      aim: { supportingConnections: updatedConnections }
    })
  } catch (e) {
    console.error('Failed to save connection details', e)
  }
}

// Cancel keeps the already-persisted default-weight connection.
const cancel = () => modalStore.closeConnectionDetailsModal()
</script>

<template>
  <FormModalShell
    :show="true"
    title="Connection details"
    width="min(90vw, 32rem)"
    @request-close="cancel"
  >
    <div class="connection-details">
      <p class="relation">
        <span class="aim-name">{{ child?.text ?? '…' }}</span>
        <span class="arrow">supports</span>
        <span class="aim-name">{{ parent?.text ?? '…' }}</span>
      </p>

      <div v-if="sole" class="form-group">
        <label>Contribution</label>
        <p class="sole-note">Sole supporter — 100% of this aim's value flows here.</p>
      </div>

      <div v-else class="form-group">
        <label>Contribution share (%)</label>
        <input
          type="number"
          min="0"
          :max="maxPct"
          :value="sharePct"
          @input="onPctInput"
        />
        <p v-if="capHintVisible" class="hint">
          100% isn't possible while other aims also support this — capped at {{ maxPct }}%.
        </p>

        <ul v-if="otherContributors.length" class="preview">
          <li class="this-row">
            <span class="name">{{ child?.text ?? 'This connection' }}</span>
            <span class="share">{{ sharePct }}%</span>
          </li>
          <li v-for="o in otherContributors" :key="o.id" :class="{ loop: o.isLoop }">
            <span class="name">{{ o.label }}</span>
            <span class="share">{{ pct(o.share) }}</span>
          </li>
        </ul>
      </div>

      <div class="form-group">
        <label>Explanation (optional)</label>
        <textarea
          v-model="explanation"
          rows="3"
          placeholder="Why does this aim support the other?"
        ></textarea>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="cancel">Cancel</button>
      <button class="btn btn-primary" @click="confirm">Save</button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.connection-details {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;

  & .relation {
    margin: 0;
    color: #bbb;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    align-items: baseline;

    & .aim-name { color: #e0e0e0; font-weight: 600; }
    & .arrow { color: #888; font-size: 0.85rem; }
  }

  & .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;

    & label { color: #bbb; font-size: 0.85rem; }
    & input, & textarea {
      background: #1e1e1e;
      border: 1px solid #555;
      border-radius: 0.25rem;
      color: #e0e0e0;
      padding: 0.4rem 0.5rem;
      font: inherit;
    }
    & textarea { resize: vertical; }
  }

  & .hint { margin: 0; color: #e0a33a; font-size: 0.8rem; }
  & .sole-note { margin: 0; color: #888; font-size: 0.85rem; }

  & .preview {
    list-style: none;
    margin: 0.25rem 0 0;
    padding: 0.5rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 0.25rem;
    font-size: 0.85rem;

    & li {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.15rem 0;
      color: #bbb;

      & .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      & .share { color: #888; flex-shrink: 0; }
    }
    & .this-row { color: #e0e0e0; font-weight: 600; & .share { color: #6ea8fe; } }
    & .loop { font-style: italic; }
  }
}

.btn {
  background: #3a3a3a;
  border: 1px solid #555;
  border-radius: 0.25rem;
  color: #e0e0e0;
  padding: 0.4rem 0.9rem;
  cursor: pointer;

  &.btn-primary { background: #2d6cdf; border-color: #2d6cdf; }
  &:hover { filter: brightness(1.15); }
}
</style>
