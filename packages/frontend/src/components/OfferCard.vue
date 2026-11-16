<script setup lang="ts">
import { computed, ref } from 'vue'
import { trpc } from '../trpc'
import { useDataStore, type SpaceOffer } from '../stores/data'
import { useProjectStore } from '../stores/project-store'
import { useToastStore } from '../stores/toast'

// Beside a space offered to ideas of this space and not accepted yet: who
// offers it and why. Those who write this space accept or decline it here;
// its proposer may withdraw it.
const props = defineProps<{ offers: SpaceOffer[] }>()

const dataStore = useDataStore()
const projectStore = useProjectStore()
const busy = ref(false)
const decides = computed(() => dataStore.access.writable)
const ideaText = (ideaId: string) => dataStore.ideas[ideaId]?.text ?? 'an idea'

async function settle(offer: SpaceOffer, accept: boolean) {
  if (busy.value) return
  busy.value = true
  const projectPath = projectStore.projectPath
  try {
    if (accept) await trpc.notes.acceptOffer.mutate({ graph: projectPath, id: offer.id })
    else await trpc.notes.remove.mutate({ graph: projectPath, id: offer.id })
    if (accept) {
      await dataStore.ensureProjectMeta(projectPath, { force: true })
      await dataStore.loadIdeas(projectPath, [offer.ideaId])
    }
    await dataStore.loadOffers(projectPath)
    const repoId = offer.space?.repoId
    if (!accept && repoId && !dataStore.offers.some(other => other.space?.repoId === repoId)) delete dataStore.linkedGraphViews[repoId]
  } catch (error) {
    useToastStore().error(accept ? 'Could not accept the offer' : 'Could not remove the offer', error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="offer-card" @mousedown.stop @touchstart.stop @click.stop>
    <div v-for="offer in props.offers" :key="offer.id" class="offer">
      <div class="who">
        {{ offer.mine ? 'You offer' : `${offer.author} offers` }} this space to “{{ ideaText(offer.ideaId) }}”
      </div>
      <div v-if="offer.text" class="pitch">{{ offer.text }}</div>
      <div class="actions">
        <template v-if="decides">
          <button class="btn-primary" :disabled="busy" @click="settle(offer, true)">Accept</button>
          <button class="btn-secondary" :disabled="busy" @click="settle(offer, false)">{{ offer.mine ? 'Withdraw' : 'Decline' }}</button>
        </template>
        <template v-else>
          <span class="waiting">Waiting for the owner</span>
          <button class="btn-secondary" :disabled="busy" @click="settle(offer, false)">Withdraw</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.offer-card {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: max-content;
  max-width: 18rem;
  padding: 0.5rem 0.6rem;
  border: 1px dashed #8fa3bf;
  border-radius: 0.4rem;
  background: rgba(20, 22, 28, 0.92);
  color: #ddd;
  font-size: 0.8rem;

  .who {
    color: #aaa;
  }

  .pitch {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.25rem;
  }

  .waiting {
    color: #888;
    flex: 1;
  }

  button {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
  }
}
</style>
